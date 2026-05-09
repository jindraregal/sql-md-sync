import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { readConfig } from './config.js';
import { readSchemaFiles } from './schema.js';
import { markdownToRow } from './serialize.js';
import matter from 'gray-matter';
import type { TableMeta, RowData } from './types.js';

export interface ImportOptions {
  md: string;
  out: string;
  force?: boolean;
}

interface ColInfo {
  name: string;
  type: string;
}

function readIndexMeta(tableDir: string): TableMeta | null {
  const indexPath = path.join(tableDir, '_index.md');
  if (!fs.existsSync(indexPath)) return null;
  const parsed = matter(fs.readFileSync(indexPath, 'utf8'));
  return parsed.data as TableMeta;
}

function getRowFiles(tableDir: string): string[] {
  return fs
    .readdirSync(tableDir)
    .filter((f) => f.endsWith('.md') && f !== '_index.md')
    .sort();
}

function getTableColumns(db: Database.Database, table: string): ColInfo[] {
  return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as ColInfo[];
}

function isBlobType(type: string): boolean {
  return type.toUpperCase().includes('BLOB');
}

export async function importMd(opts: ImportOptions): Promise<void> {
  const { md: mdDir, out: dbPath, force } = opts;

  const config = readConfig(mdDir);
  if (!config) {
    throw new Error(`No .sqlmdsync.json found in ${mdDir}. Run export first.`);
  }

  const schemas = readSchemaFiles(mdDir);
  const dataDir = path.join(mdDir, 'data');

  // Atomic swap: build new db at tmp path, rename on success
  const tmpPath = dbPath + '.tmp';
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

  const db = new Database(tmpPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  try {
    for (const [table, createSql] of Object.entries(schemas)) {
      try {
        db.exec(createSql);
      } catch (e) {
        throw new Error(
          `Failed to create table ${table}: ${e instanceof Error ? e.message : e}`
        );
      }

      const tableDir = path.join(dataDir, table);
      if (!fs.existsSync(tableDir)) {
        console.warn(`Warning: no data directory for table ${table}, skipping`);
        continue;
      }

      const meta = readIndexMeta(tableDir);
      const rowFiles = getRowFiles(tableDir);
      const rows: RowData[] = [];

      for (const f of rowFiles) {
        try {
          const content = fs.readFileSync(path.join(tableDir, f), 'utf8');
          rows.push(markdownToRow(content));
        } catch (e) {
          console.warn(`Warning: skipping malformed file ${f}: ${e}`);
        }
      }

      if (meta && rows.length !== meta.rowCount && !force) {
        console.warn(
          `Warning: table ${table} expected ${meta.rowCount} rows but got ${rows.length}`
        );
      }

      if (rows.length === 0) continue;

      const cols = getTableColumns(db, table);
      const colNames = cols.map((c) => c.name);
      const blobCols = new Set(cols.filter((c) => isBlobType(c.type)).map((c) => c.name));

      // Pull in BLOB sidecars: <basename>.<col>.bin or .b64
      for (let i = 0; i < rowFiles.length && i < rows.length; i++) {
        const base = rowFiles[i].replace(/\.md$/, '');
        for (const col of blobCols) {
          const binPath = path.join(tableDir, `${base}.${col}.bin`);
          const b64Path = path.join(tableDir, `${base}.${col}.b64`);
          if (fs.existsSync(binPath)) {
            rows[i][col] = fs.readFileSync(binPath);
          } else if (fs.existsSync(b64Path)) {
            rows[i][col] = Buffer.from(fs.readFileSync(b64Path, 'utf8').trim(), 'base64');
          }
        }
      }

      const placeholders = colNames.map((k) => `@${k}`).join(', ');
      const colList = colNames.map((k) => `"${k}"`).join(', ');
      const insert = db.prepare(`INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`);

      const insertMany = db.transaction((rowsToInsert: RowData[]) => {
        for (const row of rowsToInsert) {
          const normalized: Record<string, unknown> = {};
          for (const k of colNames) {
            const v = row[k];
            normalized[k] = v === undefined ? null : v;
          }
          insert.run(normalized);
        }
      });

      insertMany(rows);
    }

    db.close();

    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    fs.renameSync(tmpPath, dbPath);
  } catch (e) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
    throw e;
  }

  console.log(`Imported to ${dbPath}`);
}
