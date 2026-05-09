# sql-md-sync On-Disk Format — v1

This document is the contract for the on-disk Markdown projection of a SQLite database. Any change here requires a bump to the integer `version` field in `.sqlmdsync.json`. Implementations that read a format version higher than their own SHALL refuse to import without `--force`.

## 1. Directory Layout

```
<root>/
├── .sqlmdsync.json
├── _schema/
│   ├── <table>.sql        # one CREATE TABLE statement per file, with trailing semicolon
│   └── ...
└── data/
    ├── <table>/
    │   ├── _index.md      # table-level metadata (frontmatter only, empty body)
    │   ├── 0001-<slug>.md
    │   ├── 0001-<slug>.<col>.bin   # optional BLOB sidecar
    │   ├── 0001-<slug>.<col>.b64   # optional base64 BLOB sidecar
    │   └── ...
    └── ...
```

## 2. `.sqlmdsync.json`

```json
{
  "version": 1,
  "largeTextThreshold": 200,
  "tables": {
    "<table>": {
      "pk": "<pk-column>",
      "bodyColumns": ["bio", "content"],
      "displayColumn": "email",
      "excludeColumns": []
    }
  },
  "schemaFingerprint": "<sha256-hex>",
  "blobEncoding": "binary_sidecar",
  "commitTemplate": "data({table}): {summary}"
}
```

Required keys: `version`. All other keys have defaults. Implementations MUST preserve unknown keys when rewriting.

## 3. Row File

A row file is a Markdown document with YAML frontmatter:

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

### 3.1 Frontmatter

- One key per non-body, non-NULL column.
- Keys SHALL appear in schema column order (the order returned by `PRAGMA table_info`), not alphabetical.
- YAML values: integers, floats, booleans, ISO-8601 dates, short strings, JSON arrays/objects.
- Strings ≤80 chars and without newlines: emitted on the same line as the key.
- Strings >80 chars or containing newlines: written as a body section instead (see §3.2).
- Floats SHALL be serialized with the shortest decimal representation that round-trips.
- NULL columns SHALL be absent from frontmatter; they MUST NOT be emitted as `key: null` or `key: ""`.

### 3.2 Body Sections

- A body section is delimited by a heading `# <column_name>` at column zero, where `<column_name>` matches `[A-Za-z_][A-Za-z0-9_]*`.
- Sections are separated by a single blank line.
- A column SHALL be emitted as a body section iff its value is a string and:
  - `length > largeTextThreshold` (default 200), OR
  - the value contains a newline character, OR
  - the value is explicitly listed in `tables.<table>.bodyColumns`.
- A trailing newline is appended to the last body section. The single newline immediately following the heading and the single trailing newline before the next heading or EOF are part of the encoding, not the column data.
- Body section content is stored verbatim. No escaping of Markdown, code fences, or YAML-looking lines.

### 3.3 NULL vs Empty String

| Value | Frontmatter | Body |
|---|---|---|
| NULL | key absent | section absent, OR section present with body `<!-- null -->` |
| `""` (empty string) | `key: ""` | empty section: heading then blank body |
| any string | `key: <value>` (frontmatter rules) or `# key\n\n<value>` (body rules) |

Implementations MUST distinguish NULL from `""` on import.

### 3.4 BLOBs

BLOBs are NEVER inlined into Markdown. They are written as sidecar files next to the row file:

- `<basename>.<col>.bin` — raw bytes (default; `blobEncoding: "binary_sidecar"`)
- `<basename>.<col>.b64` — base64-encoded text (`blobEncoding: "base64_sidecar"`)

`<basename>` is the row file name without the `.md` suffix.

### 3.5 Filename Convention

`<zero-padded-pk>-<slug>.md`

- Pad width = `max(4, ceil(log10(max_pk + 1)) + 1)`.
- Slug is lowercase ASCII derived from the configured `displayColumn`, falling back to the first non-PK text column, falling back to the PK itself.
- Slug regex: `[a-z0-9-]+`, max 50 chars, leading/trailing dashes trimmed.
- Unicode is transliterated via NFKD + combining-mark stripping before slugifying.
- On collision, append `-2`, `-3`, ... in PK order.

## 4. `_index.md`

```markdown
---
table: users
rowCount: 42
pk: id
indexes:
  - name: idx_users_email
    columns: [email]
    unique: true
---
```

`_index.md` is metadata only; the body MUST be empty. The `rowCount` must equal the number of `*.md` files in the directory, excluding `_index.md` itself. Implementations SHALL fail validation on a mismatch.

## 5. `_schema/<table>.sql`

Each file holds exactly one `CREATE TABLE` statement, terminated by `;` and a trailing newline. The fingerprint in `.sqlmdsync.json` is `sha256(concat(trim(<each schema file>), ";\n"))`, computed in lexicographic table order. Schema files are the source of truth on import; the importer SHALL execute them verbatim.

## 6. Encoding

- All text files: UTF-8, LF line endings, final newline. The `.gitattributes` template enforces this.
- YAML strings containing `:`, `#`, `"`, `'`, or a newline: emitted as block scalars (`|` or `>`) by the writer; readers SHALL accept any valid YAML.

## 7. Idempotency

A second `export` over an unchanged database SHALL produce a byte-identical tree. Specifically:

- Rows ordered by primary key, ascending.
- Frontmatter keys in schema column order.
- One YAML serialization style (block, no flow).
- No timestamps, no host info, no "last exported at" field.
- Stale row files are pruned; stale table directories are removed.

## 8. Versioning

The on-disk format version is `1`. Increment only on breaking changes. Library version (SemVer) is independent.
