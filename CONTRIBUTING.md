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
pnpm check:private  # refuse private information in a public repo (see below)
```

Enable the repository's git hooks once per clone:

```sh
git config core.hooksPath .githooks
```

That installs a `pre-commit` gate which runs `pnpm check:private` over the
**staged** content. The same hook gates a `neo-angband-mod-*` clone if you point
that clone's `core.hooksPath` at this one's `.githooks` - it needs no files of its
own. See [Keeping the repository publishable](#keeping-the-repository-publishable).

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
- The first-party `qol`, `bug-fixes` and `neo-linoleum` mods, and the `borg`
  autoplayer, are the worked examples of this boundary. `qol` and `bug-fixes`
  are bundled; `neo-linoleum` installs from its own repository, because its six
  converted tile packs are the mod's art and not the game's.

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

## Keeping the repository publishable

This repository is public, and a small set of strings must never appear in it:
the maintainer's legal name, work email or employer, private project codenames,
paths inside the private workspace, and absolute paths that name a machine's
user account. All of them are natural things to type while working - a code
comment attributing a decision, a hardcoded tool path in a throwaway script -
which is exactly why the rule needs a machine behind it.

```sh
node tools/private-scan.mjs            # every tracked file (the CI gate)
node tools/private-scan.mjs --staged   # what is about to be committed (the hook)
```

Two rule tiers, in `tools/private-scan.mjs`:

- **Always** - terms with no legitimate use here. Any hit fails.
- **Baselined** - terms that ARE legitimate in specific places and private
  elsewhere. One codename is also upstream Angband content: it is a syllable in
  `names.txt` and part of an artifact description in `artifact.txt`, both of which
  the port mirrors verbatim. Likewise an absolute path under a user profile is a
  leak in a build script and a perfectly good invented test fixture. These are
  accounted for per file, with a count and a reason, in
  `tools/private-scan-baseline.json`.

  (This section deliberately does not spell those terms out - it would trip the
  scan it is describing, and baselining the documentation would put noise in the
  file that is supposed to hold only real exceptions.)

The baseline fails in **both** directions: an unlisted occurrence fails, and so
does an entry that no longer matches. A one-way allowlist keeps passing long
after the thing it excused is gone, and then quietly excuses whatever moved into
the same file. Raising a count is a deliberate act - say why in the entry.

`reference/**` is exempt: it is upstream Angband, vendored verbatim and never
edited. `tools/private-scan*` is exempt too, because it has to contain the
patterns in order to test for them - a real hole, stated rather than hidden.

### The two gates cover different things

`packages/cli/src/private-scan.test.ts` runs the whole-tree scan in CI, and also
plants deliberately-bad fixtures to prove the detector still bites - a scanner
broken to always pass would satisfy a clean-tree assertion on its own.

But the whole-tree scan asks `git ls-files`, so **a brand-new file is invisible
to it** until that file is committed - and for a public repository, "committed
and pushed" is already too late. The `pre-commit` hook reads the staged blobs, so
it is the only gate that sees a new file in time. Measured, not assumed: a
fixture naming the private workspace was reported clean by the tree scan and
caught by the hook, in the same working state. Both were correct.

So neither substitutes for the other. The hook still needs enabling per clone and
`git commit --no-verify` walks past it; the CI scan is what catches whatever got
in around it, later.

### The mod repositories use this same scanner

`neo-angband-mod-*` are public too, and the terms leak into them for the same
reasons. They do **not** get a copy of the scanner: two copies of a rule list
drift, and the copy that quietly stops matching is the one nobody opens. Both
gates reach them from here.

The hook needs no file in the mod repository at all - point `core.hooksPath` at
this checkout, once per clone:

```sh
git config core.hooksPath /path/to/neo-angband/.githooks
```

The hook resolves the scanner relative to itself and passes the repository being
committed to as `--root`. If it cannot find the scanner it **fails the commit**
rather than exiting 0: a hook that silently passes reports success forever, and
the first anyone hears of it is after the leak.

For CI, a mod repository's workflow uses the composite action, which pins the
action and the scanner to one ref because GitHub checks this whole repository out
to run it:

```yaml
- uses: actions/checkout@v4
- uses: neostryder/neo-angband/.github/actions/private-scan@master
```

Scanning another tree by hand:

```sh
node tools/private-scan.mjs --root ../neo-angband-mod-linoleum
```

The rules are shared; the **baseline is per-root**
(`<root>/tools/private-scan-baseline.json`), because what is legitimately
present differs by repository. A `--root` that is not a directory is refused
outright - falling back to this repository would report a pass for a tree nobody
asked about.

## Attribution

Neo Angband is built and maintained by neostryder at RPGM Tools. It is a
community port; all honor to the upstream Angband maintainers and contributors
whose work this builds on.
