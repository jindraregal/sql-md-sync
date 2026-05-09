import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SyncConfig } from './types.js';

const CONFIG_FILE = '.sqlmdsync.json';

export function defaultConfig(): SyncConfig {
  return {
    version: 1,
    largeTextThreshold: 200,
    tables: {},
    schemaFingerprint: '',
  };
}

export function readConfig(dir: string): SyncConfig | null {
  const p = path.join(dir, CONFIG_FILE);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as SyncConfig;
}

export function writeConfig(dir: string, config: SyncConfig): void {
  const p = path.join(dir, CONFIG_FILE);
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
}

export function fingerprintSchema(schemaSql: string): string {
  return crypto.createHash('sha256').update(schemaSql).digest('hex');
}
