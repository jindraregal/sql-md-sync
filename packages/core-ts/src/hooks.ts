import fs from 'fs';
import path from 'path';
import { readConfig } from './config.js';

export interface InstallHookOptions {
  dir?: string;
  db?: string;
}

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

  const snippet = [
    '# sql-md-sync: export db before each commit',
    `npx --yes sql-md-sync export --db ${JSON.stringify(dbPath)} --out .`,
    'git add data/ _schema/ .sqlmdsync.json',
  ].join('\n');

  if (fs.existsSync(hookFile)) {
    const existing = fs.readFileSync(hookFile, 'utf8');
    if (existing.includes('sql-md-sync')) {
      throw new Error(
        'pre-commit hook already contains sql-md-sync. Edit .git/hooks/pre-commit manually to update it.'
      );
    }
    fs.appendFileSync(hookFile, '\n' + snippet + '\n');
  } else {
    fs.writeFileSync(hookFile, '#!/bin/sh\nset -e\n' + snippet + '\n');
    fs.chmodSync(hookFile, 0o755);
  }

  console.log(`Installed pre-commit hook at ${hookFile}`);
  console.log(`Every git commit will now export ${dbPath} to Markdown automatically.`);
}
