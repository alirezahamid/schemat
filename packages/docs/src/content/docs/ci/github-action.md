---
title: GitHub Action
description: Gate pull requests on schema drift with the bundled Schemat Action.
---

Snapshot your schema and commit it, then gate PRs with the bundled Action:

```yaml
# .github/workflows/schema-drift.yml
- uses: alirezahamid/schemat@v0
  with:
    root: "."
```

`v0` is a moving tag that follows the latest 0.x release. Pin a commit SHA
instead if you want the Action frozen, which is what you want in a
security-sensitive repo anyway.

It comments the diff on the PR and fails the job when docs are stale. See
[`examples/github-workflow/schema-drift.yml`](https://github.com/alirezahamid/schemat/blob/main/examples/github-workflow/schema-drift.yml).

Recommended flow: `schemat init` once locally → commit config + snapshot → run
`schemat check` (or the Action) in CI.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `root` | no | `.` | Project root containing the schema (and `.schemat/schema.snapshot.json`). |
| `version` | no | `latest` | Version of `@schemat/cli` to run (npm dist-tag or version). |
| `comment` | no | `true` | Post the drift result as a PR comment (`true`/`false`). |
| `github-token` | no | `${{ github.token }}` | Token used to post the PR comment. Defaults to the workflow token. |

The Action is a composite action: it runs `schemat check --format markdown`,
posts (or updates) a single marked PR comment with the diff, and fails the job
when the snapshot is out of date.
