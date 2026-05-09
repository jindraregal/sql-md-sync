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

export async function importMd(opts: ImportOptions): Promise<void> {
  const { md: mdDir, out: dbPath, force } = opts;

  const config = readConfig(mdDir);
  if (!config) {
    throw new Error(`No .sqlmdsync.json found in ${mdDir}. Run export first.`);
  }

  const schemas = readSchemaFiles(mdDir);
  const dataDir = path.join(mdDir, 'data');

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const db = new Database(dbPath);

  // Enable WAL for performance
  db.pragma('journal_mode = WAL');

  for (const [table, createSql] of Object.entries(schemas)) {
    try {
      db.exec(createSql);
    } catch (e) {
      throw new Error(`Failed to create table ${table}: ${e}`);
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
        const row = markdownToRow(content);
        rows.push(row);
      } catch (e) {
        console.warn(`Warning: skipping malformed file ${f}: ${e}`);
      }
    }

    if (rows.length === 0) continue;

    // Collect union of all keys across all rows so null-in-first-row columns aren't missed
    const keySet = new Set<string>();
    for (const row of rows) {
      for (const k of Object.keys(row)) keySet.add(k);
    }
    const keys = Array.from(keySet);
    if (keys.length === 0) continue;

    const placeholders = keys.map((k) => `@${k}`).join(', ');
    const cols = keys.map((k) => `"${k}"`).join(', ');
    const insert = db.prepare(`INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`);

    const insertMany = db.transaction((rowsToInsert: RowData[]) => {
      for (const row of rowsToInsert) {
        // Normalize: keys not in this row get null
        const normalized: Record<string, unknown> = {};
        for (const k of keys) {
          normalized[k] = row[k] ?? null;
        }
        insert.run(normalized);
      }
    });

    insertMany(rows);

    if (meta && rows.length !== meta.rowCount && !force) {
      console.warn(
        `Warning: table ${table} expected ${meta.rowCount} rows but got ${rows.length}`
      );
    }
  }

  db.close();

  console.log(`Imported to ${dbPath}`);
}
