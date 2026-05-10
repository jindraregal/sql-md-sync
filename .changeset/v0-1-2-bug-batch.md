---
'sql-md-sync': patch
---

Fix five bugs surfaced in the v0.1.1 review:

- Schema fingerprint round-trip: `readSchemaFiles` is now symmetric with
  `writeSchemaFiles`, so `validate` and `status` no longer falsely report
  a fingerprint mismatch on a freshly exported tree.
- Field-level commit messages: `detectChangedFields` now strips the
  unified-diff line prefix (` `, `+`, `-`) before comparing to `---`, so
  it actually enters frontmatter mode for real `git diff` output.
- Diff false positives: `rowToMarkdown` is now called with the canonical
  `columnOrder` from the schema in the diff path, so rows with
  parser-order-dependent key emission no longer look "changed".
- `install-hook` is idempotent: the managed snippet sits between
  `# >>> sql-md-sync hook >>>` / `# <<< sql-md-sync hook <<<` sentinels,
  re-running with a different `--db` updates in place, and legacy
  pre-v0.1.2 snippets are migrated automatically.
- `import` enforces the documented `--force` semantics: it computes the
  fingerprint of `_schema/` and refuses on mismatch, unless `--force` is
  given.
