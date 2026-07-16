# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

**Every user-facing change needs a changeset.** After making your change, run:

```bash
pnpm changeset
```

Pick the affected packages and a semver bump (patch / minor / major), and write a
short summary — it becomes the changelog entry. Commit the generated
`.changeset/*.md` file alongside your code.

All Schemat packages are **fixed-versioned**: they bump together and share one
version number, so you only need to pick the bump level once.

Maintainers: see [`RELEASING.md`](../RELEASING.md) for how versions get published.
