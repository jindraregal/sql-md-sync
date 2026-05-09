# sql-md-sync — Full Requirements Specification v1.0

## 1. Project Goal

A small, plug-and-play library that enables Git to be the source of truth for SQLite data. Bidirectional synchronization between a SQLite database file and a structured Markdown directory tree.

Core problem solved: SQLite .db files are binary blobs that don't diff, merge, or review well in Git. By projecting the database into a Markdown filesystem layout, users get Git-native versioning, code review on data changes, and easy collaboration — while still being able to materialize a real SQLite file for standard SQL tooling.

Primary use case: Developer keeps a Git repo as source of truth, runs `sql-md-sync import` to get a .db file, runs SQL queries/operations, then `sql-md-sync export` to write changes back as Markdown for committing.

---

## 2. Non-Goals

- Not a real-time sync daemon (no file watchers, no CRDTs, no conflict resolution beyond Git).
- Not a multi-master replication tool.
- Not a database migration tool.
- Not optimized for >1M row databases (target: up to ~100k rows).
- No GUI.

---

## 3. Language & Ecosystem

TypeScript (Node.js) first, Python as a port.

- better-sqlite3 for Node, stdlib sqlite3 for Python
- gray-matter / python-frontmatter for YAML
- Both implementations must produce byte-identical Markdown output given the same database input (enforced by shared test-corpus)

Alternative considered: Rust core with napi-rs + pyo3 bindings. Deferred to post-v1.

---

## 4. File Structure Specification

### 4.1 Directory Layout

```
<repo-root>/
├── .sqlmdsync.json          # config + schema fingerprint
├── _schema/                 # schema definitions (one file per table)
│   ├── users.sql            # CREATE TABLE statement
│   └── posts.sql
└── data/
    ├── users/
    │   ├── _index.md        # table-level metadata (row count, PK, indexes)
    │   ├── 0001-alice.md
    │   └── 0002-bob.md
    └── posts/
        ├── _index.md
        └── 0001-hello-world.md
```

### 4.2 Row File Format

Each row is a Markdown file with YAML frontmatter for scalar columns and Markdown body sections for large text columns.

```markdown
---
id: 1
created_at: 2025-01-15T10:30:00Z
author_id: 42
status: published
tags: [rust, sqlite]
---

# title

Hello World

# body

This is the post body with **markdown**, emoji 🎉, code blocks, etc.
```

Rules:
- Frontmatter holds: integers, floats, booleans, dates, short strings (≤80 chars, no newlines), JSON arrays/objects
- Body sections (`# <column_name>`) hold any TEXT column >200 chars OR contains newline
- Threshold configurable in .sqlmdsync.json
- NULL is distinct from empty string: NULL = key absent from frontmatter OR empty body section with explicit `<!-- null -->` marker
- BLOBs stored as sidecar files: `0001-alice.avatar.bin` (binary) or `0001-alice.avatar.b64` (base64, configurable). Never inlined in Markdown.
- Column-to-section mapping determined at export time and recorded in _schema/ for round-trip fidelity

### 4.3 Filename Convention

`<zero-padded-row-id>-<slug>.md`

- Padding width = ceil(log10(max_id)) + 1, minimum 4 digits
- Slug derived from configurable "display column" (title, name, email); falls back to row number if none
- Slug rules: lowercase, ASCII-only, [a-z0-9-]+, max 50 chars, transliterated from Unicode
- If two rows produce the same slug, append -<short-hash>

### 4.4 Encoding & Special Characters

- All files UTF-8, LF line endings, final newline — enforced by .gitattributes template
- YAML strings use block scalar (| or >) when they contain :, #, quotes, or newlines
- Markdown body sections: literal storage, no escaping
- Section boundaries detected only by `^# <column_name>$` at column-zero
- If a column value contains a line matching another column header, escape with configurable prefix (default `\#`)
- BLOBs: never inlined in Markdown; always sidecar files

---

## 5. Functional Requirements

### 5.1 CLI Commands

```
sql-md-sync init [--db <path>]              Bootstrap config + .sqlmdsync.json
sql-md-sync import [--db <path>] [--dir <path>]   MD tree → SQLite
sql-md-sync export [--db <path>] [--dir <path>]   SQLite → MD tree
sql-md-sync diff [--db <path>] [--dir <path>]     Show what would change either direction
sql-md-sync validate                        Check round-trip fidelity
sql-md-sync commit [--message <tpl>]        Stage MD changes + generate commit message
sql-md-sync status                          Show drift between .db and MD tree
```

### 5.2 Library API (TypeScript)

```typescript
import { syncImport, syncExport, syncDiff, syncValidate, generateCommitMessage } from 'sql-md-sync'
```

Each function takes a config object, returns structured result (counts, warnings, errors). No side effects beyond stated I/O. All async.

### 5.3 Idempotency (CRITICAL)

Repeated export on unchanged data MUST produce byte-identical output:
- Rows written in deterministic order (by primary key, ascending)
- Frontmatter keys in schema column order (not alphabetical, not insertion order)
- YAML serialization uses single fixed style
- Timestamps reflect data, never wall-clock
- No "last exported at" metadata in tracked files
- Floats serialized with shortest round-trip representation
- Round-trip test (export → import → export) must produce zero diff

### 5.4 Validation

- On import: schema in _schema/ must match what Markdown files imply; reject with clear error otherwise
- On export: any column type the library can't handle raises typed error with offending row+column
- Round-trip check: validate does export → temp dir → import → temp db → compare against original
- Schema fingerprint: .sqlmdsync.json stores hash of schema; mismatches flagged before destructive ops

### 5.5 Commit Helper

Generates deterministic commit message from staged Markdown changes:
- Parses `git diff --cached` for files under data/
- Groups by table, summarizes adds/modifies/deletes per table
- Format examples:
  - `data(users): add 3, modify 1, delete 0`
  - `data(users): modify alice.email` (single-row, single-field change)
  - `data: add 12 rows across 3 tables` (large change, summarized)
- Schema changes get own line: `schema(users): add column "verified"`
- `--message` accepts template override; default configurable in .sqlmdsync.json
- Must handle 1 to 100k rows without OOM — stream the diff

### 5.6 Performance

- 10k rows / 50 columns: import or export < 5s on a modern laptop
- 100k rows: < 60s, < 500MB RAM
- Streaming where feasible (don't load whole db into memory for export)
- Incremental export: only rewrite files for rows whose content hash changed

---

## 6. Configuration (.sqlmdsync.json)

```json
{
  "version": 1,
  "db_path": "./data.db",
  "data_dir": "./data",
  "schema_dir": "./_schema",
  "tables": {
    "users": {
      "display_column": "email",
      "large_text_threshold": 200,
      "body_columns": ["bio"],
      "exclude_columns": []
    }
  },
  "blob_encoding": "binary_sidecar",
  "commit_template": "data({table}): {summary}",
  "schema_fingerprint": "sha256:..."
}
```

All keys optional except `version`; sensible defaults for everything else.

---

## 7. Error Handling

- Typed errors: `SchemaMismatchError`, `EncodingError`, `RoundTripError`, etc.
- CLI exits non-zero with actionable message including file path + line number
- No partial writes: export to temp dir then atomic rename; import builds new db then swaps on success

---

## 8. Repository Structure

```
sql-md-sync/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml           # test, lint, typecheck on PR + main
│   │   ├── release.yml      # changesets-based npm release
│   │   └── cross-impl.yml   # round-trip parity TS vs Python
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── dependabot.yml
│   └── CODEOWNERS
├── packages/
│   ├── core-ts/             # TypeScript implementation
│   ├── core-py/             # Python port (phase 2, scaffold only)
│   └── test-corpus/         # shared fixtures (db files + expected MD trees)
├── docs/
│   ├── format-spec.md       # frozen on-disk format contract
│   ├── architecture.md
│   └── examples/
├── README.md
├── LICENSE                  # MIT
├── CHANGELOG.md             # changesets-managed
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
└── .editorconfig
```

---

## 9. README Requirements

In order:
1. One-line tagline: "Bidirectional sync between SQLite and a Markdown folder. Use Git as your database's source of truth."
2. Badges: CI status, npm version, license, min Node version, downloads
3. 30-second pitch (asciicast placeholder ok for v0.1)
4. Why this exists: 3-4 sentence problem statement
5. Quick start: copy-pasteable, works in < 60 seconds
6. How it works: file layout shown visually
7. Common workflows: 4 recipes (review-data-PR, schema-migration, query-and-edit, CI-validation)
8. Comparison table: vs markdowndb, vs dolt, vs raw sqlite3 .dump, vs git-lfs
9. Limitations: explicit honest list
10. Versioning + stability promise: SemVer; format version separate from library version
11. Contributing + License (MIT)

No marketing fluff. No emoji headers. Technical and direct. Examples must actually run.

---

## 10. CI/CD Setup

### 10.1 ci.yml
- Matrix: Node 20/22, ubuntu/macos/windows
- Steps: install, lint (eslint + prettier), typecheck, unit tests, integration tests, round-trip property tests, build
- Coverage artifact, fail if < 85%

### 10.2 release.yml
- Use changesets for versioning
- On merge of changeset PR: publish to npm with provenance, create GitHub release, update CHANGELOG

### 10.3 cross-impl.yml
- Run TS and Python against shared test-corpus/
- Diff outputs byte-by-byte; fail on any difference

### 10.4 Other automation
- Dependabot weekly for deps and GitHub Actions
- CodeQL security scan
- Branch protection on main: required CI, required review, no force-push

---

## 11. Testing Requirements

- Unit tests: >90% coverage on core modules (serializer, parser, slug, validator)
- Integration tests: full CLI flows with real SQLite files
- Property-based tests (fast-check): generate random valid databases, assert round-trip identity
- Snapshot tests: test-corpus/ with representative .db files + canonical MD projections
- Idempotency test: export twice, diff must be empty
- Performance test (flag-gated): 10k and 100k row benchmarks
- Encoding torture test: fixture row with every Unicode block, all YAML special chars, embedded YAML/MD/code-fence syntax, large blobs

---

## 12. Distribution

TypeScript package:
- Publish to npm as `sql-md-sync`
- Both ESM and CJS builds
- Single binary CLI via `bin` field, runnable as `npx sql-md-sync`
- Zero runtime deps if possible; if not, better-sqlite3 and gray-matter only

Python package (phase 2 — scaffold structure only for v0.1):
- PyPI as `sql-md-sync`
- stdlib sqlite3 only, Python ≥ 3.10

---

## 13. Versioning & Stability

- Library: SemVer
- Format: integer in .sqlmdsync.json, bumped only on breaking on-disk changes
- Library reads format versions ≤ current; provides migration command for older formats
- docs/format-spec.md is the contract; any change requires format version bump

---

## 14. Acceptance Criteria for v1.0

- [ ] All CLI commands implemented and documented
- [ ] Round-trip identity holds on test corpus
- [ ] Idempotent export verified
- [ ] CI green on 3 OSes, 2 Node versions
- [ ] README with all examples runnable from clean clone
- [ ] Format spec frozen and versioned
- [ ] Published to npm with provenance

---

## 15. Suggested Build Order

1. `docs/format-spec.md` — write first, it's the contract
2. Test corpus skeleton with 3 representative databases in `packages/test-corpus/`
3. TypeScript core: serializer (db → MD)
4. TypeScript core: parser (MD → db)
5. Round-trip test passes
6. CLI wrapping the core
7. Validation + diff commands
8. Commit helper
9. README + docs
10. CI/CD wiring (`.github/workflows/`)
11. Commit and push as v0.1.0
