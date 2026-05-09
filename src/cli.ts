#!/usr/bin/env node
import { Command } from 'commander';
import { exportDb } from './export.js';
import { importMd } from './import.js';
import { validate } from './validate.js';
import { diff, formatDiff } from './diff.js';
import path from 'path';

const program = new Command();

program
  .name('sql-md-sync')
  .description('Bidirectional SQLite <-> Markdown sync for git-diffable database history')
  .version('0.1.0');

program
  .command('export')
  .description('Export SQLite database to Markdown tree')
  .requiredOption('--db <path>', 'Path to SQLite database')
  .requiredOption('--out <path>', 'Output directory for Markdown tree')
  .option('--force', 'Overwrite existing output')
  .action(async (opts) => {
    try {
      await exportDb({
        db: path.resolve(opts.db),
        out: path.resolve(opts.out),
        force: opts.force,
      });
    } catch (e) {
      console.error('Export failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('import')
  .description('Import Markdown tree to SQLite database')
  .requiredOption('--md <path>', 'Path to Markdown tree directory')
  .requiredOption('--out <path>', 'Output SQLite database path')
  .option('--force', 'Skip schema fingerprint check')
  .action(async (opts) => {
    try {
      await importMd({
        md: path.resolve(opts.md),
        out: path.resolve(opts.out),
        force: opts.force,
      });
    } catch (e) {
      console.error('Import failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Check Markdown tree for consistency')
  .argument('<dir>', 'Markdown tree directory')
  .action((dir) => {
    const result = validate(path.resolve(dir));
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.warn('WARN:', w);
    }
    if (result.errors.length > 0) {
      for (const e of result.errors) console.error('ERROR:', e);
      process.exit(1);
    }
    console.log('Validation passed.');
  });

program
  .command('diff')
  .description('Show what would change if you imported the Markdown tree now')
  .requiredOption('--md <path>', 'Markdown tree directory')
  .requiredOption('--db <path>', 'SQLite database to compare against')
  .action(async (opts) => {
    try {
      const results = await diff({
        md: path.resolve(opts.md),
        db: path.resolve(opts.db),
      });
      console.log(formatDiff(results));
    } catch (e) {
      console.error('Diff failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program.parse();
