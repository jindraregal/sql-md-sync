import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { installHook } from '../src/hooks.js';
import { init } from '../src/init.js';

describe('install-hook command', () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-hook-'));
    execSync('git init', { cwd: tmpdir, stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it('creates pre-commit hook with shebang', async () => {
    await init({ dir: tmpdir, dbPath: './test.db' });
    installHook({ dir: tmpdir });
    const hookFile = path.join(tmpdir, '.git', 'hooks', 'pre-commit');
    expect(fs.existsSync(hookFile)).toBe(true);
    const content = fs.readFileSync(hookFile, 'utf8');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('sql-md-sync export');
    expect(content).toContain('test.db');
  });

  it('hook file is executable (unix only)', async () => {
    await init({ dir: tmpdir, dbPath: './test.db' });
    installHook({ dir: tmpdir });
    const hookFile = path.join(tmpdir, '.git', 'hooks', 'pre-commit');
    const stat = fs.statSync(hookFile);
    if (process.platform !== 'win32') {
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    } else {
      expect(fs.existsSync(hookFile)).toBe(true);
    }
  });

  it('throws when not in a git repo', () => {
    const noGit = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
    try {
      expect(() => installHook({ dir: noGit, db: './foo.db' })).toThrow('git repository');
    } finally {
      fs.rmSync(noGit, { recursive: true, force: true });
    }
  });

  it('throws when no db path is configured or provided', async () => {
    await init({ dir: tmpdir });
    expect(() => installHook({ dir: tmpdir })).toThrow('No database path');
  });

  it('accepts db path override via opts.db', async () => {
    await init({ dir: tmpdir });
    installHook({ dir: tmpdir, db: './override.db' });
    const hookFile = path.join(tmpdir, '.git', 'hooks', 'pre-commit');
    const content = fs.readFileSync(hookFile, 'utf8');
    expect(content).toContain('override.db');
  });

  it('appends to existing hook that does not mention sql-md-sync', async () => {
    await init({ dir: tmpdir, dbPath: './test.db' });
    const hookFile = path.join(tmpdir, '.git', 'hooks', 'pre-commit');
    fs.mkdirSync(path.dirname(hookFile), { recursive: true });
    fs.writeFileSync(hookFile, '#!/bin/sh\necho "existing hook"\n');
    installHook({ dir: tmpdir });
    const content = fs.readFileSync(hookFile, 'utf8');
    expect(content).toContain('existing hook');
    expect(content).toContain('sql-md-sync export');
  });

  it('is idempotent: re-running with the same db is a no-op', async () => {
    await init({ dir: tmpdir, dbPath: './test.db' });
    installHook({ dir: tmpdir });
    const hookFile = path.join(tmpdir, '.git', 'hooks', 'pre-commit');
    const first = fs.readFileSync(hookFile, 'utf8');
    installHook({ dir: tmpdir });
    const second = fs.readFileSync(hookFile, 'utf8');
    expect(second).toBe(first);
    // The managed block must appear exactly once.
    expect(second.match(/>>> sql-md-sync hook >>>/g)?.length).toBe(1);
  });

  it('replaces the managed block when re-run with a different db path', async () => {
    await init({ dir: tmpdir, dbPath: './first.db' });
    installHook({ dir: tmpdir });
    installHook({ dir: tmpdir, db: './second.db' });
    const hookFile = path.join(tmpdir, '.git', 'hooks', 'pre-commit');
    const content = fs.readFileSync(hookFile, 'utf8');
    expect(content).toContain('second.db');
    expect(content).not.toContain('first.db');
    // Sentinel pair must appear exactly once.
    expect(content.match(/>>> sql-md-sync hook >>>/g)?.length).toBe(1);
    expect(content.match(/<<< sql-md-sync hook <<</g)?.length).toBe(1);
  });

  it('preserves user content around the managed block when updating', async () => {
    await init({ dir: tmpdir, dbPath: './test.db' });
    installHook({ dir: tmpdir });
    const hookFile = path.join(tmpdir, '.git', 'hooks', 'pre-commit');
    const original = fs.readFileSync(hookFile, 'utf8');
    // Add user lines before and after the managed block
    const augmented = original.replace(
      '# >>> sql-md-sync hook >>>',
      'echo "user-before"\n# >>> sql-md-sync hook >>>'
    );
    fs.writeFileSync(hookFile, augmented + 'echo "user-after"\n');

    installHook({ dir: tmpdir, db: './updated.db' });
    const after = fs.readFileSync(hookFile, 'utf8');
    expect(after).toContain('echo "user-before"');
    expect(after).toContain('echo "user-after"');
    expect(after).toContain('updated.db');
  });

  it('migrates a legacy (no-sentinel) snippet on next install', async () => {
    await init({ dir: tmpdir, dbPath: './test.db' });
    const hookFile = path.join(tmpdir, '.git', 'hooks', 'pre-commit');
    fs.mkdirSync(path.dirname(hookFile), { recursive: true });
    // Reproduce exactly what v0.1.1 wrote
    fs.writeFileSync(
      hookFile,
      [
        '#!/bin/sh',
        'set -e',
        '# sql-md-sync: export db before each commit',
        'npx --yes sql-md-sync export --db "./test.db" --out .',
        'git add data/ _schema/ .sqlmdsync.json',
        '',
      ].join('\n')
    );

    installHook({ dir: tmpdir });
    const content = fs.readFileSync(hookFile, 'utf8');
    expect(content).toContain('# >>> sql-md-sync hook >>>');
    // Legacy comment must be gone (no duplicate snippets left behind)
    expect(content).not.toContain('# sql-md-sync: export db before each commit');
    // Only one npx export line remains
    expect(content.match(/npx --yes sql-md-sync export/g)?.length).toBe(1);
  });
});
