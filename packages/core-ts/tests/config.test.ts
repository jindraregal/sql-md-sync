import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readConfig, writeConfig, defaultConfig, fingerprintSchema } from '../src/config.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sql-md-sync-config-'));
}

describe('config: snake_case JSON round-trip', () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = tmpDir();
  });
  afterEach(() => fs.rmSync(tmpdir, { recursive: true }));

  it('returns null when no config file exists', () => {
    expect(readConfig(tmpdir)).toBeNull();
  });

  it('writes and reads back minimal config', () => {
    const config = defaultConfig();
    writeConfig(tmpdir, config);

    const raw = JSON.parse(fs.readFileSync(path.join(tmpdir, '.sqlmdsync.json'), 'utf8'));
    expect(raw.version).toBe(1);
    // snake_case keys
    expect(raw).not.toHaveProperty('largeTextThreshold');
    expect(raw).toHaveProperty('schema_fingerprint');

    const read = readConfig(tmpdir)!;
    expect(read.version).toBe(1);
    expect(read.schemaFingerprint).toBe('');
  });

  it('writes and reads full config with all optional fields', () => {
    const config = defaultConfig();
    config.dbPath = './data.db';
    config.dataDir = './data';
    config.schemaDir = './_schema';
    config.blobEncoding = 'base64_sidecar';
    config.commitTemplate = 'data({table}): {summary}';
    config.schemaFingerprint = 'sha256:abc123';
    config.tables['users'] = {
      pk: 'id',
      bodyColumns: ['bio'],
      displayColumn: 'email',
      largeTextThreshold: 300,
      excludeColumns: ['secret'],
    };

    writeConfig(tmpdir, config);

    const raw = JSON.parse(fs.readFileSync(path.join(tmpdir, '.sqlmdsync.json'), 'utf8'));
    expect(raw.db_path).toBe('./data.db');
    expect(raw.data_dir).toBe('./data');
    expect(raw.schema_dir).toBe('./_schema');
    expect(raw.blob_encoding).toBe('base64_sidecar');
    expect(raw.commit_template).toBe('data({table}): {summary}');
    expect(raw.tables.users.body_columns).toEqual(['bio']);
    expect(raw.tables.users.display_column).toBe('email');
    expect(raw.tables.users.large_text_threshold).toBe(300);
    expect(raw.tables.users.exclude_columns).toEqual(['secret']);

    const read = readConfig(tmpdir)!;
    expect(read.dbPath).toBe('./data.db');
    expect(read.dataDir).toBe('./data');
    expect(read.schemaDir).toBe('./_schema');
    expect(read.blobEncoding).toBe('base64_sidecar');
    expect(read.commitTemplate).toBe('data({table}): {summary}');
    expect(read.schemaFingerprint).toBe('sha256:abc123');
    expect(read.tables['users'].bodyColumns).toEqual(['bio']);
    expect(read.tables['users'].displayColumn).toBe('email');
    expect(read.tables['users'].largeTextThreshold).toBe(300);
    expect(read.tables['users'].excludeColumns).toEqual(['secret']);
  });

  it('fingerprintSchema produces sha256: prefixed string', () => {
    const fp = fingerprintSchema('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('handles config with tables but no optional table fields', () => {
    const config = defaultConfig();
    config.tables['posts'] = { pk: 'id', bodyColumns: [] };
    writeConfig(tmpdir, config);

    const raw = JSON.parse(fs.readFileSync(path.join(tmpdir, '.sqlmdsync.json'), 'utf8'));
    expect(raw.tables.posts.display_column).toBeUndefined();
    expect(raw.tables.posts.large_text_threshold).toBeUndefined();
    expect(raw.tables.posts.exclude_columns).toBeUndefined();

    const read = readConfig(tmpdir)!;
    expect(read.tables['posts'].displayColumn).toBeUndefined();
    expect(read.tables['posts'].largeTextThreshold).toBeUndefined();
  });
});
