import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { init } from '../src/init.js';
import { readConfig } from '../src/config.js';

describe('init command', () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-init-'));
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it('creates config and seed dirs', async () => {
    await init({ dir: tmpdir });
    expect(fs.existsSync(path.join(tmpdir, '.sqlmdsync.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpdir, '_schema'))).toBe(true);
    expect(fs.existsSync(path.join(tmpdir, 'data'))).toBe(true);
    expect(fs.existsSync(path.join(tmpdir, '.gitattributes'))).toBe(true);
  });

  it('records dbPath in config', async () => {
    await init({ dir: tmpdir, dbPath: './foo.db' });
    const cfg = readConfig(tmpdir);
    expect(cfg).not.toBeNull();
    expect((cfg as { dbPath?: string } | null)?.dbPath).toBe('./foo.db');
  });

  it('errors if config already exists', async () => {
    await init({ dir: tmpdir });
    await expect(init({ dir: tmpdir })).rejects.toThrow();
  });
});
