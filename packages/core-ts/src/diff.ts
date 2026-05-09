import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { readConfig } from './config.js';
import { readSchemaFiles } from './schema.js';
import { markdownToRow } from './serialize.js';
import { rowToMarkdown } from './serialize.js';
import { getTableNames, getColumns, getPkColumn } from './schema.js';
import { detectBodyColumns } from './serialize.js';
import type { RowData } from './types.js';
import matter from 'gray-matter';

export interface DiffOptions {
  md: string;
  db: string;
}

export interface DiffResult {
  table: string;
  added: RowData[];
  removed: RowData[];
  changed: Array<{ pk: unknown; from: RowData; to: RowData }>;
}

function getRowFiles(tableDir: string): string[] {
  return fs
    .readdirSync(tableDir)
    .filter((f) => f.endsWith('.md') && f !== '_index.md')
    .sort();
}

export async function diff(opts: DiffOptions): Promise<DiffResult[]> {
  const { md: mdDir, db: dbPath } = opts;

  const config = readConfig(mdDir);
  if (!config) throw new Error(`No .sqlmdsync.json in ${mdDir}`);

  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

  const db = new Database(dbPath, { readonly: true });
  const results: DiffResult[] = [];

  const schemas = readSchemaFiles(mdDir);
  const dataDir = path.join(mdDir, 'data');

  for (const table of Object.keys(schemas)) {
    const tableConfig = config.tables[table];
    const pkCol = tableConfig?.pk ?? getPkColumn(db, table);
    const bodyColumns = tableConfig?.bodyColumns ?? [];

    // Current DB rows
    const dbRows = db.prepare(`SELECT * FROM "${table}"`).all() as RowData[];
    const dbByPk = new Map<unknown, RowData>();
    for (const row of dbRows) dbByPk.set(row[pkCol], row);

    // Markdown rows
    const tableDir = path.join(dataDir, table);
    const mdRows: RowData[] = [];
    if (fs.existsSync(tableDir)) {
      for (const f of getRowFiles(tableDir)) {
        try {
          const content = fs.readFileSync(path.join(tableDir, f), 'utf8');
          const row = markdownToRow(content);
          mdRows.push(row);
        } catch {
          // skip
        }
      }
    }

    const mdByPk = new Map<unknown, RowData>();
    for (const row of mdRows) mdByPk.set(row[pkCol], row);

    const added: RowData[] = [];
    const removed: RowData[] = [];
    const changed: Array<{ pk: unknown; from: RowData; to: RowData }> = [];

    for (const [pk, mdRow] of mdByPk) {
      if (!dbByPk.has(pk)) {
        added.push(mdRow);
      } else {
        const dbRow = dbByPk.get(pk)!;
        // Compare serialized forms
        const mdSerialized = rowToMarkdown(mdRow, bodyColumns);
        const dbSerialized = rowToMarkdown(dbRow, bodyColumns);
        if (mdSerialized !== dbSerialized) {
          changed.push({ pk, from: dbRow, to: mdRow });
        }
      }
    }

    for (const [pk, dbRow] of dbByPk) {
      if (!mdByPk.has(pk)) {
        removed.push(dbRow);
      }
    }

    if (added.length > 0 || removed.length > 0 || changed.length > 0) {
      results.push({ table, added, removed, changed });
    }
  }

  db.close();
  return results;
}

export function formatDiff(results: DiffResult[]): string {
  if (results.length === 0) return 'No differences found.';

  const lines: string[] = [];
  for (const r of results) {
    lines.push(`\n=== ${r.table} ===`);
    if (r.added.length > 0) lines.push(`  + ${r.added.length} row(s) to add`);
    if (r.removed.length > 0) lines.push(`  - ${r.removed.length} row(s) to remove`);
    if (r.changed.length > 0) lines.push(`  ~ ${r.changed.length} row(s) changed`);
  }
  return lines.join('\n');
}
