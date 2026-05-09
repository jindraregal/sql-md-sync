# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial TypeScript implementation of `sql-md-sync` (export, import, validate, diff, status, init, commit).
- On-disk format spec v1 (`docs/format-spec.md`).
- Round-trip validation (`validate --round-trip`).
- BLOB sidecar files (`.bin` and `.b64`).
- Schema fingerprint in `.sqlmdsync.json`.
- Test corpus scaffolding under `packages/test-corpus/`.
- CI matrix (Node 20/22 × Linux/macOS/Windows) and changesets-based release workflow.
