# sql-md-sync

> Every git commit automatically snapshots your SQLite database as readable Markdown. Diff rows like code, review data in PRs, use Git as your single source of truth.

[![CI](https://github.com/jindraregal/sql-md-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/jindraregal/sql-md-sync/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/sql-md-sync.svg)](https://www.npmjs.com/package/sql-md-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Setup

Three commands, then forget about it.

### Point at an existing .db

```bash
npm install -g sql-md-sync

sql-md-sync init --db ./data.db   # writes .sqlmdsync.json
sql-md-sync export --db ./data.db --out .
sql-md-sync install-hook          # wires up git pre-commit hook
git add . && git commit -m "init: add sql-md-sync"
```

That's it. Every `git commit` now auto-exports `data.db` to Markdown and stages the snapshot. Nothing else to configure.

### New project

```bash
npm install -g sql-md-sync
sql-md-sync init --db ./data.db
# ...create data.db...
sql-md-sync install-hook
```

## What you get

```
your-project/
├── .sqlmdsync.json         # config (check this in)
├── _schema/
│   ├── users.sql           # CREATE TABLE statements
│   └── posts.sql
└── data/
    ├── users/
    │   ├── 0001-alice.md   # one file per row
    │   └── 0002-bob.md
    └── posts/
        └── 0001-hello-world.md
```

Each row is a plain file. Git diffs show exactly which fields changed. PRs show data changes alongside code. AI agents can read and edit individual rows without SQL tooling.

## Why bother vs `sqlite3 .dump`

A `.dump` is one giant block of `INSERT` statements — unreadable in a diff, unreadable by an LLM, and always a full rewrite. `sql-md-sync` gives you one file per row, incremental exports (only changed rows are written), and real SQLite at runtime via `import`.

## Useful commands

| Command | What it does |
|---|---|
| `export --db <db> --out <dir>` | Snapshot db to Markdown |
| `import --md <dir> --out <db>` | Rebuild db from Markdown |
| `validate <dir> --round-trip` | Check consistency; use in CI |
| `status --md <dir> --db <db>` | Show drift between db and tree |
| `commit --stage` | Auto-generate commit message |
| `install-hook` | Wire up pre-commit auto-export |

## CI validation

```yaml
- run: sql-md-sync validate . --round-trip
```

Rebuilds a temp database from the Markdown tree, re-exports it, and diffs. Fails CI if anything is out of sync.

## Feature support

| Feature | | Notes |
|---|---|---|
| Export SQLite to Markdown | ✅ | row-per-file, YAML frontmatter |
| Import Markdown to SQLite | ✅ | byte-stable round-trip |
| Round-trip validation | ✅ | `validate --round-trip` rebuilds a temp DB and diffs |
| Git pre-commit auto-sync | ✅ | `install-hook` writes `.git/hooks/pre-commit` |
| Auto commit message generation | ✅ | `commit --stage --print` |
| Status / drift report | ✅ | shows added/modified/deleted rows |
| BLOB columns | ✅ | binary or base64 sidecar files |
| Configurable body columns | ✅ | long text becomes `# heading` sections |
| Schema fingerprint check | ✅ | detects schema drift between exports |
| Cross-file relationship links | ❌ | FK values stored as plain scalars, not Markdown links |
| Circular FK dependency detection | ❌ | not detected; import may fail with a constraint error |
| Real-time sync / file watcher | ❌ | push-based; use the pre-commit hook instead |
| Automatic schema migration | ❌ | edit `_schema/*.sql` manually |

## Limitations

- Up to ~100k rows; larger workloads work but are not the primary design point
- No conflict resolution beyond Git — two branches touching the same row produce a merge conflict
- Single-process: no row locking, no concurrent writers
- Triggers, views, and `WITHOUT ROWID` tables are not tested

## Versioning & stability

Follows SemVer. The on-disk format has its own integer version in `.sqlmdsync.json`; bumped only on breaking changes. See [docs/format-spec.md](./docs/format-spec.md) for the full contract.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports, PRs, and questions all welcome.

## License

MIT — see [LICENSE](./LICENSE).
