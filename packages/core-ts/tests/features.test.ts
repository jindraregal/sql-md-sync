/**
 * Feature tests covering spec §4.2-5.5 additions:
 *  - Block-scalar YAML for strings with :, #, quotes, or newlines (§4.4)
 *  - NULL body section with <!-- null --> marker (§4.2)
 *  - Body-header escaping with \# prefix (§4.4)
 *  - Unicode / diacritic transliteration in slugs (§4.3)
 *  - Short-hash slug deduplication (§4.3)
 *  - padWidth formula (§4.3)
 *  - _schema/<table>.columns.json column mapping (§4.2)
 *  - Round-trip idempotency: export → import → export produces zero diff (§5.3)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportDb } from '../src/export.js';
import { importMd } from '../src/import.js';
import { validateRoundTrip } from '../src/validate.js';
import { makeSlug, padWidth, uniqueSlug } from '../src/slug.js';
import { rowToMarkdown, markdownToRow, NULL_MARKER } from '../src/serialize.js';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-feat-'));
}

function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (p: string, prefix: string): void => {
    for (const f of fs.readdirSync(p).sort()) {
      const full = path.join(p, f);
      const rel = prefix ? `${prefix}/${f}` : f;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else out[rel] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

// ─── Block-scalar YAML (§4.4) ─────────────────────────────────────────────────

describe('block-scalar YAML (§4.4)', () => {
  it('uses block scalar for strings containing colon', () => {
    const md = rowToMarkdown({ id: 1, url: 'http://example.com/path' }, [], ['id', 'url']);
    expect(md).toContain('url: |-');
    expect(md).toContain('  http://example.com/path');
  });

  it('uses block scalar for strings containing hash', () => {
    const md = rowToMarkdown({ id: 1, note: 'See #42' }, [], ['id', 'note']);
    expect(md).toContain('note: |-');
    expect(md).toContain('  See #42');
  });

  it('uses block scalar for strings containing double-quote', () => {
    const md = rowToMarkdown({ id: 1, q: 'He said "hello"' }, [], ['id', 'q']);
    expect(md).toContain('q: |-');
  });

  it('uses block scalar for strings containing single-quote', () => {
    const md = rowToMarkdown({ id: 1, t: "it's a test" }, [], ['id', 't']);
    expect(md).toContain("t: |-");
  });

  it('uses block scalar for multiline strings in frontmatter', () => {
    const md = rowToMarkdown({ id: 1, tag: 'line1\nline2' }, [], ['id', 'tag']);
    expect(md).toContain('tag: |-');
    expect(md).toContain('  line1');
    expect(md).toContain('  line2');
  });

  it('round-trips block scalar strings correctly', () => {
    const values = [
      'http://example.com/foo:bar',
      'See #42 for details',
      'He said "hello"',
      "it's fine",
      'line one\nline two',
    ];
    for (const v of values) {
      const md = rowToMarkdown({ id: 1, val: v }, [], ['id', 'val']);
      const row = markdownToRow(md);
      expect(row.val).toBe(v);
    }
  });

  it('uses plain scalar for simple strings', () => {
    const md = rowToMarkdown({ id: 1, name: 'Alice Smith' }, [], ['id', 'name']);
    expect(md).toContain('name: Alice Smith');
    expect(md).not.toContain('|-');
  });

  it('quotes YAML keywords', () => {
    const md = rowToMarkdown({ id: 1, status: 'null' }, [], ['id', 'status']);
    // "null" must be quoted, not bare
    expect(md).toMatch(/status: ["']?null["']?/);
    const row = markdownToRow(md);
    expect(row.status).toBe('null'); // string, not JS null
  });
});

// ─── NULL body section (§4.2) ─────────────────────────────────────────────────

describe('NULL body sections (§4.2)', () => {
  let tmpdir: string;

  beforeEach(() => { tmpdir = tmp(); });
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }); });

  it('writes <!-- null --> marker for null body column', () => {
    const md = rowToMarkdown({ id: 1, body: null }, ['body'], ['id', 'body']);
    expect(md).toContain(`# body\n\n${NULL_MARKER}`);
  });

  it('writes empty section for empty string body column', () => {
    const md = rowToMarkdown({ id: 1, body: '' }, ['body'], ['id', 'body']);
    expect(md).toContain('# body');
    expect(md).not.toContain(NULL_MARKER);
  });

  it('round-trips NULL vs empty string in body columns', async () => {
    const dbPath = path.join(tmpdir, 'src.db');
    const out = path.join(tmpdir, 'out');
    const outDb = path.join(tmpdir, 'imp.db');

    const db = new Database(dbPath);
    db.exec(`CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, body TEXT)`);
    // Row 1: body with large text (forces body detection)
    db.prepare('INSERT INTO posts VALUES (?, ?, ?)').run(1, 'Long', 'x'.repeat(300));
    // Row 2: body is NULL
    db.prepare('INSERT INTO posts VALUES (?, ?, ?)').run(2, 'Null', null);
    db.close();

    await exportDb({ db: dbPath, out });
    await importMd({ md: out, out: outDb });

    const imported = new Database(outDb, { readonly: true });
    const rows = imported.prepare('SELECT * FROM posts ORDER BY id').all() as Record<string, unknown>[];
    expect(rows[0].body).toBe('x'.repeat(300));
    expect(rows[1].body).toBeNull();
    imported.close();
  });

  it('markdownToRow parses <!-- null --> as null', () => {
    const md = `---\nid: 1\n---\n\n# body\n\n${NULL_MARKER}\n`;
    const row = markdownToRow(md);
    expect(row.body).toBeNull();
  });

  it('markdownToRow parses empty section as empty string', () => {
    const md = `---\nid: 1\n---\n\n# body\n`;
    const row = markdownToRow(md);
    expect(row.body).toBe('');
  });
});

// ─── Body-header escaping (§4.4) ─────────────────────────────────────────────

describe('body-header escaping (§4.4)', () => {
  it('escapes lines that look like section headers in body content', () => {
    const row = { id: 1, content: 'intro\n# body\nmore text' };
    const md = rowToMarkdown(row, ['content'], ['id', 'content']);
    expect(md).toContain('\\# body');
    expect(md).not.toMatch(/\n# body\n/);
  });

  it('round-trips body content containing section-header-like lines', () => {
    const original = 'intro\n# body\n# title\nconclusion';
    const md = rowToMarkdown({ id: 1, content: original }, ['content'], ['id', 'content']);
    const row = markdownToRow(md);
    expect(row.content).toBe(original);
  });

  it('does not escape non-identifier headings', () => {
    // "# 123" is not a valid identifier heading (starts with digit)
    const original = '# 123 numeric';
    const md = rowToMarkdown({ id: 1, content: original }, ['content'], ['id', 'content']);
    expect(md).not.toContain('\\# 123 numeric');
    const row = markdownToRow(md);
    expect(row.content).toBe(original);
  });
});

// ─── Unicode slug transliteration (§4.3) ─────────────────────────────────────

describe('unicode slug transliteration (§4.3)', () => {
  it('transliterates Czech diacritics', () => {
    expect(makeSlug('Příliš žluťoučký kůň')).toBe('prilis-zlutoucky-kun');
  });

  it('transliterates German umlauts', () => {
    expect(makeSlug('Über München')).toBe('uber-munchen');
  });

  it('handles pure ASCII correctly', () => {
    expect(makeSlug('Hello World')).toBe('hello-world');
  });

  it('produces slug from row with unicode name column', async () => {
    const tmpdir = tmp();
    try {
      const dbPath = path.join(tmpdir, 'src.db');
      const out = path.join(tmpdir, 'out');
      const db = new Database(dbPath);
      db.exec(`CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT)`);
      db.prepare('INSERT INTO people VALUES (?, ?)').run(1, 'Příliš žluťoučký kůň');
      db.close();
      await exportDb({ db: dbPath, out });
      const files = fs.readdirSync(path.join(out, 'data', 'people'))
        .filter((f) => f !== '_index.md');
      expect(files[0]).toMatch(/prilis-zlutoucky-kun/);
    } finally {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
  });
});

// ─── Slug deduplication with short hash (§4.3) ────────────────────────────────

describe('slug deduplication (§4.3)', () => {
  it('appends short hash on collision', () => {
    const used = new Set<string>();
    const s1 = uniqueSlug('alice', used, 1);
    const s2 = uniqueSlug('alice', used, 2);
    expect(s1).toBe('alice');
    expect(s2).toMatch(/^alice-[0-9a-f]{6}$/);
  });

  it('produces different hashes for different source values', () => {
    const used = new Set<string>();
    uniqueSlug('alice', used, 1);
    const s2 = uniqueSlug('alice', used, 2);
    const s3 = uniqueSlug('alice', used, 3);
    expect(s2).not.toBe(s3);
  });

  it('same source value always produces same hash (deterministic)', () => {
    const u1 = new Set<string>();
    uniqueSlug('alice', u1, 99);
    const slug1 = uniqueSlug('alice', u1, 99);

    const u2 = new Set<string>();
    uniqueSlug('alice', u2, 99);
    const slug2 = uniqueSlug('alice', u2, 99);

    expect(slug1).toBe(slug2);
  });
});

// ─── padWidth formula (§4.3) ──────────────────────────────────────────────────

describe('padWidth (§4.3)', () => {
  it('returns minimum 4 for small IDs', () => {
    expect(padWidth(1)).toBe(4);
    expect(padWidth(9)).toBe(4);
    expect(padWidth(99)).toBe(4);
    expect(padWidth(999)).toBe(4);
  });

  it('returns 5 for IDs up to 9999', () => {
    expect(padWidth(1000)).toBe(4); // ceil(log10(1000))+1 = 3+1 = 4, still min 4
    expect(padWidth(9999)).toBe(5); // ceil(log10(9999))+1 = 4+1 = 5
    expect(padWidth(10000)).toBe(5); // ceil(log10(10000))+1 = 4+1 = 5
  });

  it('returns 6 for IDs 10001-99999', () => {
    expect(padWidth(10001)).toBe(6); // ceil(log10(10001))+1 = 5+1 = 6
    expect(padWidth(99999)).toBe(6);
  });

  it('falls back to 4 for invalid inputs', () => {
    expect(padWidth(0)).toBe(4);
    expect(padWidth(-1)).toBe(4);
    expect(padWidth(NaN)).toBe(4);
  });
});

// ─── Column mapping file (§4.2) ───────────────────────────────────────────────

describe('_schema column mapping (§4.2)', () => {
  let tmpdir: string;

  beforeEach(() => { tmpdir = tmp(); });
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }); });

  it('writes _schema/<table>.columns.json on export', async () => {
    const dbPath = path.join(tmpdir, 'src.db');
    const out = path.join(tmpdir, 'out');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, body TEXT)`);
    db.prepare('INSERT INTO posts VALUES (?, ?, ?)').run(1, 'Hi', 'x'.repeat(300));
    db.close();

    await exportDb({ db: dbPath, out });

    const mappingPath = path.join(out, '_schema', 'posts.columns.json');
    expect(fs.existsSync(mappingPath)).toBe(true);

    const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    expect(mapping.bodyColumns).toContain('body');
    expect(mapping.displayColumn).toBe('title');
  });
});

// ─── Round-trip idempotency (§5.3) ────────────────────────────────────────────

describe('round-trip idempotency (§5.3)', () => {
  let tmpdir: string;

  beforeEach(() => { tmpdir = tmp(); });
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }); });

  it('export → import → export produces zero diff on data/ and _schema/', async () => {
    const dbPath = path.join(tmpdir, 'src.db');
    const out1 = path.join(tmpdir, 'out1');
    const out2 = path.join(tmpdir, 'out2');
    const outDb = path.join(tmpdir, 'imp.db');

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        bio TEXT
      )
    `);
    const longBio = 'Bio: Alice has been with the company since 2019.\n'.repeat(6);
    db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(1, 'Alice', 'alice@example.com', longBio);
    db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(2, 'Bob', null, null);
    db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(
      3,
      'Příliš',
      'p@example.com',
      'Short bio with: colon and #hash'
    );
    db.close();

    await exportDb({ db: dbPath, out: out1 });
    await importMd({ md: out1, out: outDb });
    await exportDb({ db: outDb, out: out2 });

    // Compare data/ and _schema/ between the two exports
    const a = readTree(path.join(out1));
    const b = readTree(path.join(out2));

    const aTracked = Object.fromEntries(
      Object.entries(a).filter(([k]) => k.startsWith('data/') || k.startsWith('_schema/'))
    );
    const bTracked = Object.fromEntries(
      Object.entries(b).filter(([k]) => k.startsWith('data/') || k.startsWith('_schema/'))
    );

    expect(Object.keys(aTracked).sort()).toEqual(Object.keys(bTracked).sort());
    for (const [k, v] of Object.entries(aTracked)) {
      expect(bTracked[k]).toBe(v);
    }
  });

  it('validateRoundTrip passes for a well-formed export', async () => {
    const dbPath = path.join(tmpdir, 'src.db');
    const out = path.join(tmpdir, 'out');

    const db = new Database(dbPath);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, notes TEXT)`);
    db.prepare('INSERT INTO t VALUES (?, ?, ?)').run(1, 'Alice', 'x'.repeat(300));
    db.prepare('INSERT INTO t VALUES (?, ?, ?)').run(2, 'Bob', null);
    db.close();

    await exportDb({ db: dbPath, out });
    const result = await validateRoundTrip(out);

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.rowsCompared).toBe(2);
  });
});
