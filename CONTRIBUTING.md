# Contributing to Neo Angband

Neo Angband is a modern TypeScript port of Angband 4.2.6. Thanks for helping.
This page is the short version of how the project is built and the rules that
keep it faithful. Read it once before your first change.

## Prerequisites

- **Node** `>=22` (the `.nvmrc` pins `24` - use it if you run `nvm`).
- **pnpm** `10.17.0` (the version in the root `package.json` `packageManager`
  field). Install with `corepack enable` or `npm i -g pnpm`.

This is a pnpm workspace (`pnpm-workspace.yaml`); all packages live under
`packages/`.

## Setup and core commands

```sh
pnpm install        # install the whole workspace
pnpm build          # tsc -b: typecheck and build every package
pnpm typecheck      # tsc -b (build is the typecheck; same command)
pnpm test           # vitest run across all packages
```

Run one area's tests by passing a path filter to the root test script:

```sh
pnpm test packages/core          # only the core engine tests
pnpm test packages/core/src/rng  # narrow to a file or name fragment
```

Package-specific scripts you may need (run with `pnpm --filter <name> <script>`):

- `@neo-angband/web` - `dev` (Vite dev server), `bundle` (Vite/PWA build).
- `@neo-angband/cli` - `scenarios` (golden parity scenarios), `stats`,
  `stats:baseline`, `spoil`.
- `@neo-angband/content` - `compile` (build the core content pack).
- `@neo-angband/desktop` - `start` / `dev` (Electron), `dist` (packaged app).
- `@neo-angband/linoleum` - the `neo-linoleum` tile-pack converter.

## Repository layout

The full package table lives in the [README](README.md#repository-layout) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In brief, the workspace holds:
`core` (headless engine), `content` (Angband 4.2.6 gamedata as the core pack),
`mod-sdk` (pack schemas, validation, tooling), `web` (web + PWA front-end),
`cli` (terminal front-end and dev/stats harness), `desktop` (Electron wrapper),
`linoleum` (tile-pack converter), and `borg` (the bundled autoplayer mod).

## The cardinal rule: faithfulness to Angband 4.2.6

The base game is a byte-faithful port of Angband 4.2.6. This is not a redesign.

- The original C tree lives buildable in [`reference/`](reference/) as the
  read-only golden-master oracle. **Never edit anything under `reference/`.**
- Ported code cites its upstream source in doc comments as `file:line`
  (relative to `reference/`), so any behavior can be traced back to the C that
  it locks in.
- When behavior and "improvement" disagree, faithfulness wins.

## Faithful core vs. mods

New behavior and UI-level quality-of-life do not go into the core. The base
game stays faithful; anything that adds or changes behavior ships as a **mod**.

- The base game is itself a content pack loaded through the same pipeline as
  any third-party mod.
- Conveniences, tweaks, and new systems live as mods - see
  [docs/MODS.md](docs/MODS.md) and the modding guides in
  [docs/modding/](docs/modding/).
- The bundled `qol`, `bug-fixes`, and `neo-linoleum` mods, and the `borg`
  autoplayer, are the worked examples of this boundary.

## Parity provenance ledger

Every ported module is mapped to its upstream source in the parity ledger
under [`parity/`](parity/README.md): one YAML file per module in
`parity/ledger/`, pinned to the `4.2.6` baseline. Add or update an entry
before a module's phase completes.

Status vocabulary (from [parity/README.md](parity/README.md)):

- `planned` - entry exists, port not started.
- `partial` - some upstream items ported, more remain.
- `ported` - behavior ported, not yet verified against the harness.
- `verified` - confirmed by at least one `verified-by` harness check.

New original code (UI, mod-sdk) needs no ledger entry.

## Code style

- **TypeScript strict** everywhere - the shared `tsconfig.base.json` turns on
  `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`, among others.
  Keep the build clean with no new errors.
- **Formatting** per `.editorconfig`: UTF-8, LF line endings, final newline,
  tabs at width 4 for code; 2-space indent for JSON, YAML, and Markdown.
- **ASCII only** in source and docs - no smart quotes, no em dashes (use
  " - "), no non-ASCII punctuation.
- **Lint** with `pnpm lint` (ESLint + typescript-eslint, flat config in
  `eslint.config.js`). It must report zero errors; the remaining warnings flag
  known parity idioms and are acceptable. CI runs it as a gate.

## Testing expectations

- New ported behavior gets vitest coverage that cites the C lines it locks in,
  the same way the ported code does.
- CI (`.github/workflows/ci.yml`) runs on Node 24 and must stay green: it does
  `pnpm build`, `pnpm lint`, the web `bundle`, `pnpm test`, and the CLI parity
  `scenarios` as a standalone run.
- Run `pnpm test` (and, for engine changes, `pnpm --filter @neo-angband/cli
  scenarios`) locally before opening a pull request.

## Attribution

Neo Angband is built and maintained by neostryder at RPGM Tools. It is a
community port; all honor to the upstream Angband maintainers and contributors
whose work this builds on.
