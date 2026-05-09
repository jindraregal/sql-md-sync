# Architecture

## High-level Picture

```
┌──────────────┐                ┌────────────────────┐
│   data.db    │  ── export ──▶ │ Markdown tree      │
│  (SQLite)    │  ◀── import ── │  + _schema/*.sql   │
└──────────────┘                │  + .sqlmdsync.json │
                                └────────────────────┘
                                          │
                                          ▼
                                   git commit / diff / review
```

`sql-md-sync` is a thin layer of two pure-data projections (db → md, md → db) plus deterministic file-system writers. The heavy work is in the round-trip-preserving serializer.

## Module Map (`packages/core-ts/src`)

| Module | Responsibility |
|---|---|
| `cli.ts` | Commander-based CLI; thin wrapper over `src/index.ts` |
| `index.ts` | Public library API |
| `config.ts` | Read/write `.sqlmdsync.json`, schema fingerprint |
| `schema.ts` | Read SQLite schema (table list, columns, indexes, CREATE statements) |
| `serialize.ts` | `rowToMarkdown` and `markdownToRow` — the on-disk format codec |
| `slug.ts` | Filename-friendly slug generation, padding, collision handling |
| `export.ts` | DB → MD orchestration; deterministic file writes; sidecar BLOB writers |
| `import.ts` | MD → DB orchestration; atomic temp-then-rename swap |
| `diff.ts` | Compute MD-vs-DB diff |
| `validate.ts` | Static checks + round-trip validation |
| `status.ts` | Schema-fingerprint + drift report (combines diff + fingerprint check) |
| `commit.ts` | Parse `git diff --cached`, generate commit message |
| `init.ts` | Bootstrap a fresh tree |
| `errors.ts` | Typed errors (`SchemaMismatchError`, `RoundTripError`, etc.) |
| `types.ts` | Shared type aliases |

## Determinism Strategy

The format spec (§7) requires byte-identical output for unchanged input. We achieve this with:

1. **Stable row order**: `SELECT * FROM <t> ORDER BY <pk>` always.
2. **Stable column order**: schema column order from `PRAGMA table_info`, not the order keys happened to land in a JS object.
3. **Stable YAML output**: one writer (`js-yaml`), one set of options, no flow style, no key sorting.
4. **No clock**: nothing involving `Date.now()`, `process.uptime()`, hostnames, or environment is written.
5. **Stale-file pruning**: removed rows produce removed files; renamed slugs replace old files; tables removed from the schema have their directories deleted.

## Round-trip Test

`validateRoundTrip` is the canonical correctness check:

1. Read the existing MD tree.
2. `import` it into a temporary SQLite database.
3. `export` that database into a temporary directory.
4. Walk both directories and compare every file byte-for-byte.

Any mismatch is a regression in the format codec, the slug logic, or the writer.

## Why TypeScript First

`better-sqlite3` is the most ergonomic synchronous SQLite binding in any ecosystem, and `gray-matter` covers most of the YAML-frontmatter quirks for free. The Python port (`packages/core-py/`) is scaffolded for v0.2 — it must produce byte-identical output, enforced via the cross-implementation CI job and the shared `packages/test-corpus/` fixtures.

## Performance Notes

For up to ~100k rows, the simplest correct implementation is fast enough:

- Each row is a single `fs.writeFileSync` (small, sync, OS-buffered).
- `INSERT` uses a single prepared statement under one transaction per table.
- We do not stream the whole `SELECT` cursor; rows are read into memory. At 100k rows × ~50 columns, that is ~50–100 MB peak — under the 500 MB RAM budget.

If we ever need >1M rows, the pinch point is the `SELECT *` materialization. The fix is a streaming exporter that writes a row file per `iterate()` step. Not implemented in v0.1.
