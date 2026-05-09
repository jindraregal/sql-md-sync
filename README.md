# sql-md-sync

> Bidirectional sync between SQLite and a Markdown folder. Use Git as your database's source of truth.

[![CI](https://github.com/jindraregal/sql-md-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/jindraregal/sql-md-sync/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/sql-md-sync.svg)](https://www.npmjs.com/package/sql-md-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/node/v/sql-md-sync.svg)](https://www.npmjs.com/package/sql-md-sync)
[![npm downloads](https://img.shields.io/npm/dm/sql-md-sync.svg)](https://www.npmjs.com/package/sql-md-sync)

## Purpose

`sql-md-sync` exists to give AI-built applications a single source of truth that is both human-readable and machine-queryable. AI agents frequently generate and mutate structured data in SQLite; without this tool that data lives in an opaque binary that no reviewer can audit and no Git workflow can protect. By projecting every row as a committed Markdown file, the schema and data become the canonical artifact, not just a runtime detail. A pre-commit hook or CI step validates the projection before anything reaches `main`, so the repository is always in a provably consistent state.

The Markdown projection also makes the data **legible to language models**. A `sqlite3 .dump` produces one massive block of `INSERT` statements with no structure an LLM can navigate; a Markdown tree gives each record its own file with named fields and prose-formatted text columns, so an AI agent can read, reason about, and edit individual rows without needing SQL tooling or context about the entire database at once.

## 30-second pitch

```bash
npx sql-md-sync export --db data.db --out ./repo
git diff repo/data/users
# review row-level changes in your editor
npx sql-md-sync import --md ./repo --out data.db
```

You commit Markdown. You materialize SQLite when you need to run SQL. PRs look like prose, not binary blobs.

## Why this exists

A `.db` file is a binary blob. Git can store it, but cannot diff it, review it, or merge it. Teams reach for hosted databases or maintain hand-curated `INSERT` scripts to sidestep this. Both lose either the ergonomics of plain SQL or the auditability of plain text.

`sql-md-sync` projects each row as a Markdown file with YAML frontmatter for scalars and Markdown body sections for prose-shaped columns. Round-tripping the projection back into a real SQLite database is byte-stable, so you can treat the Markdown tree as the canonical artifact and keep using `sqlite3` for queries.

## Quick start

```bash
npm i -g sql-md-sync          # or use npx
sql-md-sync init               # creates .sqlmdsync.json + _schema/ + data/
sql-md-sync export --db ./mydata.db --out .
git add -A && git commit -m "snapshot"

# later, after editing rows in your editor:
sql-md-sync import --md . --out ./mydata.db
sqlite3 mydata.db "SELECT * FROM users"
```

You should see a tree like:

```
.
├── .sqlmdsync.json
├── _schema/
│   ├── users.sql
│   └── posts.sql
└── data/
    ├── users/
    │   ├── _index.md
    │   ├── 0001-alice.md
    │   └── 0002-bob.md
    └── posts/
        ├── _index.md
        └── 0001-hello-world.md
```

## How it works

Each row is one Markdown file. Short scalars live in YAML frontmatter; columns over a configurable threshold (default 200 chars) or that contain newlines are emitted as `# <column>` body sections so they diff well. BLOBs are written as binary or base64 sidecar files alongside the row file. `_index.md` records table metadata (row count, primary key, indexes). `_schema/<table>.sql` holds the `CREATE TABLE` statement.

The full on-disk contract is in [docs/format-spec.md](./docs/format-spec.md).

## Common workflows

### Review a data change in a PR

```bash
sql-md-sync export --db data.db --out .
git checkout -b fix/typo
# edit data/users/0042-alice.md in your editor
git diff
git commit -am "fix(users): correct alice's email"
```

### Schema migration

```bash
sqlite3 data.db < migrations/0007_add_verified.sql
sql-md-sync export --db data.db --out .
git diff _schema/users.sql data/users/
sql-md-sync commit --stage --print  # generates a deterministic message
```

### Query, edit, commit

```bash
sql-md-sync import --md . --out data.db
sqlite3 data.db "UPDATE users SET status='active' WHERE id IN (...)"
sql-md-sync export --db data.db --out .
sql-md-sync commit --stage
```

### CI validation

```yaml
- run: sql-md-sync validate . --round-trip
```

The round-trip flag rebuilds a temp database, re-exports it, and diffs against the committed Markdown. Any mismatch fails the job.

## Sync behavior

**Export is incremental.** `sql-md-sync export` uses a smart-merge strategy: it renders the full projection into a temp directory, then compares file hashes against the existing tree. Only files whose content changed are written; files whose rows were deleted are removed. On a 10k-row database where 20 rows changed, only ~20 files are touched on disk.

**Import is a full rebuild.** `sql-md-sync import` always creates a fresh SQLite database in a temp file, inserts every row from the Markdown tree in a single transaction, then atomically renames the temp file into place. There is no row-level diffing on import. This keeps the code simple and guarantees consistency, at the cost of O(n) work regardless of how many rows changed.

### Performance vs `sqlite3 .dump`

| Operation | `sqlite3 .dump` + restore | `sql-md-sync` |
|---|---|---|
| First export | fast (one sequential write) | slower (one file per row) |
| Subsequent export | always full rewrite | fast (only changed rows written) |
| Import | fast (batch SQL replay) | comparable (batched INSERT transaction) |
| Diff a change | noisy (line in a giant file) | clean (single row file changes) |
| LLM / AI readability | poor (raw SQL) | good (named fields, prose columns) |

For databases up to ~100k rows the per-file overhead is negligible. Above that, export time grows with row count; consider batching exports or scoping to changed tables.

## Comparison

| Tool | What it stores in Git | Diff-friendly | Real SQL after fetch | Schema control |
|---|---|---|---|---|
| `sql-md-sync` | Markdown + YAML | yes | `sqlite3 data.db ...` | hand-edit `_schema/*.sql` |
| markdowndb | Markdown (one-way) | yes | no | n/a |
| Dolt | Custom dolt format | yes (via Dolt CLI) | yes (Dolt server) | yes |
| `sqlite3 .dump` | One huge SQL file | line-by-line, but diff is noisy | yes | yes |
| git-lfs + `.db` | The binary | no | yes | n/a |

`sql-md-sync` covers the case where you want plain Markdown in your repo *and* plain SQLite tooling at runtime, without inventing a new database engine or storage backend.

## Feature support

| Feature | | Notes |
|---|---|---|
| Export SQLite to Markdown | ✅ | row-per-file, YAML frontmatter |
| Import Markdown to SQLite | ✅ | byte-stable round-trip |
| Round-trip validation | ✅ | `validate --round-trip` rebuilds a temp DB and diffs |
| Git-diffable row changes | ✅ | one file per row |
| Auto commit message generation | ✅ | `commit --stage --print` |
| Status report | ✅ | shows added/modified/deleted rows |
| BLOB columns | ✅ | binary or base64 sidecar files |
| Configurable body columns | ✅ | long text / multiline columns become `# heading` sections |
| Schema fingerprint check | ✅ | detects schema drift between exports |
| Cross-file relationship links | ❌ | FK values are stored as plain scalars in frontmatter, not as Markdown links to other row files |
| Circular FK dependency detection | ❌ | cyclic foreign-key schemas are not detected; import may fail with a constraint error |
| Real-time sync / file watcher | ❌ | push-based only |
| Automatic schema migration | ❌ | edit `_schema/*.sql` manually; the importer applies it |
| Conflict resolution | ❌ | Git merge conflicts on row files are resolved by hand |

## Limitations

- Targeted at databases up to ~100k rows. Larger workloads work but are not the primary design point.
- No automatic schema migration. You edit `_schema/*.sql`; the importer applies it.
- No conflict resolution beyond Git. Two diverged branches that both touch the same row produce a Git merge conflict like any other text file.
- Not a real-time sync daemon. There is no file watcher.
- Single-process: no row locking, no concurrent writers.
- Triggers, views, virtual tables, and `WITHOUT ROWID` tables are not exercised; they may work, may not.
- BLOB-heavy databases bloat the repo unless you add `*.bin` to `.gitignore` or use git-lfs.

## Versioning & stability

The library follows SemVer. The on-disk format has its own integer version, stored in `.sqlmdsync.json`; it is bumped only on breaking format changes. The library reads any format version less than or equal to its own and ships migrations for older formats. `docs/format-spec.md` is the contract for the on-disk shape.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports, PRs, and questions all welcome.

## License

MIT — see [LICENSE](./LICENSE).
