# Changesets

Hello and welcome! This folder has been created to manage changelog entries and versioning for `sql-md-sync`.

## Releasing

1. Run `npx changeset` to create a new changeset file describing your change.
2. Commit and push the changeset to `main`.
3. The Release workflow creates a "Version Packages" PR automatically.
4. Merge that PR to publish to npm.

The `NPM_TOKEN` secret must be set in the repository settings for publishing to work.
