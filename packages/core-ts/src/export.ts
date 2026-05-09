import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import Database from 'better-sqlite3';
import {
  getTableNames,
  getColumns,
  getPkColumn,
  getIndexes,
  writeSchemaFiles,
  writeColumnMapping,
} from './schema.js';
import { detectBodyColumns, rowToMarkdown } from './serialize.js';
import { makeSlug, buildFilename, uniqueSlug, padWidth } from './slug.js';
import { readConfig, writeConfig, defaultConfig, fingerprintSchema } from './config.js';
import type { RowData, TableMeta } from './types.js';
import yaml from 'js-yaml';

export interface ExportOptions {
  db: string;
  out: string;
  force?: boolean;
}

function isBlobType(type: string): boolean {
  return type.toUpperCase().includes('BLOB');
}

function fileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function smartMerge(tmpDir: string, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });

  const tmpFiles = collectFiles(tmpDir);
  const outFiles = new Set(collectFiles(outDir));

  // Copy/update files where content changed
  for (const rel of tmpFiles) {
    const src = path.join(tmpDir, rel);
    const dst = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (!fs.existsSync(dst) || fileHash(src) !== fileHash(dst)) {
      fs.copyFileSync(src, dst);
    }
  }

  // Delete files in out that are no longer in tmp
  const tmpSet = new Set(tmpFiles);
  for (const rel of outFiles) {
    if (!tmpSet.has(rel)) {
      fs.unlinkSync(path.join(outDir, rel));
    }
  }

  // Prune empty directories left behind
  pruneEmptyDirs(outDir);
}

function collectFiles(dir: string, base = ''): string[] {
  const result: string[] = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...collectFiles(path.join(dir, entry.name), rel));
    } else {
      result.push(rel);
    }
  }
  return result;
}

function pruneEmptyDirs(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      pruneEmptyDirs(path.join(dir, entry.name));
    }
  }
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // Ignore - directory may not be empty
  }
}

export async function exportDb(opts: ExportOptions): Promise<void> {
  const { db: dbPath, out } = opts;

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true });

  // Write to a temp directory first for atomic output
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlmdsync-export-'));

  try {
    const schemaSql = writeSchemaFiles(db, tmpDir);
    const fingerprint = fingerprintSchema(schemaSql);

    const tables = getTableNames(db);
    const existingConfig = readConfig(out) ?? defaultConfig();
    const config = { ...existingConfig };
    config.schemaFingerprint = fingerprint;

    const dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    for (const table of tables) {
      const columns = getColumns(db, table);
      const pkCol = getPkColumn(db, table);
      const indexes = getIndexes(db, table);
      const columnOrder = columns.map((c) => c.name);

      const tableConf = config.tables[table];
      const excludeCols = new Set(tableConf?.excludeColumns ?? []);
      const visibleColumns = columns.filter((c) => !excludeCols.has(c.name));

      const rows = db
        .prepare(`SELECT * FROM ${JSON.stringify(table)} ORDER BY "${pkCol}"`)
        .iterate() as Iterable<RowData>;

      const threshold = tableConf?.largeTextThreshold ?? config.largeTextThreshold ?? 200;

      // Collect rows for body column detection (need first pass for small tables)
      const rowArray: RowData[] = [];
      for (const row of rows) rowArray.push(row);

      const bodyColumns =
        tableConf?.bodyColumns && tableConf.bodyColumns.length > 0
          ? tableConf.bodyColumns
          : detectBodyColumns(rowArray, visibleColumns, threshold);

      const blobColumns = new Set(
        visibleColumns.filter((c) => isBlobType(c.type)).map((c) => c.name)
      );

      config.tables[table] = {
        ...tableConf,
        pk: pkCol,
        bodyColumns,
      };

      const tableDir = path.join(dataDir, table);
      fs.mkdirSync(tableDir, { recursive: true });

      const meta: TableMeta = {
        table,
        rowCount: rowArray.length,
        pk: pkCol,
        indexes,
      };
      const indexFrontmatter = yaml.dump(meta, { lineWidth: -1, sortKeys: false });
      fs.writeFileSync(path.join(tableDir, '_index.md'), `---\n${indexFrontmatter}---\n`);

      const displayCol = tableConf?.displayColumn;
      let slugCol: string | null = null;
      if (displayCol && visibleColumns.some((c) => c.name === displayCol)) {
        slugCol = displayCol;
      } else {
        const textCols = visibleColumns.filter(
          (c) =>
            c.name !== pkCol &&
            (c.type.toUpperCase().includes('TEXT') ||
              c.type === '' ||
              c.type.toUpperCase().includes('CHAR'))
        );
        slugCol = textCols[0]?.name ?? null;
      }

      writeColumnMapping(tmpDir, table, {
        bodyColumns,
        ...(slugCol ? { displayColumn: slugCol } : {}),
      });

      const usedSlugs = new Set<string>();
      const maxId = rowArray.reduce((max, r) => {
        const v = Number(r[pkCol]);
        return Number.isFinite(v) && v > max ? v : max;
      }, rowArray.length);
      const padW = padWidth(maxId);

      for (let i = 0; i < rowArray.length; i++) {
        const row = rowArray[i];
        const slugBase = makeSlug(slugCol ? row[slugCol] : row[pkCol]);
        const slug = uniqueSlug(slugBase, usedSlugs, row[pkCol]);
        const idx = Number(row[pkCol]);
        const filenameIndex = Number.isFinite(idx) && idx > 0 ? idx : i + 1;
        const filename = buildFilename(filenameIndex, slug, padW);

        const inlineRow: RowData = {};
        for (const col of visibleColumns) {
          if (!blobColumns.has(col.name)) inlineRow[col.name] = row[col.name];
        }

        const base = filename.replace(/\.md$/, '');
        const encoding = config.blobEncoding ?? 'binary_sidecar';
        for (const blobCol of blobColumns) {
          const v = row[blobCol];
          if (v === null || v === undefined) continue;
          const buf = v instanceof Buffer ? v : Buffer.from(String(v));
          if (encoding === 'base64_sidecar') {
            fs.writeFileSync(path.join(tableDir, `${base}.${blobCol}.b64`), buf.toString('base64'));
          } else {
            fs.writeFileSync(path.join(tableDir, `${base}.${blobCol}.bin`), buf);
          }
        }

        const content = rowToMarkdown(inlineRow, bodyColumns, columnOrder);
        fs.writeFileSync(path.join(tableDir, filename), content);
      }
    }

    writeConfig(tmpDir, config);

    db.close();

    // Atomic merge: only update files whose content hash changed
    smartMerge(tmpDir, out);

    console.log(`Exported ${tables.length} table(s) to ${out}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
