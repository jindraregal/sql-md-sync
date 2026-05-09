import { describe, it, expect } from 'vitest';
import { generateCommitMessage, detectChangedFields } from '../src/commit.js';

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
});
