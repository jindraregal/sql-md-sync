<!--
Thanks for the PR! A few quick boxes to check before opening it for review.
-->

## Summary

<!-- one or two sentences -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation
- [ ] Format-spec change (requires version bump in `.sqlmdsync.json` AND `docs/format-spec.md`)

## Test plan

- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] Round-trip test still green (`vitest run`)
- [ ] If user-visible: changeset added (`npx changeset`)

## Format-spec changes

If this PR changes `docs/format-spec.md`:

- [ ] On-disk format version bumped
- [ ] Migration documented in `CHANGELOG.md`
- [ ] Test corpus regenerated
