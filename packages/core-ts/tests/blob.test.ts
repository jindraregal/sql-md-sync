import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportDb } from '../src/export.js';
import { importMd } from '../src/import.js';

describe('BLOB columns', () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-blob-'));
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it('round-trips BLOB columns via .bin sidecars', async () => {
    const dbPath = path.join(tmpdir, 'src.db');
    const out = path.join(tmpdir, 'out');
    const outDb = path.join(tmpdir, 'imp.db');

    const db = new Database(dbPath);
    db.exec(`CREATE TABLE files (id INTEGER PRIMARY KEY, name TEXT, data BLOB)`);
    const blob = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    db.prepare('INSERT INTO files VALUES (?, ?, ?)').run(1, 'icon', blob);
    db.close();

    await exportDb({ db: dbPath, out });

    // Sidecar should exist
    const tableDir = path.join(out, 'data', 'files');
    const files = fs.readdirSync(tableDir);
    expect(files.some((f) => f.endsWith('.data.bin'))).toBe(true);

    await importMd({ md: out, out: outDb });
    const imported = new Database(outDb, { readonly: true });
    const row = imported.prepare('SELECT * FROM files WHERE id=1').get() as Record<string, unknown>;
    expect(Buffer.from(row.data as Buffer).equals(blob)).toBe(true);
    imported.close();
  });
});
