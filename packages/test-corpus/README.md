# test-corpus

Shared fixtures used by both the TypeScript and (eventually) the Python implementations to verify byte-identical output.

## Structure

```
packages/test-corpus/
├── README.md
├── fixtures/                # source SQLite databases
│   ├── 01-simple/
│   │   ├── source.sql       # SQL to (re)build the fixture from scratch
│   │   └── data.db          # generated; not strictly required in git
│   ├── 02-large-text/
│   ├── 03-blob/
│   └── 04-unicode/
└── expected/                # canonical Markdown projections
    ├── 01-simple/
    ├── 02-large-text/
    ├── 03-blob/
    └── 04-unicode/
```

Each `fixtures/<name>/source.sql` is the canonical input; the `data.db` file can be regenerated with:

```bash
sqlite3 data.db < source.sql
```

The `expected/<name>/` tree is what `sql-md-sync export` MUST produce when run against `fixtures/<name>/data.db`. The cross-implementation CI job runs both implementations and asserts byte-equality with `expected/`.

## Adding a Fixture

1. Write `fixtures/<id>-<short-name>/source.sql`. Keep it self-contained.
2. Build `data.db`: `sqlite3 data.db < source.sql`.
3. Run `sql-md-sync export --db fixtures/<id>-<short-name>/data.db --out expected/<id>-<short-name>`.
4. Commit `source.sql` and the entire `expected/<id>-<short-name>/` tree.
5. Add a row to the cross-impl test matrix.

## Fixture Naming

Numbered prefix for stable ordering. Short, hyphen-delimited descriptor: `01-simple`, `02-large-text`, `03-blob`, `04-unicode`, `05-multi-table`.
