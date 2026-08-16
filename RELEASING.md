# Releasing Schemat

Maintainer runbook. Contributors don't need this — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

Schemat uses [Changesets](https://github.com/changesets/changesets). All packages
are **fixed-versioned**: they share one version and publish together.

Published packages (npm, public, under the `@schemat` org):

- `@schemat/cli`  ← the `schemat` binary
- `@schemat/core`
- `@schemat/parser-dbml`
- `@schemat/parser-drizzle`
- `@schemat/parser-mikroorm`
- `@schemat/parser-mongoose`
- `@schemat/parser-prisma`
- `@schemat/parser-sequelize`
- `@schemat/parser-sql`
- `@schemat/parser-typeorm`
- `@schemat/render`
- `@schemat/web`

Six of these (cli, core, parser-prisma, parser-sql, render, web) are on npm at
`0.1.0`; the six newer parsers have never been published and will appear with
the next release.

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

### 4. Let Actions open the version PR

Repo → **Settings** → **Actions** → **General** → **Workflow permissions** →
tick **"Allow GitHub Actions to create and approve pull requests"**. Without it
the Release workflow fails with *"GitHub Actions is not permitted to create or
approve pull requests"* — the `permissions:` block in the workflow cannot grant
this by itself.

---

## First release (manual, once)

Only needed for a package that has never been published (npm rejects a
provenance publish for a brand-new name from CI in some setups). Publish by
hand from your machine, then CI takes over:

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
npm view @schemat/cli version    # -> the version you just published
npx @schemat/cli --version       # -> same
```

Then tag it:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

### The moving `v0` Action tag

The bundled GitHub Action is consumed as `alirezahamid/schemat@v0` (a moving
major tag). It currently points at the `0.2.1` release commit. After each
release, move it so consumers get updates without changing their workflow:

```bash
git tag -f v0 && git push origin v0 --force
```

Bump to `v1` only when you publish `1.0.0` (and keep `v0` frozen for older users).

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
