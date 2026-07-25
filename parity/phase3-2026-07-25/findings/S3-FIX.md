# S3 fix — species-mix divergence

Date: 2026-07-25  
Worktree: `C:\Repositories\na-wt-moncmd`  
Branch: `p3/s3-fix`

The fixes below were applied in the requested order. `reference/` was not
modified. `packages/core/src/game/mon-place.ts:739-765` was not modified.

## 1. RC1 — `pickAndPlaceDistantMonster`

**Authority:** `reference/src/mon-make.c:1483-1520`  
**Port:** `packages/core/src/gen/util.ts:1830-1850`

The generation helper now matches the C helper: it samples the full map with
`randint0(width)` then `randint0(height)`, rejects non-empty squares, rejects
`SQUARE.MON_RESTRICT` squares during generation, accepts only
`distance(grid, toAvoid) > dis`, and uses one pre-decremented 10,000-attempt
loop. The max-sight floor, retry-distance halving, interior-only coordinates,
and fallback loops were removed.

RNG sequence per attempted location is exactly:

1. `randint0(width)` for `grid.x`;
2. `randint0(height)` for `grid.y`;
3. no RNG for occupancy, restriction, or distance tests;
4. after an accepted location, the existing `pickAndPlaceMonster` sequence
   begins; after 9,999 failed attempts, return false without a monster-choice
   draw.

This restores C's `while (--attempts_left)` count: 9,999 attempts, not 10,000.

## 2. RC3 — generation `curNum`

**Authority:** `reference/src/mon-make.c:1041-1046` and unique gate at
`reference/src/mon-make.c:257-258`  
**Port:** `packages/core/src/gen/util.ts:1576`

Successful generation placement now increments `race.curNum` immediately after
the monster is attached and before drop/mimic creation. This is the boundary
used by C. The level-local `placedUniques` set remains as a defensive placement
check. Cave-symmetry copies at `packages/core/src/gen/cave.ts:950` still call
`attachMonster` directly and therefore do not increment a second time.

The increment itself consumes no RNG. Its stream effect is that once a unique
has been successfully placed, later `get_mon_num` calls exclude it before the
weighted choice/OOD draws; the failed-selection/rejection cycle that the old
port spent is removed. For a successful placement, the existing sequence after
the count boundary is unchanged: monster construction, then specified-drop
draws, then mimic-object draws.

## 3. Prepend-order defects

### Friends and friends-base

**Authority:** `reference/src/mon-init.c:1563-1630`  
**Port:** `packages/core/src/mon/bind.ts:739-762`; consumers are
`packages/core/src/gen/util.ts:1758-1804` and
`packages/core/src/game/mon-place.ts:583-620`

The two C lists are separate head-inserted lists, so `friends` and
`friends-base` are each reversed independently at bind time.

No binding RNG is consumed. At use time, each entry keeps C's sequence of
`randint0(100)`, conditional `damroll(dice, sides)`, and, for friends-base,
the existing allocation-table `getMonNum` sequence. The same number of draws
is made for a fixed walk; the draws are attached to the C-order companion and
group packing now follows that order.

### Drop and drop-base — one combined list

**Authority:** `reference/src/mon-init.c:1507-1559`  
**Port:** `packages/content/src/records.ts:28,245-249`,
`packages/content/src/specs/mon-init.ts:129-139`, and
`packages/core/src/mon/bind.ts:514-537`

C prepends both directives into one `r->drops` list. The content compiler now
preserves one `drop-order` encounter stream, and the binder reverses that one
combined stream. It does not reverse `drop` and `drop-base` independently. For
older/custom packs without metadata, the fallback still concatenates once and
reverses once.

For each bound drop, the runtime sequence remains C's
`randint0(100)`, followed on a passing gate by
`randint0(max - min) + min`; selected drops then run their existing object
creation tail. The number of gates is unchanged, but cross-directive order and
therefore any conditional object-generation tail now follow C.

### Room templates and vaults

**Authority:** `reference/src/generate.c:323` and `:484`  
**Port:** `packages/core/src/gen/room.ts:127-160`

Room-template and vault records are loaded in reverse file order, matching the
C head-inserted lists. Loading consumes no RNG. Each reservoir walk still makes
one `oneIn(n)` draw per eligible candidate; reversing the list changes which
candidate receives each draw while preserving draw count and uniformity.

### Mimic kinds and preferred shapes

**Authority:** `reference/src/mon-init.c:1632-1674`  
**Port:** `packages/core/src/mon/bind.ts:765-771`

The `mimic` and `shape` arrays are each reversed at bind time. Binding consumes
no RNG. Later mimic selection and shape selection retain their existing draw
counts and operations, but the selected candidate now corresponds to the
head-first C list.

### Alternate spell messages

**Authority:** `reference/src/mon-init.c:1447` and
`reference/src/mon-spell.c:72-90`  
**Port:** `packages/core/src/mon/bind.ts:483-501`, consumed by
`packages/core/src/game/mon-message.ts:185-193`

Each message-type source array is reversed before being appended to the bound
list. This preserves the C first-match rule for duplicate same-spell,
same-type overrides. Binding and lookup consume no RNG; spell casting's RNG
sequence is otherwise unchanged.

## Statistical measurement

Both runs used the required command with the committed C baseline and the
default port sample of 400 levels per depth. The test intentionally failed in
both runs because the species comparison was not yet green.

### Before

| depth | G | df | p |
|---:|---:|---:|---:|
| 1 | 74.2 | 53 | 0.0291 |
| 2 | 70.1 | 64 | 0.2791 |
| 3 | 75.7 | 80 | 0.6162 |
| 4 | 80.4 | 95 | 0.8579 |
| 5 | 823.4 | 138 | 4.81e-98 |
| 6 | 746.9 | 149 | 2.37e-80 |
| 7 | 485.8 | 162 | 4.64e-34 |
| 8 | 534.7 | 180 | 7.15e-37 |
| 9 | 515.4 | 182 | 1.23e-33 |
| 10 | 388.8 | 192 | 1.88e-15 |
| 11 | 504.8 | 196 | 4.08e-29 |
| 12 | 576.9 | 209 | 3.39e-36 |
| 13 | 452.4 | 217 | 1.10e-18 |
| 14 | 805.1 | 224 | 1.60e-66 |
| 15 | 789.0 | 235 | 5.01e-61 |
| 16 | 786.6 | 251 | 1.50e-56 |
| 17 | 723.6 | 259 | 1.52e-45 |
| 18 | 739.3 | 267 | 6.04e-46 |
| 19 | 770.9 | 275 | 1.38e-48 |
| 20 | 928.5 | 303 | 1.11e-64 |

### After

| depth | G | df | p |
|---:|---:|---:|---:|
| 1 | 50.4 | 53 | 0.5744 |
| 2 | 67.3 | 64 | 0.3663 |
| 3 | 118.8 | 80 | 0.0032 |
| 4 | 164.7 | 98 | 2.85e-5 |
| 5 | 681.9 | 138 | 7.09e-73 |
| 6 | 753.2 | 148 | 8.42e-82 |
| 7 | 457.7 | 161 | 3.05e-30 |
| 8 | 651.0 | 181 | 2.81e-54 |
| 9 | 583.6 | 185 | 7.60e-43 |
| 10 | 506.8 | 193 | 5.08e-30 |
| 11 | 752.1 | 196 | 4.18e-66 |
| 12 | 699.8 | 210 | 5.63e-54 |
| 13 | 741.5 | 216 | 8.64e-59 |
| 14 | 888.4 | 221 | 8.68e-81 |
| 15 | 713.6 | 235 | 1.03e-49 |
| 16 | 770.6 | 250 | 2.00e-54 |
| 17 | 636.7 | 257 | 3.57e-34 |
| 18 | 868.8 | 269 | 2.65e-64 |
| 19 | 761.7 | 276 | 4.59e-47 |
| 20 | 721.7 | 301 | 1.46e-36 |

Depth 5 improved from `G=823.4` to `681.9`, and depth 7 from `485.8` to
`457.7`, but the corrected batch is still significantly divergent at depths
4-20 (depth 3 is also below the Bonferroni threshold). Density and the level
feelings remained broadly non-significant in the after run; the residual is
primarily species mix.

## Pit/nest residual telemetry

Because pit-only races remain divergent, the generation context now records
RNG-neutral pit/nest attempts, selected profile, and empty-hook failures. A
400-run, depths 5-8 diagnostic using the same base seed (`1337`) produced:

| depth | pit attempts | nest attempts | pit empty | nest empty |
|---:|---:|---:|---:|---:|
| 5 | 35 | 21 | 0 | 0 |
| 6 | 22 | 23 | 0 | 0 |
| 7 | 20 | 22 | 0 | 0 |
| 8 | 29 | 21 | 0 | 0 |

Selected profiles were: depth 5 pits `Orc 5, Spellcasters 5, Minor demons 5,
Kobolds 10, Ogres 2, Naga 3, Believers 1, Thieves 1, Warriors 3`; nests
`Creepy crawlies 3, Ants 8, Jelly 9, Lesser undead 1`. Depth 6 pits `Naga 1,
Kobolds 6, Orc 4, Spellcasters 3, Eyes 1, Minor demons 4, Warriors 2,
Thieves 1`; nests `Creepy crawlies 6, Jelly 6, Ants 10, Lesser undead 1`.
Depth 7 pits `Minor demons 3, Spellcasters 1, Kobolds 8, Eyes 2, Orc 3,
Naga 2, Thieves 1`; nests `Ants 12, Jelly 6, Creepy crawlies 4`. Depth 8
pits `Kobolds 11, Minor demons 6, Spellcasters 6, Orc 1, Naga 2, Thieves 1,
Warriors 2`; nests `Ants 12, Jelly 6, Creepy crawlies 2, Serpents 1`.

The after sample's pit-only counts still differ materially from C:

| depth | race | C | port |
|---:|---|---:|---:|
| 5 | warrior | 71 | 111 |
| 5 | ogre | 40 | 68 |
| 6 | warrior | 54 | 42 |
| 6 | ogre | 114 | 0 |
| 7 | warrior | 45 | 0 |
| 7 | ogre | 46 | 1 |
| 8 | warrior | 124 | 59 |
| 8 | ogre | 40 | 0 |

There were no empty pit/nest hook failures in this port diagnostic. This is
evidence for a remaining profile-selection/room-attempt or surrounding
generation-stream divergence, not evidence that pit weights should be tuned.
No pit weights or pit data were changed.

## Verification and expected regressions

- `pnpm typecheck`: passed.
- Focused bind/placement tests: 107 passed; two existing generation assertions
  fail because corrected reverse vault order selects the other duplicate `Round`
  record and changes one deep generated layout.
- `pnpm vitest run packages/cli/src/parity-c-stat.test.ts --testTimeout=600000`:
  failed as expected; the after table above is its output.
- `pnpm vitest run packages/cli/src/parity.test.ts --testTimeout=30000`:
  failed as expected. The self-regression guard reported `depths.1.monsterTotal:
  baseline=91 fresh=97`, `depths.1.objectTotal: baseline=38 fresh=49`, and 842
  additional differences; the golden `descend` scenario reported
  `monsterCount: expected 33, got 44`. The baseline was not regenerated.

No commit was made.
