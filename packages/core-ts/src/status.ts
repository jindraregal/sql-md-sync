import fs from 'fs';
import { readConfig, fingerprintSchema } from './config.js';
import { readSchemaFiles } from './schema.js';
import { diff, formatDiff } from './diff.js';

export interface StatusOptions {
  md: string;
  db: string;
}

export interface StatusReport {
  fingerprintMatch: boolean;
  driftSummary: string;
  hasDrift: boolean;
}

export async function status(opts: StatusOptions): Promise<StatusReport> {
  const { md, db } = opts;
  const config = readConfig(md);
  if (!config) {
    return {
      fingerprintMatch: false,
      driftSummary: `No .sqlmdsync.json in ${md}`,
      hasDrift: true,
    };
  }

  let fingerprintMatch = true;
  try {
    const schemas = readSchemaFiles(md);
    const combined = Object.values(schemas)
      .map((s) => s.trim() + ';\n')
      .join('');
    const fp = fingerprintSchema(combined.replace(/;\n;\n/g, ';\n'));
    fingerprintMatch = !config.schemaFingerprint || fp === config.schemaFingerprint;
  } catch {
    fingerprintMatch = false;
  }

  if (!fs.existsSync(db)) {
    return {
      fingerprintMatch,
      driftSummary: `DB not found at ${db}; export to create.`,
      hasDrift: true,
    };
  }

  const results = await diff({ md, db });
  return {
    fingerprintMatch,
    driftSummary: formatDiff(results),
    hasDrift: results.length > 0,
  };
}
