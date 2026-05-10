import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportDb } from '../src/export.js';
import { diff, formatDiff } from '../src/diff.js';
import { status } from '../src/status.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-diff-'));
}

function cleanUp(...dirs: string[]): void {
  for (const d of dirs) {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true });
  }
}

describe('diff: no differences', () => {
  let tmpdir: string;
  let srcDb: string;
  let mdDir: string;

  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    mdDir = path.join(tmpdir, 'md');
  });
  afterEach(() => cleanUp(tmpdir));

  it('returns empty results when db and md are in sync', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO users VALUES (?, ?)').run(1, 'Alice');
    db.prepare('INSERT INTO users VALUES (?, ?)').run(2, 'Bob');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    const results = await diff({ md: mdDir, db: srcDb });
    expect(results).toHaveLength(0);
  });
});

describe('diff: row added in markdown', () => {
  let tmpdir: string;
  let srcDb: string;
  let mdDir: string;
  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    mdDir = path.join(tmpdir, 'md');
  });
  afterEach(() => cleanUp(tmpdir));

  it('detects row in md that is not in db', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO users VALUES (?, ?)').run(1, 'Alice');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });

    // Add a row file manually
    const newRow = `---\nid: 2\nname: Bob\n---\n`;
    fs.writeFileSync(path.join(mdDir, 'data', 'users', '0002-bob.md'), newRow);

    const results = await diff({ md: mdDir, db: srcDb });
    expect(results).toHaveLength(1);
    expect(results[0].table).toBe('users');
    expect(results[0].added).toHaveLength(1);
  });
});

describe('diff: row removed from markdown', () => {
  let tmpdir: string;
  let srcDb: string;
  let mdDir: string;

  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    mdDir = path.join(tmpdir, 'md');
  });
  afterEach(() => cleanUp(tmpdir));

  it('detects db row not present in md', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO users VALUES (?, ?)').run(1, 'Alice');
    db.prepare('INSERT INTO users VALUES (?, ?)').run(2, 'Bob');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });

    // Remove a row file
    const tableDir = path.join(mdDir, 'data', 'users');
    const rowFiles = fs
      .readdirSync(tableDir)
      .filter((f) => f !== '_index.md')
      .sort();
    fs.unlinkSync(path.join(tableDir, rowFiles[1]));

    const results = await diff({ md: mdDir, db: srcDb });
    expect(results).toHaveLength(1);
    expect(results[0].removed).toHaveLength(1);
  });
});

describe('formatDiff', () => {
  it('returns "No differences found." for empty results', () => {
    expect(formatDiff([])).toBe('No differences found.');
  });

  it('formats added, removed, and changed rows', () => {
    const output = formatDiff([
      {
        table: 'users',
        added: [{ id: 3, name: 'Charlie' }],
        removed: [{ id: 99, name: 'Old' }],
        changed: [{ pk: 1, from: { id: 1, name: 'A' }, to: { id: 1, name: 'B' } }],
      },
    ]);
    expect(output).toContain('users');
    expect(output).toContain('1 row(s) to add');
    expect(output).toContain('1 row(s) to remove');
    expect(output).toContain('1 row(s) changed');
  });

  it('skips sections with zero count', () => {
    const output = formatDiff([{ table: 'posts', added: [], removed: [{ id: 1 }], changed: [] }]);
    expect(output).toContain('1 row(s) to remove');
    expect(output).not.toContain('to add');
  });
});

describe('diff: row with permuted frontmatter keys is not "changed"', () => {
  let tmpdir: string;
  let srcDb: string;
  let mdDir: string;

  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    mdDir = path.join(tmpdir, 'md');
  });
  afterEach(() => cleanUp(tmpdir));

  it('treats rows with the same content but different YAML key order as identical', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)`);
    db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(1, 'Alice', 'alice@example.com');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });

    // Rewrite the row file with frontmatter keys in a different (non-schema) order.
    // Same content, but `email` comes before `name`, and `name` before `id`.
    const tableDir = path.join(mdDir, 'data', 'users');
    const rowFile = fs.readdirSync(tableDir).find((f) => f !== '_index.md')!;
    const reordered = ['---', 'email: alice@example.com', 'name: Alice', 'id: 1', '---', ''].join(
      '\n'
    );
    fs.writeFileSync(path.join(tableDir, rowFile), reordered);

    const results = await diff({ md: mdDir, db: srcDb });
    expect(results).toHaveLength(0);
  });
});

describe('diff: throws on missing config', () => {
  let tmpdir: string;
  let srcDb: string;

  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
    db.close();
  });
  afterEach(() => cleanUp(tmpdir));

  it('throws when md dir has no config', async () => {
    const emptyDir = path.join(tmpdir, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    await expect(diff({ md: emptyDir, db: srcDb })).rejects.toThrow('.sqlmdsync.json');
  });

  it('throws when db does not exist', async () => {
    const mdDir = path.join(tmpdir, 'md');
    await exportDb({ db: srcDb, out: mdDir });
    await expect(diff({ md: mdDir, db: '/nonexistent/path.db' })).rejects.toThrow(
      'Database not found'
    );
  });
});

describe('status command', () => {
  let tmpdir: string;
  let srcDb: string;
  let mdDir: string;

  beforeEach(() => {
    tmpdir = tmpDir();
    srcDb = path.join(tmpdir, 'src.db');
    mdDir = path.join(tmpdir, 'md');
  });
  afterEach(() => cleanUp(tmpdir));

  it('returns no drift for a freshly exported tree', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO users VALUES (?, ?)').run(1, 'Alice');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });
    const report = await status({ md: mdDir, db: srcDb });
    expect(report.hasDrift).toBe(false);
    expect(report.driftSummary).toBe('No differences found.');
  });

  it('returns hasDrift=true when db does not exist', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    db.close();
    await exportDb({ db: srcDb, out: mdDir });

    const report = await status({ md: mdDir, db: '/nonexistent/missing.db' });
    expect(report.hasDrift).toBe(true);
    expect(report.driftSummary).toContain('not found');
  });

  it('returns hasDrift=true when config is missing', async () => {
    const emptyDir = path.join(tmpdir, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    const report = await status({ md: emptyDir, db: srcDb });
    expect(report.hasDrift).toBe(true);
    expect(report.fingerprintMatch).toBe(false);
  });

  it('detects fingerprint mismatch when schema changes', async () => {
    const db = new Database(srcDb);
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO users VALUES (?, ?)').run(1, 'Alice');
    db.close();

    await exportDb({ db: srcDb, out: mdDir });

    // Tamper with the schema file
    const schemaFile = path.join(mdDir, '_schema', 'users.sql');
    const original = fs.readFileSync(schemaFile, 'utf8');
    fs.writeFileSync(schemaFile, original + '\n-- tampered');

    const report = await status({ md: mdDir, db: srcDb });
    expect(report.fingerprintMatch).toBe(false);
  });
});
