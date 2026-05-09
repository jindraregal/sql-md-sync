import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { readConfig } from './config.js';
import { readSchemaFiles } from './schema.js';
import type { TableMeta } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function readIndexMeta(tableDir: string): TableMeta | null {
  const indexPath = path.join(tableDir, '_index.md');
  if (!fs.existsSync(indexPath)) return null;
  const parsed = matter(fs.readFileSync(indexPath, 'utf8'));
  return parsed.data as TableMeta;
}

export function validate(mdDir: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const config = readConfig(mdDir);
  if (!config) {
    errors.push(`Missing .sqlmdsync.json in ${mdDir}`);
    return { valid: false, errors, warnings };
  }

  let schemas: Record<string, string>;
  try {
    schemas = readSchemaFiles(mdDir);
  } catch (e) {
    errors.push(String(e));
    return { valid: false, errors, warnings };
  }

  const dataDir = path.join(mdDir, 'data');
  if (!fs.existsSync(dataDir)) {
    errors.push(`Missing data/ directory in ${mdDir}`);
    return { valid: false, errors, warnings };
  }

  for (const table of Object.keys(schemas)) {
    const tableDir = path.join(dataDir, table);
    if (!fs.existsSync(tableDir)) {
      warnings.push(`No data directory for table ${table}`);
      continue;
    }

    const meta = readIndexMeta(tableDir);
    if (!meta) {
      warnings.push(`Missing _index.md for table ${table}`);
    }

    const rowFiles = fs
      .readdirSync(tableDir)
      .filter((f) => f.endsWith('.md') && f !== '_index.md')
      .sort();

    if (meta && rowFiles.length !== meta.rowCount) {
      errors.push(
        `Table ${table}: _index.md says ${meta.rowCount} rows but found ${rowFiles.length} files`
      );
    }

    for (const f of rowFiles) {
      const filePath = path.join(tableDir, f);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        matter(content); // throws if malformed
      } catch (e) {
        errors.push(`Malformed file ${table}/${f}: ${e}`);
      }
    }
  }

  // Check for data dirs without schema
  if (fs.existsSync(dataDir)) {
    for (const tableDir of fs.readdirSync(dataDir)) {
      if (!schemas[tableDir]) {
        warnings.push(`Data directory ${tableDir} has no corresponding schema file`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
