# sql-md-sync

> Bidirectional sync between SQLite and a Markdown folder. Use Git as your database's source of truth.

[![CI](https://github.com/jindraregal/sql-md-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/jindraregal/sql-md-sync/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/sql-md-sync.svg)](https://www.npmjs.com/package/sql-md-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/node/v/sql-md-sync.svg)](https://www.npmjs.com/package/sql-md-sync)
[![npm downloads](https://img.shields.io/npm/dm/sql-md-sync.svg)](https://www.npmjs.com/package/sql-md-sync)

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

## Comparison

| Tool | What it stores in Git | Diff-friendly | Real SQL after fetch | Schema control |
|---|---|---|---|---|
| `sql-md-sync` | Markdown + YAML | yes | `sqlite3 data.db ...` | hand-edit `_schema/*.sql` |
| markdowndb | Markdown (one-way) | yes | no | n/a |
| Dolt | Custom dolt format | yes (via Dolt CLI) | yes (Dolt server) | yes |
| `sqlite3 .dump` | One huge SQL file | line-by-line, but diff is noisy | yes | yes |
| git-lfs + `.db` | The binary | no | yes | n/a |

`sql-md-sync` covers the case where you want plain Markdown in your repo *and* plain SQLite tooling at runtime, without inventing a new database engine or storage backend.

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
