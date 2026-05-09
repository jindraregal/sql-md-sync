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

  it('hook file is executable', async () => {
    await init({ dir: tmpdir, dbPath: './test.db' });
    installHook({ dir: tmpdir });
    const hookFile = path.join(tmpdir, '.git', 'hooks', 'pre-commit');
    const stat = fs.statSync(hookFile);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
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

  it('throws when hook already has sql-md-sync', async () => {
    await init({ dir: tmpdir, dbPath: './test.db' });
    installHook({ dir: tmpdir });
    expect(() => installHook({ dir: tmpdir })).toThrow('already contains sql-md-sync');
  });
});
