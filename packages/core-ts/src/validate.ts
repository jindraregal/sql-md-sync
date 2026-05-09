import fs from 'fs';
import os from 'os';
import path from 'path';
import matter from 'gray-matter';
import Database from 'better-sqlite3';
import { readConfig, fingerprintSchema } from './config.js';
import { readSchemaFiles } from './schema.js';
import { exportDb } from './export.js';
import { importMd } from './import.js';
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

  // Schema fingerprint check
  if (config.schemaFingerprint) {
    const combined = Object.values(schemas)
      .map((s) => s.trim() + ';\n')
      .join('');
    const fp = fingerprintSchema(combined);
    if (fp !== config.schemaFingerprint) {
      warnings.push(
        `Schema fingerprint differs from config (got ${fp.slice(0, 16)}, expected ${config.schemaFingerprint.slice(0, 16)})`
      );
    }
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
    if (!meta) warnings.push(`Missing _index.md for table ${table}`);

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
        matter(content);
      } catch (e) {
        errors.push(`Malformed file ${table}/${f}: ${e}`);
      }
    }
  }

  if (fs.existsSync(dataDir)) {
    for (const tableDir of fs.readdirSync(dataDir)) {
      if (!schemas[tableDir]) {
        warnings.push(`Data directory ${tableDir} has no corresponding schema file`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export interface RoundTripResult extends ValidationResult {
  rowsCompared: number;
  tableMismatches: string[];
}

/**
 * Round-trip validation: import the MD tree to a temp DB, re-export to a temp dir,
 * then compare the new export with the original tree byte-by-byte.
 */
export async function validateRoundTrip(mdDir: string): Promise<RoundTripResult> {
  const base = validate(mdDir);
  const result: RoundTripResult = {
    ...base,
    rowsCompared: 0,
    tableMismatches: [],
  };

  if (!base.valid) return result;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-roundtrip-'));
  const tmpDb = path.join(tmpDir, 'rt.db');
  const tmpOut = path.join(tmpDir, 'export');

  try {
    await importMd({ md: mdDir, out: tmpDb });
    await exportDb({ db: tmpDb, out: tmpOut });

    // Walk both trees; compare the tracked files (data/ and _schema/)
    const compareSubpaths = ['data', '_schema'];
    for (const sub of compareSubpaths) {
      const a = path.join(mdDir, sub);
      const b = path.join(tmpOut, sub);
      const diffs = compareDirs(a, b);
      for (const d of diffs) result.tableMismatches.push(d);
    }

    // Count rows in original
    const db = new Database(tmpDb, { readonly: true });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];
    for (const t of tables) {
      const c = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as { c: number };
      result.rowsCompared += c.c;
    }
    db.close();
  } catch (e) {
    result.errors.push(`Round-trip failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (result.tableMismatches.length > 0) {
    result.errors.push(
      `Round-trip produced ${result.tableMismatches.length} file difference(s)`
    );
  }
  result.valid = result.errors.length === 0;
  return result;
}

function compareDirs(a: string, b: string): string[] {
  const out: string[] = [];
  const aExists = fs.existsSync(a);
  const bExists = fs.existsSync(b);
  if (!aExists && !bExists) return out;
  if (!aExists) return [`only in B: ${b}`];
  if (!bExists) return [`only in A: ${a}`];

  const aFiles = new Set(fs.readdirSync(a));
  const bFiles = new Set(fs.readdirSync(b));
  const all = new Set([...aFiles, ...bFiles]);

  for (const f of all) {
    const ap = path.join(a, f);
    const bp = path.join(b, f);
    if (!aFiles.has(f)) {
      out.push(`only in B: ${bp}`);
      continue;
    }
    if (!bFiles.has(f)) {
      out.push(`only in A: ${ap}`);
      continue;
    }
    const as = fs.statSync(ap);
    const bs = fs.statSync(bp);
    if (as.isDirectory() && bs.isDirectory()) {
      out.push(...compareDirs(ap, bp));
    } else if (as.isFile() && bs.isFile()) {
      const ac = fs.readFileSync(ap);
      const bc = fs.readFileSync(bp);
      if (!ac.equals(bc)) {
        out.push(`differs: ${ap}`);
      }
    } else {
      out.push(`type-mismatch: ${ap}`);
    }
  }

  return out;
}
