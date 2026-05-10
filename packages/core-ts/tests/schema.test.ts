import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeSchemaFiles, readSchemaFiles } from '../src/schema.js';
import { fingerprintSchema } from '../src/config.js';
import { exportDb } from '../src/export.js';
import { validate } from '../src/validate.js';
import { status } from '../src/status.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-schema-'));
}

describe('schema fingerprint round-trip', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writeSchemaFiles + readSchemaFiles produce identical fingerprint', () => {
    const dbPath = path.join(dir, 'src.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    db.exec(`CREATE TABLE posts (id INTEGER PRIMARY KEY, body TEXT)`);

    const exportCombined = writeSchemaFiles(db, dir);
    const exportFp = fingerprintSchema(exportCombined);

    const schemas = readSchemaFiles(dir);
    const readCombined = Object.values(schemas).join('');
    const readFp = fingerprintSchema(readCombined);

    expect(readFp).toBe(exportFp);
    db.close();
  });

  it('readSchemaFiles returns raw file content (preserves trailing newline)', () => {
    const dbPath = path.join(dir, 'src.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
    writeSchemaFiles(db, dir);
    db.close();

    const schemas = readSchemaFiles(dir);
    expect(schemas.t.endsWith(';\n')).toBe(true);
  });

  it('readSchemaFiles iterates table files in deterministic (sorted) order', () => {
    const schemaDir = path.join(dir, '_schema');
    fs.mkdirSync(schemaDir, { recursive: true });
    // Write in non-alphabetical order
    fs.writeFileSync(path.join(schemaDir, 'zebra.sql'), 'CREATE TABLE zebra (id INTEGER);\n');
    fs.writeFileSync(path.join(schemaDir, 'alpha.sql'), 'CREATE TABLE alpha (id INTEGER);\n');
    fs.writeFileSync(path.join(schemaDir, 'mango.sql'), 'CREATE TABLE mango (id INTEGER);\n');

    const schemas = readSchemaFiles(dir);
    expect(Object.keys(schemas)).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('validate reports no fingerprint warning for a freshly exported tree', async () => {
    const dbPath = path.join(dir, 'src.db');
    const mdDir = path.join(dir, 'md');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO users VALUES (?, ?)').run(1, 'Alice');
    db.close();

    await exportDb({ db: dbPath, out: mdDir });
    const result = validate(mdDir);
    expect(result.warnings.some((w) => w.includes('fingerprint'))).toBe(false);
  });

  it('status reports fingerprintMatch=true for a freshly exported tree', async () => {
    const dbPath = path.join(dir, 'src.db');
    const mdDir = path.join(dir, 'md');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO users VALUES (?, ?)').run(1, 'Alice');
    db.close();

    await exportDb({ db: dbPath, out: mdDir });
    const report = await status({ md: mdDir, db: dbPath });
    expect(report.fingerprintMatch).toBe(true);
  });
});
