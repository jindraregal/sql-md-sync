import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SyncConfig, RawSyncConfig, RawTableConfig, TableConfig } from './types.js';

const CONFIG_FILE = '.sqlmdsync.json';

export function defaultConfig(): SyncConfig {
  return {
    version: 1,
    largeTextThreshold: 200,
    tables: {},
    schemaFingerprint: '',
  };
}

function rawTableToInternal(raw: RawTableConfig, pk: string): TableConfig {
  return {
    pk,
    bodyColumns: raw.body_columns ?? [],
    displayColumn: raw.display_column,
    largeTextThreshold: raw.large_text_threshold,
    excludeColumns: raw.exclude_columns,
  };
}

function internalTableToRaw(t: TableConfig): RawTableConfig {
  const raw: RawTableConfig = {
    body_columns: t.bodyColumns,
  };
  if (t.displayColumn !== undefined) raw.display_column = t.displayColumn;
  if (t.largeTextThreshold !== undefined) raw.large_text_threshold = t.largeTextThreshold;
  if (t.excludeColumns !== undefined) raw.exclude_columns = t.excludeColumns;
  return raw;
}

function rawToInternal(raw: RawSyncConfig): SyncConfig {
  const tables: Record<string, TableConfig> = {};
  for (const [name, rt] of Object.entries(raw.tables ?? {})) {
    tables[name] = rawTableToInternal(rt, '');
  }
  return {
    version: raw.version,
    largeTextThreshold: 200,
    tables,
    schemaFingerprint: raw.schema_fingerprint ?? '',
    dbPath: raw.db_path,
    dataDir: raw.data_dir,
    schemaDir: raw.schema_dir,
    blobEncoding: raw.blob_encoding,
    commitTemplate: raw.commit_template,
  };
}

function internalToRaw(config: SyncConfig): RawSyncConfig {
  const tables: Record<string, RawTableConfig> = {};
  for (const [name, t] of Object.entries(config.tables)) {
    tables[name] = internalTableToRaw(t);
  }
  const raw: RawSyncConfig = {
    version: config.version,
    tables,
    schema_fingerprint: config.schemaFingerprint,
  };
  if (config.dbPath) raw.db_path = config.dbPath;
  if (config.dataDir) raw.data_dir = config.dataDir;
  if (config.schemaDir) raw.schema_dir = config.schemaDir;
  if (config.blobEncoding) raw.blob_encoding = config.blobEncoding;
  if (config.commitTemplate) raw.commit_template = config.commitTemplate;
  return raw;
}

export function readConfig(dir: string): SyncConfig | null {
  const p = path.join(dir, CONFIG_FILE);
  if (!fs.existsSync(p)) return null;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as RawSyncConfig;
  return rawToInternal(raw);
}

export function writeConfig(dir: string, config: SyncConfig): void {
  const p = path.join(dir, CONFIG_FILE);
  const raw = internalToRaw(config);
  fs.writeFileSync(p, JSON.stringify(raw, null, 2) + '\n');
}

export function fingerprintSchema(schemaSql: string): string {
  const hash = crypto.createHash('sha256').update(schemaSql).digest('hex');
  return `sha256:${hash}`;
}
