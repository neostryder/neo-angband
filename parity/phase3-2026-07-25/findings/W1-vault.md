# W1-vault — the seven `build_vault_type`/`help_greater_vault` wrappers

Batch: `build_interesting`, `build_lesser_vault`, `build_lesser_new_vault`,
`build_medium_vault`, `build_medium_new_vault`, `build_greater_vault`,
`build_greater_new_vault` (reference/src/gen-room.c:2988-3128).

## Inherited-hunk table (commit c4cbe156e)

| file | hunk | verdict | reference | test |
|---|---|---|---|---|
| gen/cave.ts | `profileBuilderKey`/`roomBuilderKey` doc comments | KEEP | generate.c:1561,1570,1590,1600,1612; generate.c:171-177 `parse_profile_room` | doc-only, no behaviour; line refs verified by reading generate.c |
| gen/cave.ts | `makeGen`: `ctx.dun.profileName = ctx.profile.name` | KEEP | generate.c:1157 `dun->profile = choose_profile(p)` | gen.test.ts "has the live builder path publish the profile name onto dun"; mutation-killed (below) |
| gen/room.ts | `buildVaultType` doc comment | KEEP | gen-room.c:1712, 2988/3001/3014/3027/3040 | doc-only |
| gen/room.ts | new `helpGreaterVault` function | KEEP | gen-room.c:3075-3102 `help_greater_vault` | help_greater_vault describe block (5 tests); mutation-killed |
| gen/room.ts | registry: `greater_vault`/`greater_new_vault` now call `helpGreaterVault` instead of `buildVaultType` | KEEP | gen-room.c:3112-3128 | same describe block; mutation-killed (reverting to plain `buildVaultType` fails 3 tests) |
| gen/util.ts | `Dun.profileName = ""` field | KEEP | generate.c:1157 (backing state for the above) | enforced by TS (referenced in room.ts/cave.ts); behaviour covered by the profile-publish test above |
| gen/util.ts | `CaveFinder.reset` doc comment | KEEP | gen-util.c:187 `cave_find_reset` | doc-only |
| session/game.ts | `chunk_list_add` doc comment on the cache `.set()` | KEEP | gen-chunk.c:69-79 | doc-only, no behaviour change |
| gen/gen.test.ts | STRANDED list re-pin (8 deep seeds swapped) | KEEP | verified live: `bugfix.stairsReachable` test actually re-runs `generateLevel` per seed and asserts stranding, not a hardcoded truth table | ran full gen.test.ts: 87/87 pass |
| session/qol-defaults.test.ts | STRANDED list re-pin (3 deep seeds swapped) | KEEP | same as above, through `startGame` | ran full file: 8/8 pass |
| gen/gen.test.ts | new `room builder registry` describe block | KEEP | generate.c:1561 `get_room_builder_count`, list-rooms.h (19 `ROOM(...)` entries, counted directly) | test itself is the proof; passes |

**0 REVERT, 0 REWORK, 11 KEEP.** The inherited snapshot is the correct fix for a
real bug: before it, `greater_vault`/`greater_new_vault` were wired straight to
`buildVaultType` with no gate, so a greater vault was built as the first room of
virtually every level at depth 35+ (measured 120/120 at both depth 40 and 90 in
the now-superseded STRANDED comments). Restoring `help_greater_vault` is what
shifted the RNG stream and required the STRANDED re-pins — a legitimate
consequence, not a hidden bug.

## Lane table — all 7 upstream symbols

| C symbol | verdict | evidence |
|---|---|---|
| `build_interesting` (gen-room.c:2988) | PORTED | registry `"interesting"` -> `buildVaultType(g, centre, "Interesting room", vaults)`, string matches exactly |
| `build_lesser_vault` (3001) | PORTED | `"lesser_vault"` -> `buildVaultType(..., "Lesser vault", ...)` |
| `build_lesser_new_vault` (3014) | PORTED | `"lesser_new_vault"` -> `buildVaultType(..., "Lesser vault (new)", ...)` |
| `build_medium_vault` (3027) | PORTED | `"medium_vault"` -> `buildVaultType(..., "Medium vault", ...)` |
| `build_medium_new_vault` (3040) | PORTED | `"medium_new_vault"` -> `buildVaultType(..., "Medium vault (new)", ...)` |
| `build_greater_vault` (3112) | PORTED | `"greater_vault"` -> `helpGreaterVault(g, centre, "Greater vault", vaults)`; gate logic verified line-for-line below |
| `build_greater_new_vault` (3125) | PORTED | `"greater_new_vault"` -> `helpGreaterVault(g, centre, "Greater vault (new)", vaults)` |

`help_greater_vault` (3075, the shared gate behind the last two) verified
line-for-line: the `cent_n - nstair_room > (findingSpace ? 0 : 1)` guard, the
`for (i = 90; i > depth; i -= 10)` ladder building `numerator`/`denominator`,
the `randint0(denominator) >= numerator` draw, and the
`profileName !== "classic" && !oneIn(3)` rejection all match gen-room.c:3086-3099
in order, with no extra or reordered RNG draws. `rating` is accepted and
ignored by all 7 registry callbacks, matching the C doc comments
("rating is not used for this room type").

No GAPs found in this batch — all 7 wrappers PORTED, 0 P0-P3.

## Mutation table

| mutation | test that caught it | pre-existing suite (pre-WIP) would have caught it? |
|---|---|---|
| `greater_vault` registry reverted to `buildVaultType` direct (drops gate) | 3 of 5 `help_greater_vault` tests fail (`refuses...first room`, `applies the depth ladder`, `rejects...non-classic`) | No — those tests did not exist before this WIP snapshot |
| removed `ctx.dun.profileName = ctx.profile.name` in `makeGen` | `help_greater_vault > has the live builder path publish the profile name onto dun` fails (`''` !== `'classic'`) | No — same |

Both mutations applied and reverted in-place during this session; working tree
confirmed clean after restore (`git diff --stat` empty on both files).

## Suites run

- `npx vitest run packages/core/src/gen/gen.test.ts packages/core/src/session/qol-defaults.test.ts` → 2 files, 95/95 pass.
- `npx pnpm --filter @neo-angband/core build` → exit 0, no TS errors.

## Closing count

11/11 inherited hunks KEEP, 0 REVERT, 0 REWORK. 7/7 batch symbols PORTED. 0 GAPs.
2/2 mutations killed by new tests, 0/2 would have been caught by the
pre-existing suite. Nothing in the brief turned out wrong for this lane — the
batch really was already fixed by the WIP snapshot; the work here was
verification, not implementation.
