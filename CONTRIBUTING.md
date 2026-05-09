# Contributing to sql-md-sync

Thanks for your interest. This document covers how to set up a dev environment, run tests, and submit changes.

## Code of Conduct

This project adheres to a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold it.

## Repository Layout

This repo is a monorepo. The current packages:

- `packages/core-ts/` — TypeScript implementation (the published `sql-md-sync` npm package).
- `packages/core-py/` — Python port (scaffolded; not part of v0.1).
- `packages/test-corpus/` — shared SQLite fixtures and expected Markdown projections.
- `docs/` — long-form docs and the on-disk format contract (`docs/format-spec.md`).

## Local Setup

Requirements:

- Node.js 20 or newer
- A C toolchain capable of building `better-sqlite3` (Linux/macOS: standard build tools; Windows: install windows-build-tools or VS Build Tools)

```bash
git clone https://github.com/jindraregal/sql-md-sync.git
cd sql-md-sync
npm install
npm test
```

## Running the CLI from source

```bash
cd packages/core-ts
npm run dev -- <command> [args...]
```

For example, `npm run dev -- export --db ./fixture.db --out ./out`.

## Running Tests

```bash
npm test                 # all packages
npm test -w sql-md-sync  # core-ts only
```

Tests live next to the implementation in `packages/core-ts/tests/`. New behavior must come with at least one test.

## Coding Standards

- TypeScript strict mode, ESM only
- No comments unless the *why* is non-obvious
- No new dependencies without discussing in an issue first
- Determinism is non-negotiable — the round-trip test must stay green

## Submitting a PR

1. Open an issue first for non-trivial changes.
2. Branch off `main`. Keep changes scoped.
3. Run `npm run lint && npm test` before pushing.
4. Add a `.changeset` entry for any user-visible change.
5. Use a Conventional-Commits-style message (e.g. `fix(parser): preserve trailing whitespace in body sections`).

## Releasing

Releases are managed by [changesets](https://github.com/changesets/changesets). The `release.yml` workflow publishes to npm with provenance once a changeset PR is merged.

## Format Spec Changes

Any change to the on-disk format requires:

- A bump to the `version` field in `.sqlmdsync.json`.
- An update to `docs/format-spec.md`.
- A migration path documented in `CHANGELOG.md`.

The format version is independent of the library SemVer.
