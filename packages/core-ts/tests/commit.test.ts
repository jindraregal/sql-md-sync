import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { generateCommitMessage, detectChangedFields, readStagedDiff } from '../src/commit.js';

describe('generateCommitMessage', () => {
  it('formats single table with mixed changes', () => {
    const msg = generateCommitMessage({
      tables: {
        users: { added: ['a', 'b', 'c'], modified: ['d'], deleted: [] },
      },
      schemaChanges: {},
    });
    expect(msg).toBe('data(users): add 3, modify 1');
  });

  it('detects single-row single-field modify', () => {
    const msg = generateCommitMessage({
      tables: { users: { added: [], modified: ['0001-alice'], deleted: [] } },
      schemaChanges: {},
    });
    expect(msg).toBe('data(users): modify 0001-alice');
  });

  it('groups multiple tables', () => {
    const msg = generateCommitMessage({
      tables: {
        users: { added: ['a'], modified: [], deleted: [] },
        posts: { added: [], modified: ['p1'], deleted: [] },
      },
      schemaChanges: {},
    });
    expect(msg).toContain('data(posts):');
    expect(msg).toContain('data(users):');
  });

  it('summarizes large changes across many tables', () => {
    const tables: Record<string, { added: string[]; modified: string[]; deleted: string[] }> = {};
    for (const t of ['a', 'b', 'c', 'd', 'e']) {
      tables[t] = {
        added: ['1', '2', '3', '4', '5'],
        modified: [],
        deleted: [],
      };
    }
    const msg = generateCommitMessage({ tables, schemaChanges: {} });
    expect(msg).toMatch(/data: \d+ change\(s\) across 5 tables/);
  });

  it('includes schema changes on their own line', () => {
    const msg = generateCommitMessage({
      tables: { users: { added: ['a'], modified: [], deleted: [] } },
      schemaChanges: { users: 'modified' },
    });
    expect(msg).toContain('schema(users): modified');
    expect(msg).toContain('data(users):');
  });

  it('honors custom template', () => {
    const msg = generateCommitMessage(
      {
        tables: { users: { added: ['a', 'b'], modified: [], deleted: [] } },
        schemaChanges: {},
      },
      'd[{table}]={summary}'
    );
    expect(msg).toBe('d[users]=add 2');
  });

  it('emits slug.field when fieldChange is provided', () => {
    const msg = generateCommitMessage({
      tables: { users: { added: [], modified: ['0001-alice'], deleted: [] } },
      schemaChanges: {},
      fieldChange: { table: 'users', slug: '0001-alice', field: 'email' },
    });
    expect(msg).toBe('data(users): modify 0001-alice.email');
  });

  it('ignores fieldChange when schema changes also present', () => {
    const msg = generateCommitMessage({
      tables: { users: { added: [], modified: ['0001-alice'], deleted: [] } },
      schemaChanges: { users: 'modified' },
      fieldChange: { table: 'users', slug: '0001-alice', field: 'email' },
    });
    // fieldChange suppressed because schema also changed
    expect(msg).toContain('schema(users): modified');
    expect(msg).toContain('data(users):');
    expect(msg).not.toContain('.email');
  });

  it('returns schema-only message when no data tables', () => {
    const msg = generateCommitMessage({
      tables: {},
      schemaChanges: { posts: 'added' },
    });
    expect(msg).toBe('schema(posts): added');
  });

  it('returns fallback when no changes staged', () => {
    const msg = generateCommitMessage({ tables: {}, schemaChanges: {} });
    expect(msg).toBe('data: no changes staged');
  });
});

describe('detectChangedFields', () => {
  it('returns null for empty patch', () => {
    expect(detectChangedFields('')).toBeNull();
  });

  it('detects single changed frontmatter field', () => {
    const patch = [
      '@@ -1,5 +1,5 @@',
      '---',
      '-email: alice@old.com',
      '+email: alice@new.com',
      ' name: Alice',
      '---',
    ].join('\n');
    const fields = detectChangedFields(patch);
    expect(fields).toEqual(['email']);
  });

  it('detects multiple changed frontmatter fields', () => {
    const patch = [
      '@@ -1,6 +1,6 @@',
      '---',
      '-email: alice@old.com',
      '+email: alice@new.com',
      '-name: Alice',
      '+name: Alicia',
      '---',
    ].join('\n');
    const fields = detectChangedFields(patch);
    expect(fields).toContain('email');
    expect(fields).toContain('name');
    expect(fields!.length).toBe(2);
  });

  it('returns null when body section changes', () => {
    const patch = [
      '@@ -1,4 +1,4 @@',
      '---',
      ' id: 1',
      '---',
      '',
      '# bio',
      '-Old bio text',
      '+New bio text',
    ].join('\n');
    const result = detectChangedFields(patch);
    expect(result).toBeNull();
  });

  it('handles a real git diff hunk where context lines have a space prefix', () => {
    // This is the shape `git diff --cached -p -U3` actually emits: every
    // unchanged line, including the `---` frontmatter delimiters, gets a
    // leading space.
    const patch = [
      'diff --git a/data/users/0001-alice.md b/data/users/0001-alice.md',
      'index 0000001..0000002 100644',
      '--- a/data/users/0001-alice.md',
      '+++ b/data/users/0001-alice.md',
      '@@ -1,5 +1,5 @@',
      ' ---',
      ' id: 1',
      '-email: alice@old.com',
      '+email: alice@new.com',
      ' name: Alice',
      ' ---',
    ].join('\n');
    const fields = detectChangedFields(patch);
    expect(fields).toEqual(['email']);
  });

  it('detects field changes even when only frontmatter delimiters use the space prefix', () => {
    const patch = [
      '@@ -1,6 +1,6 @@',
      ' ---',
      ' id: 1',
      '-status: draft',
      '+status: published',
      '-priority: 1',
      '+priority: 2',
      ' ---',
    ].join('\n');
    const fields = detectChangedFields(patch);
    expect(fields).toContain('status');
    expect(fields).toContain('priority');
    expect(fields!.length).toBe(2);
  });
});

describe('readStagedDiff: single field change end-to-end', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-commit-e2e-'));
    execSync('git init -q', { cwd: repo });
    execSync('git config user.email test@example.com', { cwd: repo });
    execSync('git config user.name Test', { cwd: repo });
    fs.mkdirSync(path.join(repo, 'data', 'users'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('produces fieldChange when one frontmatter key is edited in one file', () => {
    const file = path.join(repo, 'data', 'users', '0001-alice.md');
    fs.writeFileSync(
      file,
      ['---', 'id: 1', 'name: Alice', 'email: alice@old.com', '---', ''].join('\n')
    );
    execSync('git add .', { cwd: repo });
    execSync('git commit -q -m initial', { cwd: repo });

    fs.writeFileSync(
      file,
      ['---', 'id: 1', 'name: Alice', 'email: alice@new.com', '---', ''].join('\n')
    );
    execSync('git add .', { cwd: repo });

    const summary = readStagedDiff(repo);
    expect(summary.fieldChange).toEqual({ table: 'users', slug: '0001-alice', field: 'email' });
    const msg = generateCommitMessage(summary);
    expect(msg).toBe('data(users): modify 0001-alice.email');
  });
});
