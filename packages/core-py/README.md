# sql-md-sync (Python port)

> Status: scaffold only. Not part of v0.1.

The Python implementation is intentionally a thin port of `packages/core-ts`. Its only mandate: when run against any fixture in `packages/test-corpus/`, produce byte-identical Markdown to the TypeScript implementation. The cross-impl CI job enforces this.

## Planned layout

```
packages/core-py/
├── pyproject.toml
├── README.md
├── src/
│   └── sql_md_sync/
│       ├── __init__.py
│       ├── cli.py
│       ├── serialize.py
│       ├── slug.py
│       ├── export.py
│       ├── import_.py
│       ├── diff.py
│       └── validate.py
└── tests/
```

## Constraints

- Python ≥ 3.10
- Standard library `sqlite3` only — no third-party DB driver
- `python-frontmatter` for YAML, or hand-rolled to keep zero deps
- Same on-disk format spec as TypeScript ([../../docs/format-spec.md](../../docs/format-spec.md))
