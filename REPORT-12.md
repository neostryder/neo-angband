# Issue 12 report

## Commits

- Implementation: 94de8ca8b32ed530dc69bd2bacfe98cbf824fa6c

## Surface enumeration

The complete code-derived inventory is in
docs/design/PRESENTATION_OWNER_SEAM.md.

| Surface family | Count |
| --- | ---: |
| HUD regions | 3 |
| Menu presentation seams | 1 |
| Full-screen terminal erase paths | 33 |
| Full-screen compositor repaints | 1 |
| Modelled semantic screen ids | 40 |
| Unmodelled semantic fallbacks | 1 shared core:text id |

The 33 full-screen paths consist of 31 region-declared paths and 2 pending
prompt paths. The source ratchet derives 34 clear sites including the
compositor in packages/web/src/main-regions.test.ts. The old approximately 50
screen estimate was corrected in docs/modding/MOD_REACH.md.

## Landed

- The HUD presentation owner seam independently routes messages, vitals, and
  the status line through manifest-consented sinks, with core candidate zero,
  immutable frame snapshots, and per-region fault recovery.
- The new runtime test proves three separately consented plugins receive only
  messages, sidebar, and status respectively, with no core HUD drawing.
- Menu presentation composes after registry:menu has transformed rows.
- Full-screen presentation uses ScreenView documents, with 40 modelled ids and
  core fallback for a declined or failed presenter.
- The design states the declaration shape, host guarantees, compatibility
  degradation, surface inventory, and the shared ScreenRegion reconciliation
  point for issue #17 player layout work.

## Remaining

- The two nested prompt erase paths, promptNumber and promptText, still need
  region treatment.
- Screens delivered through the shared core:text fallback can be frame-reskinned
  but cannot yet be safely rebuilt as distinct semantic listings.
- Screens and menus outside their shared presenter paths still need conversion.
- Player layout persistence must update the same ScreenRegion objects and live
  stack consumed by presentation owners, rather than maintaining a parallel
  layout system.

## Verification

The first pnpm build attempt could not start because the fresh worktree had no
node_modules directory and tsc was unavailable. pnpm install --frozen-lockfile
completed successfully. The required sequence was then rerun from the first
build. No test timeout occurred, and test-collection.test.ts did not fail in
this worktree.

1. pnpm build

    > neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\gap21-presentation
    > tsc -b

2. pnpm exec vitest run packages/web/src packages/core/src

     RUN  v4.1.11 C:/Repositories/_worktrees/neo-angband/gap21-presentation

    (node:57184) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:36264) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:57784) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:58224) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:61540) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:20612) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:47436) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:56028) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:42744) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:38976) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:54768) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:33144) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:5572) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:4356) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:53756) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:51592) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:17652) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:25020) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:25288) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:11068) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:40928) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:41644) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:22892) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:22568) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:57504) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)
    (node:61800) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
    (Use `node --trace-warnings ...` to show where the warning was created)

     Test Files  522 passed | 1 skipped (523)
          Tests  9572 passed | 9 skipped (9581)
       Start at  13:02:33
       Duration  113.90s (transform 52.51s, setup 0ms, import 327.90s, tests 195.08s, environment 53ms)

3. pnpm lint

    > neo-angband@1.8.0 lint C:\Repositories\_worktrees\neo-angband\gap21-presentation
    > eslint .

4. pnpm build

    > neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\gap21-presentation
    > tsc -b
