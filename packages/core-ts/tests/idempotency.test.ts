import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportDb } from '../src/export.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-idem-'));
}

function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(p: string, prefix: string): void {
    for (const f of fs.readdirSync(p).sort()) {
      const full = path.join(p, f);
      const rel = prefix ? `${prefix}/${f}` : f;
      if (fs.statSync(full).isDirectory()) {
        walk(full, rel);
      } else {
        out[rel] = fs.readFileSync(full, 'utf8');
      }
    }
  }
  walk(dir, '');
  return out;
}

describe('export is idempotent', () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it('produces byte-identical output on repeated export', async () => {
    const dbPath = path.join(tmpdir, 'src.db');
    const out1 = path.join(tmpdir, 'out1');
    const out2 = path.join(tmpdir, 'out2');

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        email TEXT,
        bio TEXT
      )
    `);
    const longBio = 'Some long bio content '.repeat(20);
    for (let i = 1; i <= 5; i++) {
      db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(
        i,
        `User${i}`,
        `u${i}@example.com`,
        longBio
      );
    }
    db.close();

    await exportDb({ db: dbPath, out: out1 });
    await exportDb({ db: dbPath, out: out2 });

    const a = readTree(out1);
    const b = readTree(out2);

    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const k of Object.keys(a)) {
      expect(b[k]).toBe(a[k]);
    }
  });

  it('emits frontmatter keys in schema column order', async () => {
    const dbPath = path.join(tmpdir, 'src.db');
    const out = path.join(tmpdir, 'out');

    const db = new Database(dbPath);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, zeta TEXT, alpha TEXT, mu TEXT)`);
    db.prepare('INSERT INTO t VALUES (?, ?, ?, ?)').run(1, 'z', 'a', 'm');
    db.close();

    await exportDb({ db: dbPath, out });
    const files = fs.readdirSync(path.join(out, 'data', 't')).filter((f) => f !== '_index.md');
    const content = fs.readFileSync(path.join(out, 'data', 't', files[0]), 'utf8');

    // Order of frontmatter keys: id, zeta, alpha, mu (schema order)
    const fmEnd = content.indexOf('---', 3);
    const fm = content.slice(0, fmEnd);
    const idIdx = fm.indexOf('id:');
    const zetaIdx = fm.indexOf('zeta:');
    const alphaIdx = fm.indexOf('alpha:');
    const muIdx = fm.indexOf('mu:');
    expect(idIdx).toBeLessThan(zetaIdx);
    expect(zetaIdx).toBeLessThan(alphaIdx);
    expect(alphaIdx).toBeLessThan(muIdx);
  });

  it('orders rows by primary key', async () => {
    const dbPath = path.join(tmpdir, 'src.db');
    const out = path.join(tmpdir, 'out');

    const db = new Database(dbPath);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`);
    db.prepare('INSERT INTO t VALUES (?, ?)').run(3, 'c');
    db.prepare('INSERT INTO t VALUES (?, ?)').run(1, 'a');
    db.prepare('INSERT INTO t VALUES (?, ?)').run(2, 'b');
    db.close();

    await exportDb({ db: dbPath, out });
    const files = fs
      .readdirSync(path.join(out, 'data', 't'))
      .filter((f) => f !== '_index.md')
      .sort();

    expect(files[0]).toMatch(/^0001-a/);
    expect(files[1]).toMatch(/^0002-b/);
    expect(files[2]).toMatch(/^0003-c/);
  });
});
