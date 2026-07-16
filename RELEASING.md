# Releasing Schemat

Maintainer runbook. Contributors don't need this — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

Schemat uses [Changesets](https://github.com/changesets/changesets). All packages
are **fixed-versioned**: they share one version and publish together.

Published packages (npm, public, under the `@schemat` org):

- `@schemat/cli`  ← the `schemat` binary
- `@schemat/core`
- `@schemat/parser-prisma`
- `@schemat/parser-sql`
- `@schemat/render`
- `@schemat/web`

---

## One-time setup

### 1. npm org + token

The `@schemat` org already exists (public, free). Create an **automation**
access token scoped to the org:

1. npmjs.com → your avatar → **Access Tokens** → **Generate New Token** →
   **Granular Access Token** (or classic **Automation**).
2. Permissions: **Read and write** to packages in the `@schemat` scope/org.
3. Set an expiry you'll remember to rotate (or "no expiry" for a personal project).

> Use an **automation / granular** token, not a classic *Publish* token —
> automation tokens bypass 2FA-on-publish, which CI needs.

### 2. Account 2FA level

npmjs.com → **Account** → **Two-Factor Authentication** → set authorization
level to **"Require two-factor authentication or an automation token"**. This
keeps 2FA on your login while letting the CI token publish.

### 3. GitHub secret

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository
secret**:

- Name: `NPM_TOKEN`
- Value: the automation token from step 1

The release workflow already requests `id-token: write` for **npm provenance**,
so published packages get a supply-chain attestation on their npm page — no extra
setup needed.

---

## First release (manual, once)

The packages are set to `0.1.0` but have never been published, so publish the
first version by hand from your machine (CI takes over afterward):

```bash
git checkout main && git pull
pnpm install
pnpm build

# authenticate locally (browser or token)
npm login   # or: export NPM_TOKEN=... and use an .npmrc

# publish all public packages at their current 0.1.0
pnpm -r --filter './packages/*' publish --access public --no-git-checks
```

Verify:

```bash
npm view @schemat/cli version    # -> 0.1.0
npx @schemat/cli --version       # -> 0.1.0
```

Then tag it:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## Ongoing releases (automated)

1. Every PR with a user-facing change includes a changeset (`pnpm changeset`).
2. When those PRs merge to `main`, the **Release** workflow opens (or updates) a
   **"chore: version packages"** PR that bumps versions and writes CHANGELOGs.
3. **Review and merge that PR** when you want to ship. Merging it triggers the
   workflow to run `pnpm release` → `changeset publish`, which:
   - publishes all bumped packages to npm (with provenance),
   - creates git tags and a GitHub Release with the changelog.

Nothing is ever published without you merging the version PR.

## Manual publish of a single fix (rare)

```bash
pnpm changeset            # record the bump
pnpm version-packages     # apply it locally
pnpm release              # build + publish
```

## Deprecating / unpublishing

```bash
npm deprecate @schemat/cli@0.1.0 "Use 0.1.1+"
# unpublish is discouraged and time-limited; prefer deprecate.
```

## Troubleshooting

- **402 Payment Required** on publish → package is scoped and defaulting to
  private. Each package already sets `publishConfig.access: "public"`; confirm it
  wasn't dropped.
- **403 Forbidden** → token lacks write access to the `@schemat` org, or 2FA
  level forbids tokens. Re-check one-time setup steps 1–2.
- **Provenance error** → the workflow needs `id-token: write` (already set) and
  must run on GitHub-hosted runners over HTTPS registry. Don't publish provenance
  from a local machine.
