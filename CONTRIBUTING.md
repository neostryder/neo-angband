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
- **Prove the test bites.** Revert your fix, confirm the new test fails, then put
  the fix back. A test that passes either way documents nothing. (If you are
  testing core from a web test, remember `packages/web` imports the *built*
  core - run `npx tsc -b packages/core` first or the mutation is invisible.)

## The text census

`packages/cli/src/text-census.test.ts` is a CI gate on missing player-visible
text. It reads every string literal the C hands to `msg` / `msgt` / `get_check` /
`get_string` / `get_quantity` and fails if the port does not contain it.

It exists because reviewing code does not find code that was never written: this
port was declared complete several times and then found, by playing it, to be
missing messages nobody could see the absence of. So if you add a message the C
has, the gate goes quiet on its own; if you find one that is missing and *not*
listed, that is a real find.

```sh
pnpm --filter @neo-angband/cli census    # the current list, grouped by C file
```

Everything still absent is in `KNOWN_ABSENT` with the reason - host file I/O the
browser has no equivalent for, upstream's own malformed-gamedata diagnostics,
dead code in the C itself, a ratified divergence, or a tracked `GAP:` with what
it needs. The gate fails in **both** directions, so once you port a message you
must also delete its entry.

What it does not prove: that a message fires on the right event, in the right
order, with the right message type. Presence is a floor, not parity.

## The call-site census

`packages/cli/src/call-census.test.ts` is the companion gate. Where the text
census catches a message the port never says, this catches a *caller the port
never wires*: a function that IS ported, correct and tested, whose caller does
not exist. That is the shape of most of the bugs found by playing, because
reviewing the ported function finds nothing wrong with it.

```sh
pnpm --filter @neo-angband/cli call-census              # tier 1, the gate
pnpm --filter @neo-angband/cli call-census --shortfall  # + fewer-calls report
pnpm --filter @neo-angband/cli call-census --unmatched  # + unmatched report
```

Tier 1 is "the port defines a function of this upstream name and nothing in the
port mentions it". Everything it reports must be in `KNOWN_UNUSED` with a
reason - `renamed` / `reduced` / `host` / `dead-in-c`, or a tracked `LEAD` that
has not been run to ground yet. It fails in both directions, so wiring a caller
means deleting its entry.

Names are matched by stripping everything but letters and digits and
lowercasing, so `calc_inventory` and `calcInventory` are the same key. Tiers 2
and 3 (fewer call sites; no port symbol of that name) are reports, not gates -
too much of both is legitimate shape difference.

## Attribution

Neo Angband is built and maintained by neostryder at RPGM Tools. It is a
community port; all honor to the upstream Angband maintainers and contributors
whose work this builds on.
