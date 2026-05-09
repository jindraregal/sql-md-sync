import { describe, it, expect } from 'vitest';
import { generateCommitMessage } from '../src/commit.js';

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
});
