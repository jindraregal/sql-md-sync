#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import { execSync } from 'child_process';
import { exportDb } from './export.js';
import { importMd } from './import.js';
import { validate, validateRoundTrip } from './validate.js';
import { diff, formatDiff } from './diff.js';
import { init } from './init.js';
import { status as statusCmd } from './status.js';
import { generateCommitMessage, readStagedDiff } from './commit.js';
import { installHook } from './hooks.js';

const program = new Command();

program
  .name('sql-md-sync')
  .description('Bidirectional SQLite <-> Markdown sync for git-diffable database history')
  .version('0.1.0');

program
  .command('init')
  .description('Bootstrap a new sql-md-sync directory')
  .option('--db <path>', 'Path to seed database (recorded in config only)')
  .option('--dir <path>', 'Directory to initialize', '.')
  .action(async (opts) => {
    try {
      await init({ dir: path.resolve(opts.dir), dbPath: opts.db });
    } catch (e) {
      console.error('Init failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

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
  .option('--round-trip', 'Also run a round-trip parity check')
  .action(async (dir, opts) => {
    const target = path.resolve(dir);
    const result = opts.roundTrip ? await validateRoundTrip(target) : validate(target);
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

program
  .command('status')
  .description('Show drift between .db and Markdown tree')
  .requiredOption('--md <path>', 'Markdown tree directory')
  .requiredOption('--db <path>', 'SQLite database')
  .action(async (opts) => {
    try {
      const r = await statusCmd({
        md: path.resolve(opts.md),
        db: path.resolve(opts.db),
      });
      console.log(`Schema fingerprint match: ${r.fingerprintMatch ? 'yes' : 'no'}`);
      console.log(r.driftSummary);
      if (r.hasDrift) process.exit(2);
    } catch (e) {
      console.error('Status failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('commit')
  .description('Generate a commit message from staged Markdown changes (and stage if requested)')
  .option('--message <tpl>', 'Override template, e.g. "data({table}): {summary}"')
  .option('--stage', 'Stage changes under data/ and _schema/ before generating')
  .option('--repo <path>', 'Git repository root', '.')
  .option('--print', 'Only print the message; do not commit', false)
  .action((opts) => {
    const repo = path.resolve(opts.repo);
    if (opts.stage) {
      try {
        execSync('git add data _schema .sqlmdsync.json', { cwd: repo, stdio: 'inherit' });
      } catch {
        /* may fail if paths absent; continue */
      }
    }
    let summary;
    try {
      summary = readStagedDiff(repo);
    } catch (e) {
      console.error('Failed to read staged diff:', e instanceof Error ? e.message : e);
      process.exit(1);
      return;
    }
    const msg = generateCommitMessage(summary, opts.message);
    if (opts.print) {
      console.log(msg);
      return;
    }
    try {
      execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: repo, stdio: 'inherit' });
    } catch (e) {
      console.error('git commit failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program
  .command('install-hook')
  .description('Install a git pre-commit hook that auto-exports the database before every commit')
  .option('--db <path>', 'Path to SQLite database (overrides dbPath in .sqlmdsync.json)')
  .option('--dir <path>', 'Repository root', '.')
  .action((opts) => {
    try {
      installHook({ dir: path.resolve(opts.dir), db: opts.db });
    } catch (e) {
      console.error('install-hook failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });

program.parse();
