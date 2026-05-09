import fs from 'fs';
import path from 'path';
import { defaultConfig, writeConfig } from './config.js';

export interface InitOptions {
  dir: string;
  dbPath?: string;
}

export async function init(opts: InitOptions): Promise<void> {
  const { dir, dbPath } = opts;
  fs.mkdirSync(dir, { recursive: true });

  const configPath = path.join(dir, '.sqlmdsync.json');
  if (fs.existsSync(configPath)) {
    throw new Error(`.sqlmdsync.json already exists in ${dir}`);
  }

  const cfg = defaultConfig();
  if (dbPath) {
    (cfg as { dbPath?: string }).dbPath = dbPath;
  }
  writeConfig(dir, cfg);

  // Seed empty layout
  fs.mkdirSync(path.join(dir, '_schema'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });

  // Seed .gitattributes for predictable Markdown line endings
  const gitattrs = path.join(dir, '.gitattributes');
  if (!fs.existsSync(gitattrs)) {
    fs.writeFileSync(
      gitattrs,
      `*.md text eol=lf\n*.sql text eol=lf\n*.json text eol=lf\n*.bin binary\n`
    );
  }

  console.log(`Initialized sql-md-sync at ${dir}`);
}
