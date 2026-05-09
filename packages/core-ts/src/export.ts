import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getTableNames, getColumns, getPkColumn, getIndexes, writeSchemaFiles, writeColumnMapping } from './schema.js';
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

export async function exportDb(opts: ExportOptions): Promise<void> {
  const { db: dbPath, out } = opts;

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true });

  fs.mkdirSync(out, { recursive: true });

  const schemaSql = writeSchemaFiles(db, out);
  const fingerprint = fingerprintSchema(schemaSql);

  const tables = getTableNames(db);
  const config = readConfig(out) ?? defaultConfig();
  config.schemaFingerprint = fingerprint;

  const dataDir = path.join(out, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // Track tables we wrote so we can prune stale ones
  const writtenTableDirs = new Set<string>();

  for (const table of tables) {
    const columns = getColumns(db, table);
    const pkCol = getPkColumn(db, table);
    const indexes = getIndexes(db, table);
    const columnOrder = columns.map((c) => c.name);

    const rows = db
      .prepare(`SELECT * FROM ${JSON.stringify(table)} ORDER BY "${pkCol}"`)
      .all() as RowData[];

    const threshold = config.largeTextThreshold ?? 200;
    const tableConf = config.tables[table];
    const bodyColumns =
      tableConf?.bodyColumns && tableConf.bodyColumns.length > 0
        ? tableConf.bodyColumns
        : detectBodyColumns(rows, columns, threshold);

    const blobColumns = new Set(columns.filter((c) => isBlobType(c.type)).map((c) => c.name));

    config.tables[table] = {
      pk: pkCol,
      bodyColumns,
    };

    const tableDir = path.join(dataDir, table);
    fs.mkdirSync(tableDir, { recursive: true });
    writtenTableDirs.add(table);

    // Write _index.md first (so listings include it)
    const meta: TableMeta = {
      table,
      rowCount: rows.length,
      pk: pkCol,
      indexes,
    };
    const indexFrontmatter = yaml.dump(meta, { lineWidth: -1, sortKeys: false });
    fs.writeFileSync(path.join(tableDir, '_index.md'), `---\n${indexFrontmatter}---\n`);

    // Pick slug column: configurable display column; else first non-pk text column; else pk
    const displayCol = (tableConf as { displayColumn?: string } | undefined)?.displayColumn;
    let slugCol: string | null = null;
    if (displayCol && columns.some((c) => c.name === displayCol)) {
      slugCol = displayCol;
    } else {
      const textCols = columns.filter(
        (c) =>
          c.name !== pkCol &&
          (c.type.toUpperCase().includes('TEXT') ||
            c.type === '' ||
            c.type.toUpperCase().includes('CHAR'))
      );
      slugCol = textCols[0]?.name ?? null;
    }

    // Write column-to-section mapping (spec §4.2)
    writeColumnMapping(out, table, {
      bodyColumns,
      ...(slugCol ? { displayColumn: slugCol } : {}),
    });

    const usedSlugs = new Set<string>();
    const maxId = rows.reduce((max, r) => {
      const v = Number(r[pkCol]);
      return Number.isFinite(v) && v > max ? v : max;
    }, rows.length);
    const padW = padWidth(maxId);

    // Track expected files so we can prune stale ones
    const expectedFiles = new Set<string>(['_index.md']);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const slugBase = makeSlug(slugCol ? row[slugCol] : row[pkCol]);
      // Pass PK value as hash source so colliding slugs get stable, distinct suffixes
      const slug = uniqueSlug(slugBase, usedSlugs, row[pkCol]);
      const idx = Number(row[pkCol]);
      const filenameIndex = Number.isFinite(idx) && idx > 0 ? idx : i + 1;
      const filename = buildFilename(filenameIndex, slug, padW);
      expectedFiles.add(filename);

      // Strip blob columns from inline serialization; write them as sidecars
      const inlineRow: RowData = { ...row };
      const base = filename.replace(/\.md$/, '');
      const encoding = (config as { blobEncoding?: string }).blobEncoding ?? 'binary_sidecar';
      for (const blobCol of blobColumns) {
        const v = row[blobCol];
        if (v === null || v === undefined) continue;
        const buf = v instanceof Buffer ? v : Buffer.from(String(v));
        if (encoding === 'base64_sidecar') {
          fs.writeFileSync(path.join(tableDir, `${base}.${blobCol}.b64`), buf.toString('base64'));
          expectedFiles.add(`${base}.${blobCol}.b64`);
        } else {
          fs.writeFileSync(path.join(tableDir, `${base}.${blobCol}.bin`), buf);
          expectedFiles.add(`${base}.${blobCol}.bin`);
        }
        delete inlineRow[blobCol];
      }

      const content = rowToMarkdown(inlineRow, bodyColumns, columnOrder);
      fs.writeFileSync(path.join(tableDir, filename), content);
    }

    // Prune stale files in this table dir
    for (const f of fs.readdirSync(tableDir)) {
      if (!expectedFiles.has(f)) {
        fs.unlinkSync(path.join(tableDir, f));
      }
    }
  }

  // Prune stale table directories under data/
  if (fs.existsSync(dataDir)) {
    for (const d of fs.readdirSync(dataDir)) {
      if (!writtenTableDirs.has(d)) {
        fs.rmSync(path.join(dataDir, d), { recursive: true, force: true });
      }
    }
  }

  writeConfig(out, config);

  db.close();

  console.log(`Exported ${tables.length} table(s) to ${out}`);
}
