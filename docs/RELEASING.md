# Releasing the npm packages

Two packages go to the public npm registry:

| Package | What it is |
| --- | --- |
| [`@neo-angband/core`](https://www.npmjs.com/package/@neo-angband/core) | the headless engine |
| [`@neo-angband/mod-sdk`](https://www.npmjs.com/package/@neo-angband/mod-sdk) | manifest schema, load-order resolver, record composition |

Everything else in `packages/` stays private: `web`, `desktop`, `cli` and `borg` are
applications, and `content` and `linoleum` are build-time tools with no consumer
outside this repository.

## The one thing to understand about npm

**npm does not watch this repository.** A package sits at whatever version was last
*pushed* to the registry; `master` moving does not move it, and there is no setting
that makes npm follow a branch or a tag. Every update is a push, and it is
irreversible — `npm unpublish` is refused after 72 hours, and a version number can
never be reused even inside that window.

So the push is automated off a git tag, and nothing else does it:

```bash
git tag v0.9.1 && git push --tags
```

`.github/workflows/publish-npm.yml` then builds, verifies the tarballs, checks the
tag agrees with both `package.json` versions, and publishes. A version already on
the registry is skipped rather than retried, so re-running a job that
half-published finishes the rest.

## First-time setup

Once, by hand. Nothing here is in the repository — a token in a file is a token
that leaks.

1. **An npm account.** <https://www.npmjs.com/signup>. The account name is public
   and appears as the publisher on every package page.
2. **Two-factor authentication.** Profile → Account → Two-Factor Authentication.
   npm requires 2FA on the account for a granular token to be able to publish.
3. **The organisation.** `@neo-angband` is a *scope*, and a scope that is not your
   username has to be an organisation: <https://www.npmjs.com/org/create>, name
   `neo-angband`. **Free** for public packages — the paid tier is only for private
   ones.
4. **A granular access token.** Profile → Access Tokens → Generate New Token →
   **Granular Access Token**. Not a classic token: a classic token can publish
   anything the account owns, and this one only needs these packages.
   - Expiration: set one (90 days is reasonable; the workflow fails loudly when it
     lapses, which is the point).
   - Packages and scopes: **Read and write**, limited to `@neo-angband/*`.
   - Organisations: `neo-angband`, **Read and write**.
5. **The repository secret.** In `neostryder/neo-angband` → Settings → Secrets and
   variables → Actions → New repository secret, named exactly `NPM_TOKEN`.
6. **Dry-run it before trusting it.** Actions → publish-npm → Run workflow, with
   *Pack and check, publish nothing* left ticked. It will pack, verify and print
   what it would publish. Then untick it, or push a tag.

Nothing else is needed. No author details beyond what is already in the manifests:
`author` is `neostryder (RPGM Tools)`, with **no email address**, deliberately —
npm shows the publishing account and that is enough.

## Bumping a version

The version lives in three places that must agree, and CI enforces two of them:

- `packages/core/package.json`
- `packages/mod-sdk/package.json`
- the git tag

Both packages move together, at the game's version. `0.9.x` is the pre-release
line; `1.0.0` is reserved for the game's public release, so nothing goes to `1.0.0`
before the game does.

## Why the tarball is checked and not just the source

`node tools/check-npm-package.mjs` packs each package, extracts it into an empty
directory with no `node_modules`, and imports every entry point with plain Node.

That is not ceremony. On 2026-07-31, with all 6655 tests passing, the engine's
emitted JavaScript held **4612 extensionless relative import specifiers** —
`export * from "./rng"` — because tsc emits specifiers verbatim and the source was
written for `moduleResolution: "bundler"`. Vite resolves those. Node does not. The
published `@neo-angband/core` would have been unimportable by anyone not using a
bundler, and nothing in the repository could have noticed, because vitest runs
through Vite too.

Two things came out of that and both are permanent:

- every relative import in a published package carries an explicit `.js`
  (`packages/core/src/npm-publish.test.ts` fails if one loses it, and
  `packages/core/scripts/codegen-lists.mjs` emits it);
- the artefact is loaded the way a consumer loads it, in CI, on every publish.

## If a publish fails

- **`ENEEDAUTH` / `E403`** — the token is missing, expired, or not scoped to
  `@neo-angband`. Regenerate at step 4 and replace the secret.
- **`E402 payment required`** — the scope is being treated as private. Both
  manifests set `publishConfig.access: "public"`; if it still happens, the
  organisation was created as a paid private org.
- **provenance rejected** — the workflow needs `id-token: write` (it has it) and a
  public repository. Provenance cannot be attached to a publish run from a laptop,
  which is a reason to publish from CI and not by hand.
- **tag/version mismatch** — the job fails before publishing anything. Fix the
  version, delete the tag (`git tag -d v0.9.1 && git push --delete origin v0.9.1`),
  re-tag.

## What is deliberately NOT published

- **`@neo-angband/content`** — Angband's gamedata compiled to packs. The engine
  cannot generate a populated level without it, so a mod test that needs a real
  dungeon needs content too. Publishing it is a live option, not an oversight; it
  is held back because it has no consumer yet and every publish is permanent.
- **A `create-neo-mod` scaffolder** — `docs/MODS.md` describes `neo-pack` as a
  planned validator/bundler CLI. It does not exist yet, and the name is not
  reserved on npm.
