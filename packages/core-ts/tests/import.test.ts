import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportDb } from '../src/export.js';
import { importMd } from '../src/import.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-import-'));
}

describe('import: schema fingerprint check', () => {
  let dir: string;
  let srcDb: string;
  let mdDir: string;
  let outDb: string;

  beforeEach(() => {
    dir = tmpDir();
    srcDb = path.join(dir, 'src.db');
    mdDir = path.join(dir, 'md');
    outDb = path.join(dir, 'out.db');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function exportFixture(): Promise<void> {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO users VALUES (?, ?)').run(1, 'Alice');
    db.close();
    await exportDb({ db: srcDb, out: mdDir });
  }

  it('imports cleanly when fingerprint matches', async () => {
    await exportFixture();
    await expect(importMd({ md: mdDir, out: outDb })).resolves.toBeUndefined();
    expect(fs.existsSync(outDb)).toBe(true);
  });

  it('refuses to import when _schema files have been edited', async () => {
    await exportFixture();
    const schemaFile = path.join(mdDir, '_schema', 'users.sql');
    const original = fs.readFileSync(schemaFile, 'utf8');
    fs.writeFileSync(schemaFile, original.replace('name TEXT', 'name TEXT, email TEXT'));

    await expect(importMd({ md: mdDir, out: outDb })).rejects.toThrow(
      /Schema fingerprint mismatch/
    );
    // Destination DB must not have been written
    expect(fs.existsSync(outDb)).toBe(false);
  });

  it('--force overrides the fingerprint check and proceeds', async () => {
    await exportFixture();
    const schemaFile = path.join(mdDir, '_schema', 'users.sql');
    const original = fs.readFileSync(schemaFile, 'utf8');
    fs.writeFileSync(schemaFile, original.replace('name TEXT', 'name TEXT, email TEXT'));

    await expect(importMd({ md: mdDir, out: outDb, force: true })).resolves.toBeUndefined();
    expect(fs.existsSync(outDb)).toBe(true);

    // The forced import should have used the edited schema
    const db = new Database(outDb, { readonly: true });
    const cols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('email');
    db.close();
  });

  it('does not check when config has no recorded fingerprint', async () => {
    await exportFixture();
    // Wipe the fingerprint from the config
    const cfgPath = path.join(mdDir, '.sqlmdsync.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.schema_fingerprint = '';
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    // Edit the schema; with no recorded fingerprint there's nothing to compare against.
    const schemaFile = path.join(mdDir, '_schema', 'users.sql');
    const original = fs.readFileSync(schemaFile, 'utf8');
    fs.writeFileSync(schemaFile, original.replace('name TEXT', 'name TEXT, email TEXT'));

    await expect(importMd({ md: mdDir, out: outDb })).resolves.toBeUndefined();
  });
});
