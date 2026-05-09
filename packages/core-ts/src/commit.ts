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
  // field-level detail for single-file diffs: table -> slug -> changed field name
  fieldChange?: { table: string; slug: string; field: string };
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
    const stderr = err.stderr ? err.stderr.toString() : (err.message ?? '');
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  }
}

// Parse a unified diff hunk and return the set of changed YAML frontmatter keys.
// Returns null if we can't determine field-level changes (e.g. body section changed).
// Exported for testing.
export function detectChangedFields(patch: string): string[] | null {
  const lines = patch.split('\n');
  const changedKeys = new Set<string>();
  let inFrontmatter = false;
  let frontmatterStarted = false;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (line === '---' || line === '+---') {
      inFrontmatter = true;
      frontmatterStarted = true;
      continue;
    }
    if (inFrontmatter && (line === '---' || line === '+---' || line === ' ---')) {
      inFrontmatter = false;
      continue;
    }

    // Changes outside frontmatter (body section changes) mean we can't summarize to a field
    if (
      !inFrontmatter &&
      frontmatterStarted &&
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      return null;
    }

    if (
      inFrontmatter &&
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      const content = line.slice(1);
      const keyMatch = /^([a-zA-Z_][a-zA-Z0-9_]*):\s/.exec(content);
      if (keyMatch) {
        changedKeys.add(keyMatch[1]);
      }
    }
  }

  return changedKeys.size > 0 ? [...changedKeys] : null;
}

// For a single modified file, try to detect which single field changed.
// Returns field name if exactly one YAML frontmatter field changed, else null.
function detectSingleFieldChange(filePath: string, cwd: string): string | null {
  try {
    // Limit patch size to avoid OOM on huge blobs
    const patch = runGit(['diff', '--cached', '-p', '-U3', '--', filePath], cwd);
    if (patch.length > 500_000) return null; // too large to parse safely

    const fields = detectChangedFields(patch);
    if (fields && fields.length === 1) return fields[0];
    return null;
  } catch {
    return null;
  }
}

export function readStagedDiff(repoDir: string): CommitSummary {
  const out = runGit(['diff', '--cached', '--name-status'], repoDir);
  const tables: Record<string, TableChange> = {};
  const schemaChanges: Record<string, 'added' | 'modified' | 'deleted'> = {};

  // Collect raw file changes
  const modifiedDataFiles: { table: string; slug: string; file: string }[] = [];

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0];
    const file = parts[parts.length - 1];

    const schemaMatch = /^_?schema\/([^/]+)\.sql$/.exec(file);
    if (schemaMatch) {
      const table = schemaMatch[1];
      schemaChanges[table] = status.startsWith('A')
        ? 'added'
        : status.startsWith('D')
          ? 'deleted'
          : 'modified';
      continue;
    }

    const dataMatch = /^data\/([^/]+)\/(.+)$/.exec(file);
    if (!dataMatch) continue;
    const [, table, fname] = dataMatch;
    if (fname === '_index.md') continue;
    if (!fname.endsWith('.md')) continue;

    if (!tables[table]) tables[table] = { added: [], modified: [], deleted: [] };
    const entry = path.basename(fname, '.md');
    if (status.startsWith('A')) tables[table].added.push(entry);
    else if (status.startsWith('D')) tables[table].deleted.push(entry);
    else {
      tables[table].modified.push(entry);
      modifiedDataFiles.push({ table, slug: entry, file });
    }
  }

  const summary: CommitSummary = { tables, schemaChanges };

  // Attempt single-field detection when exactly one row file is modified and nothing else changed
  const tableNames = Object.keys(tables);
  if (
    modifiedDataFiles.length === 1 &&
    tableNames.length === 1 &&
    tables[tableNames[0]].added.length === 0 &&
    tables[tableNames[0]].deleted.length === 0 &&
    Object.keys(schemaChanges).length === 0
  ) {
    const { table, slug, file } = modifiedDataFiles[0];
    const field = detectSingleFieldChange(file, repoDir);
    if (field) {
      summary.fieldChange = { table, slug, field };
    }
  }

  return summary;
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

  for (const name of schemaNames) {
    lines.push(`schema(${name}): ${summary.schemaChanges[name]}`);
  }

  if (tableNames.length === 0 && lines.length > 0) {
    return lines.join('\n');
  }

  // Single-field change: emit `data(table): modify slug.field`
  if (summary.fieldChange && tableNames.length === 1 && schemaNames.length === 0) {
    const { table, slug, field } = summary.fieldChange;
    return `data(${table}): modify ${slug}.${field}`;
  }

  // Single-row edge cases
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

  // Large change across many tables: summarize
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
