import fs from 'fs';
import path from 'path';
import { readConfig } from './config.js';

export interface InstallHookOptions {
  dir?: string;
  db?: string;
}

const HOOK_BEGIN = '# >>> sql-md-sync hook >>>';
const HOOK_END = '# <<< sql-md-sync hook <<<';

function findGitDir(start: string): string | null {
  let cur = path.resolve(start);
  for (let i = 0; i < 20; i++) {
    const candidate = path.join(cur, '.git');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

function buildManagedBlock(dbPath: string): string {
  return [
    HOOK_BEGIN,
    '# managed by sql-md-sync install-hook; re-run with --db <path> to update',
    `npx --yes sql-md-sync export --db ${JSON.stringify(dbPath)} --out .`,
    'git add data/ _schema/ .sqlmdsync.json',
    HOOK_END,
  ].join('\n');
}

// Pre-v0.1.2 install-hook wrote a 3-line snippet without sentinels. Strip it
// on upgrade so the new sentinel-bracketed block can take over cleanly.
function stripLegacySnippet(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (
      lines[i] === '# sql-md-sync: export db before each commit' &&
      i + 2 < lines.length &&
      lines[i + 1].startsWith('npx --yes sql-md-sync export') &&
      lines[i + 2].startsWith('git add data/')
    ) {
      i += 3;
      // Also drop a trailing blank line introduced by the old appendFileSync path
      if (i < lines.length && lines[i] === '') i++;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join('\n');
}

export function installHook(opts: InstallHookOptions = {}): void {
  const dir = path.resolve(opts.dir ?? process.cwd());

  const gitDir = findGitDir(dir);
  if (!gitDir) throw new Error('Not inside a git repository. Run git init first.');

  const config = readConfig(dir);
  const dbPath = opts.db ?? config?.dbPath;
  if (!dbPath) {
    throw new Error(
      'No database path found. Either pass --db <path> or run: sql-md-sync init --db <path>'
    );
  }

  const hooksDir = path.join(gitDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookFile = path.join(hooksDir, 'pre-commit');

  const managedBlock = buildManagedBlock(dbPath);

  let updated: string;
  let action: 'installed' | 'updated';

  if (!fs.existsSync(hookFile)) {
    updated = '#!/bin/sh\nset -e\n' + managedBlock + '\n';
    action = 'installed';
  } else {
    let existing = fs.readFileSync(hookFile, 'utf8');
    const beginIdx = existing.indexOf(HOOK_BEGIN);
    const endIdx = existing.indexOf(HOOK_END);

    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
      // Replace the existing managed block in place.
      const before = existing.slice(0, beginIdx);
      const after = existing.slice(endIdx + HOOK_END.length);
      updated = before + managedBlock + after;
      action = 'updated';
    } else {
      // Drop any legacy snippet first so we don't leave duplicates behind.
      existing = stripLegacySnippet(existing);
      const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
      updated = existing + sep + managedBlock + '\n';
      action = 'installed';
    }
  }

  fs.writeFileSync(hookFile, updated);
  try {
    fs.chmodSync(hookFile, 0o755);
  } catch {
    /* non-unix or restricted fs */
  }

  console.log(`${action === 'installed' ? 'Installed' : 'Updated'} pre-commit hook at ${hookFile}`);
  console.log(`Every git commit will now export ${dbPath} to Markdown automatically.`);
}
