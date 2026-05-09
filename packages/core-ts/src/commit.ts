import { execSync } from 'child_process';
import path from 'path';

export interface TableChange {
  added: string[];
  modified: string[];
  deleted: string[];
}

export interface CommitSummary {
  tables: Record<string, TableChange>;
  schemaChanges: Record<string, 'added' | 'modified' | 'deleted'>;
}

function runGit(args: string[], cwd: string): string {
  try {
    return execSync(`git ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const stderr = err.stderr ? err.stderr.toString() : err.message ?? '';
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  }
}

export function readStagedDiff(repoDir: string): CommitSummary {
  const out = runGit(['diff', '--cached', '--name-status'], repoDir);
  const tables: Record<string, TableChange> = {};
  const schemaChanges: Record<string, 'added' | 'modified' | 'deleted'> = {};

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0];
    const file = parts[parts.length - 1];

    // schema/<table>.sql or _schema/<table>.sql
    const schemaMatch = /^_?schema\/([^/]+)\.sql$/.exec(file);
    if (schemaMatch) {
      const table = schemaMatch[1];
      schemaChanges[table] =
        status.startsWith('A') ? 'added' : status.startsWith('D') ? 'deleted' : 'modified';
      continue;
    }

    const dataMatch = /^data\/([^/]+)\/(.+)$/.exec(file);
    if (!dataMatch) continue;
    const [, table, fname] = dataMatch;
    if (fname === '_index.md') continue;
    if (!fname.endsWith('.md')) continue; // ignore blob sidecars (counted via .md)

    if (!tables[table]) tables[table] = { added: [], modified: [], deleted: [] };
    const entry = path.basename(fname, '.md');
    if (status.startsWith('A')) tables[table].added.push(entry);
    else if (status.startsWith('D')) tables[table].deleted.push(entry);
    else tables[table].modified.push(entry);
  }

  return { tables, schemaChanges };
}

function summarize(t: TableChange): string {
  const parts: string[] = [];
  if (t.added.length) parts.push(`add ${t.added.length}`);
  if (t.modified.length) parts.push(`modify ${t.modified.length}`);
  if (t.deleted.length) parts.push(`delete ${t.deleted.length}`);
  return parts.join(', ') || 'no changes';
}

export function generateCommitMessage(summary: CommitSummary, template?: string): string {
  const tableNames = Object.keys(summary.tables).sort();
  const schemaNames = Object.keys(summary.schemaChanges).sort();

  const lines: string[] = [];

  // Schema changes get their own line(s) first
  for (const name of schemaNames) {
    lines.push(`schema(${name}): ${summary.schemaChanges[name]}`);
  }

  if (tableNames.length === 0 && lines.length > 0) {
    return lines.join('\n');
  }

  // Single-row, single-table edge case
  if (tableNames.length === 1) {
    const name = tableNames[0];
    const ch = summary.tables[name];
    const total = ch.added.length + ch.modified.length + ch.deleted.length;
    if (total === 1 && ch.modified.length === 1) {
      lines.push(`data(${name}): modify ${ch.modified[0]}`);
      return lines.join('\n');
    }
    if (total === 1 && ch.added.length === 1) {
      lines.push(`data(${name}): add ${ch.added[0]}`);
      return lines.join('\n');
    }
    if (total === 1 && ch.deleted.length === 1) {
      lines.push(`data(${name}): delete ${ch.deleted[0]}`);
      return lines.join('\n');
    }
  }

  // Many tables, large change: summarize
  const totalRows = tableNames.reduce((acc, t) => {
    const ch = summary.tables[t];
    return acc + ch.added.length + ch.modified.length + ch.deleted.length;
  }, 0);
  if (tableNames.length > 3 && totalRows > 20) {
    lines.push(`data: ${totalRows} change(s) across ${tableNames.length} tables`);
    return lines.join('\n');
  }

  for (const name of tableNames) {
    const t = summary.tables[name];
    const formatted = template
      ? template.replace('{table}', name).replace('{summary}', summarize(t))
      : `data(${name}): ${summarize(t)}`;
    lines.push(formatted);
  }

  return lines.join('\n') || 'data: no changes staged';
}
