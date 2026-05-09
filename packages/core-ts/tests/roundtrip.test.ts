import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportDb } from '../src/export.js';
import { importMd } from '../src/import.js';
import { validate } from '../src/validate.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-test-'));
}

function cleanUp(...dirs: string[]): void {
  for (const d of dirs) {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true });
  }
}

describe('round-trip: simple table', () => {
  let tmpdir: string;
  let srcDb: string;
  let mdDir: string;
  let outDb: string;

  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    mdDir = path.join(tmpdir, 'md');
    outDb = path.join(tmpdir, 'out.db');
  });

  afterEach(() => cleanUp(tmpdir));

  it('round-trips basic users table', async () => {
    const db = new Database(srcDb);
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
      )
    `);
    db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(1, 'Alice', 'alice@example.com');
    db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(2, 'Bob', null);
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    await importMd({ md: mdDir, out: outDb });

    const orig = new Database(srcDb, { readonly: true });
    const imported = new Database(outDb, { readonly: true });

    const origRows = orig.prepare('SELECT * FROM users ORDER BY id').all();
    const importedRows = imported.prepare('SELECT * FROM users ORDER BY id').all();

    expect(importedRows).toEqual(origRows);
    orig.close();
    imported.close();
  });

  it('preserves NULL values', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT, num REAL)`);
    db.prepare('INSERT INTO items VALUES (?, ?, ?)').run(1, null, null);
    db.prepare('INSERT INTO items VALUES (?, ?, ?)').run(2, 'hello', 3.14);
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    await importMd({ md: mdDir, out: outDb });

    const imported = new Database(outDb, { readonly: true });
    const rows = imported.prepare('SELECT * FROM items ORDER BY id').all() as Record<
      string,
      unknown
    >[];
    expect(rows[0].val).toBeNull();
    expect(rows[0].num).toBeNull();
    expect(rows[1].val).toBe('hello');
    expect(rows[1].num).toBeCloseTo(3.14);
    imported.close();
  });
});

describe('round-trip: large text / body columns', () => {
  let tmpdir: string;
  let srcDb: string;
  let mdDir: string;
  let outDb: string;

  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    mdDir = path.join(tmpdir, 'md');
    outDb = path.join(tmpdir, 'out.db');
  });

  afterEach(() => cleanUp(tmpdir));

  it('puts large text in body sections', async () => {
    const longText = 'This is a long text that exceeds the threshold. '.repeat(10);
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, body TEXT)`);
    db.prepare('INSERT INTO posts VALUES (?, ?, ?)').run(1, 'Hello', longText);
    db.close();

    await exportDb({ db: srcDb, out: mdDir });

    const rowFile = fs
      .readdirSync(path.join(mdDir, 'data', 'posts'))
      .find((f) => f !== '_index.md')!;
    const content = fs.readFileSync(path.join(mdDir, 'data', 'posts', rowFile), 'utf8');

    expect(content).toContain('# body');
    expect(content).toContain(longText.trim());

    await importMd({ md: mdDir, out: outDb });
    const imported = new Database(outDb, { readonly: true });
    const row = imported.prepare('SELECT * FROM posts WHERE id=1').get() as Record<string, unknown>;
    expect(row.body).toBe(longText);
    imported.close();
  });

  it('puts text with newlines in body sections', async () => {
    const multilineText = 'Line one\nLine two\nLine three';
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT)`);
    db.prepare('INSERT INTO notes VALUES (?, ?)').run(1, multilineText);
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    await importMd({ md: mdDir, out: outDb });

    const imported = new Database(outDb, { readonly: true });
    const row = imported.prepare('SELECT * FROM notes WHERE id=1').get() as Record<string, unknown>;
    expect(row.content).toBe(multilineText);
    imported.close();
  });
});

describe('round-trip: special characters', () => {
  let tmpdir: string;
  let srcDb: string;
  let mdDir: string;
  let outDb: string;

  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    mdDir = path.join(tmpdir, 'md');
    outDb = path.join(tmpdir, 'out.db');
  });

  afterEach(() => cleanUp(tmpdir));

  it('handles emoji in text', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE msgs (id INTEGER PRIMARY KEY, text TEXT)`);
    db.prepare('INSERT INTO msgs VALUES (?, ?)').run(1, 'Hello 🎉 World 🚀');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    await importMd({ md: mdDir, out: outDb });

    const imported = new Database(outDb, { readonly: true });
    const row = imported.prepare('SELECT * FROM msgs WHERE id=1').get() as Record<string, unknown>;
    expect(row.text).toBe('Hello 🎉 World 🚀');
    imported.close();
  });

  it('handles quotes and backticks in short strings', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE code (id INTEGER PRIMARY KEY, snippet TEXT)`);
    db.prepare('INSERT INTO code VALUES (?, ?)').run(1, 'it\'s a "test" with `backticks`');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    await importMd({ md: mdDir, out: outDb });

    const imported = new Database(outDb, { readonly: true });
    const row = imported.prepare('SELECT * FROM code WHERE id=1').get() as Record<string, unknown>;
    expect(row.snippet).toBe('it\'s a "test" with `backticks`');
    imported.close();
  });

  it('handles em-dashes and special punctuation in body', async () => {
    const text = 'A paragraph with em-dash — and ellipsis… and more\nNew line here';
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE articles (id INTEGER PRIMARY KEY, content TEXT)`);
    db.prepare('INSERT INTO articles VALUES (?, ?)').run(1, text);
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    await importMd({ md: mdDir, out: outDb });

    const imported = new Database(outDb, { readonly: true });
    const row = imported.prepare('SELECT * FROM articles WHERE id=1').get() as Record<
      string,
      unknown
    >;
    expect(row.content).toBe(text);
    imported.close();
  });
});

describe('validate command', () => {
  let tmpdir: string;
  let srcDb: string;
  let mdDir: string;

  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    mdDir = path.join(tmpdir, 'md');
  });

  afterEach(() => cleanUp(tmpdir));

  it('passes for valid exported tree', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO t VALUES (?, ?)').run(1, 'Alice');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    const result = validate(mdDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('catches missing config', () => {
    const dir = path.join(tmpdir, 'empty');
    fs.mkdirSync(dir, { recursive: true });
    const result = validate(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('.sqlmdsync.json'))).toBe(true);
  });

  it('catches row count mismatch', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO t VALUES (?, ?)').run(1, 'Alice');
    db.prepare('INSERT INTO t VALUES (?, ?)').run(2, 'Bob');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });

    // Delete a row file
    const tableDir = path.join(mdDir, 'data', 't');
    const files = fs.readdirSync(tableDir).filter((f) => f !== '_index.md');
    fs.unlinkSync(path.join(tableDir, files[0]));

    const result = validate(mdDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('rowCount') || e.includes('rows'))).toBe(true);
  });

  it('warns when _index.md is missing', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO t VALUES (?, ?)').run(1, 'Alice');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    fs.unlinkSync(path.join(mdDir, 'data', 't', '_index.md'));

    const result = validate(mdDir);
    expect(result.warnings.some((w) => w.includes('_index.md'))).toBe(true);
  });

  it('warns on data dir with no schema', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO t VALUES (?, ?)').run(1, 'Alice');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    fs.mkdirSync(path.join(mdDir, 'data', 'orphan_table'), { recursive: true });

    const result = validate(mdDir);
    expect(result.warnings.some((w) => w.includes('orphan_table'))).toBe(true);
  });

  it('warns when schema fingerprint differs', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO t VALUES (?, ?)').run(1, 'Alice');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });

    // Tamper schema file to cause fingerprint mismatch
    const schemaFile = path.join(mdDir, '_schema', 't.sql');
    const original = fs.readFileSync(schemaFile, 'utf8');
    fs.writeFileSync(schemaFile, original + ' -- extra');

    const result = validate(mdDir);
    expect(result.warnings.some((w) => w.includes('fingerprint'))).toBe(true);
  });
});

describe('slug generation', () => {
  let tmpdir: string;
  let srcDb: string;
  let mdDir: string;

  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    mdDir = path.join(tmpdir, 'md');
  });

  afterEach(() => cleanUp(tmpdir));

  it('generates unique slugs for duplicate text values', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO t VALUES (?, ?)').run(1, 'alice');
    db.prepare('INSERT INTO t VALUES (?, ?)').run(2, 'alice');
    db.prepare('INSERT INTO t VALUES (?, ?)').run(3, 'alice');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });

    const files = fs
      .readdirSync(path.join(mdDir, 'data', 't'))
      .filter((f) => f !== '_index.md')
      .sort();

    expect(files).toHaveLength(3);
    // All filenames must be unique
    expect(new Set(files).size).toBe(3);
  });

  it('uses pk for slug when no text column exists', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE counts (id INTEGER PRIMARY KEY, val INTEGER)`);
    db.prepare('INSERT INTO counts VALUES (?, ?)').run(1, 100);
    db.close();

    await exportDb({ db: srcDb, out: mdDir });

    const files = fs
      .readdirSync(path.join(mdDir, 'data', 'counts'))
      .filter((f) => f !== '_index.md');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/0001-/);
  });
});

describe('multi-table round-trip', () => {
  let tmpdir: string;
  let srcDb: string;
  let mdDir: string;
  let outDb: string;

  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    mdDir = path.join(tmpdir, 'md');
    outDb = path.join(tmpdir, 'out.db');
  });

  afterEach(() => cleanUp(tmpdir));

  it('round-trips multiple tables', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    db.exec(`CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, body TEXT)`);
    db.prepare('INSERT INTO users VALUES (?, ?)').run(1, 'Alice');
    db.prepare('INSERT INTO users VALUES (?, ?)').run(2, 'Bob');
    db.prepare('INSERT INTO posts VALUES (?, ?, ?, ?)').run(1, 1, 'Hello', 'A'.repeat(300));
    db.prepare('INSERT INTO posts VALUES (?, ?, ?, ?)').run(2, 2, 'World', 'B'.repeat(300));
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    await importMd({ md: mdDir, out: outDb });

    const orig = new Database(srcDb, { readonly: true });
    const imported = new Database(outDb, { readonly: true });

    const origUsers = orig.prepare('SELECT * FROM users ORDER BY id').all();
    const importedUsers = imported.prepare('SELECT * FROM users ORDER BY id').all();
    expect(importedUsers).toEqual(origUsers);

    const origPosts = orig.prepare('SELECT * FROM posts ORDER BY id').all();
    const importedPosts = imported.prepare('SELECT * FROM posts ORDER BY id').all();
    expect(importedPosts).toEqual(origPosts);

    orig.close();
    imported.close();
  });
});
