import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getTableNames, getColumns, getPkColumn, getIndexes, writeSchemaFiles } from './schema.js';
import { detectBodyColumns, rowToMarkdown } from './serialize.js';
import { makeSlug, buildFilename, uniqueSlug } from './slug.js';
import { readConfig, writeConfig, defaultConfig, fingerprintSchema } from './config.js';
import type { RowData, TableMeta } from './types.js';
import yaml from 'js-yaml';

export interface ExportOptions {
  db: string;
  out: string;
  force?: boolean;
}

export async function exportDb(opts: ExportOptions): Promise<void> {
  const { db: dbPath, out } = opts;

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true });

  fs.mkdirSync(out, { recursive: true });

  // Write schema files and compute fingerprint
  const schemaSql = writeSchemaFiles(db, out);
  const fingerprint = fingerprintSchema(schemaSql);

  const tables = getTableNames(db);
  const config = readConfig(out) ?? defaultConfig();
  config.schemaFingerprint = fingerprint;

  const dataDir = path.join(out, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  for (const table of tables) {
    const columns = getColumns(db, table);
    const pkCol = getPkColumn(db, table);
    const indexes = getIndexes(db, table);

    const rows = db.prepare(`SELECT * FROM ${JSON.stringify(table)}`).all() as RowData[];

    const threshold = config.largeTextThreshold ?? 200;
    const bodyColumns =
      config.tables[table]?.bodyColumns ?? detectBodyColumns(rows, columns, threshold);

    // Update config
    config.tables[table] = { pk: pkCol, bodyColumns };

    const tableDir = path.join(dataDir, table);
    fs.mkdirSync(tableDir, { recursive: true });

    // Write _index.md
    const meta: TableMeta = {
      table,
      rowCount: rows.length,
      pk: pkCol,
      indexes,
    };
    const indexFrontmatter = yaml.dump(meta, { lineWidth: -1 });
    fs.writeFileSync(path.join(tableDir, '_index.md'), `---\n${indexFrontmatter}---\n`);

    // Find first text column for slug (not the pk)
    const textCols = columns.filter(
      (c) =>
        c.name !== pkCol &&
        (c.type.toUpperCase().includes('TEXT') || c.type === '' || c.type.toUpperCase().includes('CHAR'))
    );
    const slugCol = textCols[0]?.name ?? null;

    const usedSlugs = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const slugBase = makeSlug(slugCol ? row[slugCol] : row[pkCol]);
      const slug = uniqueSlug(slugBase, usedSlugs);
      const filename = buildFilename(i + 1, slug);
      const content = rowToMarkdown(row, bodyColumns);
      fs.writeFileSync(path.join(tableDir, filename), content);
    }
  }

  writeConfig(out, config);

  db.close();

  console.log(`Exported ${tables.length} table(s) to ${out}`);
}
