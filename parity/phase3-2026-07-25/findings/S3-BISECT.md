# S-3 bisect findings

Date: 2026-07-25  
Worktree: `C:\Repositories\na-wt-moncmd`  
Measurement: `master` baseline, fixed seed `1337`, 400 port levels per depth,
`packages/cli/src/parity-c-stat.test.ts`. Each variant was rebuilt with
`pnpm build` before the test so Vitest did not use stale `packages/*/dist`.

`delta-G` is variant G minus the master G. Negative is closer to the C
histogram; positive is farther away. The verdict is based on the aggregate
species G over depths 1--20, with the shallow-depth regression called out
separately.

## 1. Bisect matrix

### Per-depth G / df / p

Cells are `G / df / p`; `p<1e-4` means the test output rounded to `0.0000`.

| depth | master | RC1 | RC3 | friends | drop | room | mimic/shape | alt messages |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 74.2/53/.0291 | 75.2/53/.0242 | 71.6/53/.0453 | 63.4/53/.1545 | 74.2/53/.0291 | 39.5/53/.9158 | 74.2/53/.0291 | 74.2/53/.0291 |
| 2 | 70.1/64/.2791 | 83.9/64/.0480 | 58.5/64/.6698 | 73.5/64/.1945 | 70.1/64/.2791 | 68.0/64/.3415 | 70.1/64/.2791 | 70.1/64/.2791 |
| 3 | 75.7/80/.6162 | 108.8/80/.0179 | 91.3/80/.1826 | 88.2/80/.2473 | 75.7/80/.6162 | 88.2/80/.2478 | 75.7/80/.6162 | 75.7/80/.6162 |
| 4 | 80.4/95/.8579 | 104.6/96/.2580 | 103.7/96/.2782 | 100.3/94/.3092 | 80.4/95/.8579 | 112.5/97/.1345 | 80.4/95/.8579 | 80.4/95/.8579 |
| 5 | 823.4/138/<1e-4 | 699.6/138/<1e-4 | 824.8/138/<1e-4 | 562.9/138/<1e-4 | 823.4/138/<1e-4 | 698.0/138/<1e-4 | 823.4/138/<1e-4 | 823.4/138/<1e-4 |
| 6 | 746.9/149/<1e-4 | 815.8/146/<1e-4 | 877.8/148/<1e-4 | 744.1/149/<1e-4 | 746.9/149/<1e-4 | 800.7/148/<1e-4 | 746.9/149/<1e-4 | 746.9/149/<1e-4 |
| 7 | 485.8/162/<1e-4 | 433.1/161/<1e-4 | 435.3/161/<1e-4 | 494.7/161/<1e-4 | 485.8/162/<1e-4 | 402.9/159/<1e-4 | 485.8/162/<1e-4 | 485.8/162/<1e-4 |
| 8 | 534.7/180/<1e-4 | 580.3/179/<1e-4 | 453.1/179/<1e-4 | 750.3/179/<1e-4 | 534.7/180/<1e-4 | 635.4/179/<1e-4 | 534.7/180/<1e-4 | 534.7/180/<1e-4 |
| 9 | 515.4/182/<1e-4 | 559.5/182/<1e-4 | 610.2/182/<1e-4 | 578.9/181/<1e-4 | 515.4/182/<1e-4 | 462.9/181/<1e-4 | 515.4/182/<1e-4 | 515.4/182/<1e-4 |
| 10 | 388.8/192/<1e-4 | 469.8/192/<1e-4 | 392.4/192/<1e-4 | 415.3/192/<1e-4 | 388.8/192/<1e-4 | 460.7/192/<1e-4 | 388.8/192/<1e-4 | 388.8/192/<1e-4 |
| 11 | 504.8/196/<1e-4 | 643.3/199/<1e-4 | 453.0/199/<1e-4 | 647.5/196/<1e-4 | 504.8/196/<1e-4 | 538.2/197/<1e-4 | 504.8/196/<1e-4 | 504.8/196/<1e-4 |
| 12 | 576.9/209/<1e-4 | 562.1/210/<1e-4 | 579.7/209/<1e-4 | 669.6/211/<1e-4 | 576.9/209/<1e-4 | 686.0/208/<1e-4 | 576.9/209/<1e-4 | 576.9/209/<1e-4 |
| 13 | 452.4/217/<1e-4 | 578.8/218/<1e-4 | 578.6/216/<1e-4 | 504.6/217/<1e-4 | 452.4/217/<1e-4 | 667.4/216/<1e-4 | 452.4/217/<1e-4 | 452.4/217/<1e-4 |
| 14 | 805.1/224/<1e-4 | 878.0/225/<1e-4 | 871.1/225/<1e-4 | 764.8/221/<1e-4 | 805.1/224/<1e-4 | 708.0/226/<1e-4 | 805.1/224/<1e-4 | 805.1/224/<1e-4 |
| 15 | 789.0/235/<1e-4 | 672.3/235/<1e-4 | 720.6/237/<1e-4 | 763.0/237/<1e-4 | 789.0/235/<1e-4 | 800.5/236/<1e-4 | 789.0/235/<1e-4 | 789.0/235/<1e-4 |
| 16 | 786.6/251/<1e-4 | 828.2/249/<1e-4 | 901.4/252/<1e-4 | 799.8/250/<1e-4 | 786.6/251/<1e-4 | 477.1/251/<1e-4 | 786.6/251/<1e-4 | 786.6/251/<1e-4 |
| 17 | 723.6/259/<1e-4 | 830.5/257/<1e-4 | 967.0/260/<1e-4 | 1021.3/256/<1e-4 | 733.9/260/<1e-4 | 690.2/257/<1e-4 | 723.6/259/<1e-4 | 723.6/259/<1e-4 |
| 18 | 739.3/267/<1e-4 | 767.9/269/<1e-4 | 677.3/271/<1e-4 | 643.7/270/<1e-4 | 735.9/268/<1e-4 | 1146.4/270/<1e-4 | 739.3/267/<1e-4 | 739.3/267/<1e-4 |
| 19 | 770.9/275/<1e-4 | 729.8/274/<1e-4 | 899.5/277/<1e-4 | 869.9/275/<1e-4 | 774.3/275/<1e-4 | 713.3/272/<1e-4 | 770.9/275/<1e-4 | 770.9/275/<1e-4 |
| 20 | 928.5/303/<1e-4 | 951.7/296/<1e-4 | 997.2/300/<1e-4 | 778.2/301/<1e-4 | 914.9/303/<1e-4 | 1015.8/302/<1e-4 | 927.7/302/<1e-4 | 928.5/303/<1e-4 |

### Delta-G matrix

| depth | RC1 | RC3 | friends | drop | room | mimic/shape | alt messages |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | +1.0 | -2.6 | -10.8 | 0.0 | -34.7 | 0.0 | 0.0 |
| 2 | +13.8 | -11.6 | +3.4 | 0.0 | -2.1 | 0.0 | 0.0 |
| 3 | +33.1 | +15.6 | +12.5 | 0.0 | +12.5 | 0.0 | 0.0 |
| 4 | +24.2 | +23.3 | +19.9 | 0.0 | +32.1 | 0.0 | 0.0 |
| 5 | -123.8 | +1.4 | -260.5 | 0.0 | -125.4 | 0.0 | 0.0 |
| 6 | +68.9 | +130.9 | -2.8 | 0.0 | +53.8 | 0.0 | 0.0 |
| 7 | -52.7 | -50.5 | +8.9 | 0.0 | -82.9 | 0.0 | 0.0 |
| 8 | +45.6 | -81.6 | +215.6 | 0.0 | +100.7 | 0.0 | 0.0 |
| 9 | +44.1 | +94.8 | +63.5 | 0.0 | -52.5 | 0.0 | 0.0 |
| 10 | +81.0 | +3.6 | +26.5 | 0.0 | +71.9 | 0.0 | 0.0 |
| 11 | +138.5 | -51.8 | +142.7 | 0.0 | +33.4 | 0.0 | 0.0 |
| 12 | -14.8 | +2.8 | +92.7 | 0.0 | +109.1 | 0.0 | 0.0 |
| 13 | +126.4 | +126.2 | +52.2 | 0.0 | +215.0 | 0.0 | 0.0 |
| 14 | +72.9 | +66.0 | -40.3 | 0.0 | -97.1 | 0.0 | 0.0 |
| 15 | -116.7 | -68.4 | -26.0 | 0.0 | +11.5 | 0.0 | 0.0 |
| 16 | +41.6 | +114.8 | +13.2 | 0.0 | -309.5 | 0.0 | 0.0 |
| 17 | +106.9 | +243.4 | +297.7 | +10.3 | -33.4 | 0.0 | 0.0 |
| 18 | +28.6 | -62.0 | -95.6 | -3.4 | +407.1 | 0.0 | 0.0 |
| 19 | -41.1 | +128.6 | +99.0 | +3.4 | -57.6 | 0.0 | 0.0 |
| 20 | +23.2 | +68.7 | -150.3 | -13.6 | +87.3 | -0.8 | 0.0 |

| change | verdict | aggregate observation |
|---|---|---|
| RC1 distant-monster placement | **HURTS** | Mean delta-G `+25.0`; 15 depths rose, including `+33.1` at depth 3 and `+24.2` at depth 4. |
| RC3 generation `curNum` | **HURTS** | Mean delta-G `+34.6`; depth 3/4 rose `+15.6/+23.3`, and depth 6 rose `+130.9`. |
| friends / friends-base | **HURTS** | Mean delta-G `+23.1`; depth 3/4 rose `+12.5/+19.9`; depth 5 improves but does not offset the rest. |
| drop / drop-base plus pack format | **NEUTRAL** | Mean delta-G `-0.2`; no change through depth 16, then only small downstream changes. |
| room templates / vaults | **HURTS** | Mean delta-G `+17.0`; depth 4 rises `+32.1` and depth 18 rises `+407.1`, despite useful reductions at several other depths. |
| mimic kinds / preferred shapes | **NEUTRAL** | Identical to master through depth 19; depth 20 changes by `-0.8`. |
| alternate spell messages | **NEUTRAL** | Species histogram is byte-for-byte unchanged at all sampled depths. |

The shallow regressions are therefore not attributable to one single prepend
change. RC1, RC3, friends, and room reversal all produce a new depth-3/4
divergence when isolated. The drop change does not explain those regressions.

## 2. Prepend-order audit

The relevant C finish functions were checked rather than assuming that every
head-inserted list needs a reversal.

- `reference/src/mon-init.c:1507-1667` assigns each repeated monster field with
  `new->next = old_head; old_head = new`. `finish_parse_monster` at
  `reference/src/mon-init.c:1756-1830` reverses the *record* list into the
  indexed `r_info` array, but does not reverse `drops`, `friends`,
  `friends_base`, `mimic_kinds`, `shapes`, or `spell_msgs` before consumers walk
  those linked lists. The corresponding TS reversals are therefore consistent
  with C list order; the measurement still says the simple changes need to be
  redone, not blindly retained.
- Drops are one C list: both `parse_monster_drop` and
  `parse_monster_drop_base` prepend to `r->drops` (`mon-init.c:1507-1559`). The
  pack's `drop-order` metadata preserves the cross-directive encounter stream,
  and the binder reverses that one stream once. Reversing the two arrays
  independently would be wrong.
- `reference/src/generate.c:450-461` leaves the room-template parser's linked
  list as-is, and `finish_parse_pit` at `reference/src/mon-init.c:2190-2220`
  explicitly copies the pit record list backwards into file order. The room
  and vault loader reversal is consequently a real file-order restoration, not
  an extra reversal of an already-restored list.
- For mimic selection, C's reservoir walk is
  `reference/src/mon-make.c:902-915`; the first linked-list element is selected
  by the `one_in_(1)` step. The shape/mimic reversal was tested as a unit and
  was neutral in the parity statistic.

## 3. RC1 RNG draw count

The C helper in `reference/src/mon-make.c:1483-1520` uses `while
(--attempts_left)` with `attempts_left = 10000`: exactly 9,999 location
iterations, each consuming two draws (`randint0(width)`, `randint0(height)`),
for at most 19,998 location-coordinate draws before returning false. The
isolated RC1 implementation now has that same count and rejects
`SQUARE_MON_RESTRICT` and `distance <= dis` in the same order. The old port
used a post-decrement inner loop (10,000 iterations), sampled interior-only
coordinates, and could restart with a relaxed distance threshold; it therefore
consumed 20,000 or more coordinate draws depending on retries. RC1 is a real
stream change even though its isolated statistical verdict is HURTS.

## 4. Pack exactness result

The requested command was run after applying the drop pack-format change:

```text
pnpm vitest run packages/content/src/data-exactness.test.ts --testTimeout=20000
No test files found, exiting with code 1
filter: packages/content/src/data-exactness.test.ts
```

There is no `packages/content/src/data-exactness.test.ts` in this checkout,
and no tracked `data-exactness` test was found. Therefore the result is
**not a pass**: exactness is unverified, and the pack format change must not be
treated as validated by this gate. The existing `drop-order` additions are
not evidence that the committed pack matches `reference/lib/gamedata`.

## 5. Recommendation

- **Keep conceptually, but gate separately:** drop/drop-base combined order.
  The C citation supports one interleaved head-inserted list
  (`mon-init.c:1507-1559`), and the isolated G result is neutral. Do not merge
  the pack-format portion until an independent exactness test exists and
  passes.
- **Keep:** mimic kinds / preferred shapes and alternate spell messages are
  neutral in this measurement, and their C linked-list consumers support the
  reversal (`mon-make.c:902-915`; `mon-init.c:1442-1502`).
- **Redo, do not merge as written:** RC1. Preserve the C draw count from
  `mon-make.c:1483-1520`, but trace the placement call boundary and downstream
  stream before retrying.
- **Redo, do not merge as written:** RC3. C increments `cur_num` at the
  successful placement boundary (`reference/src/mon-make.c:1041-1046`), but
  the port's shared-race lifetime and level-local unique guard need to be
  reconciled before applying that state mutation.
- **Redo, do not merge as written:** friends/friends-base. C walks the
  head-inserted lists at `reference/src/mon-make.c:1385-1421`; the isolated
  regression means a binder-only reversal is not yet a safe fix for the port's
  actual consumer/RNG boundary.
- **Redo, do not merge as written:** room templates/vaults. C's parser and
  finish behavior are distinct (`generate.c:450-461` and
  `mon-init.c:2190-2220`), but the isolated reversal worsens aggregate G and
  creates a large deep excursion.

## 6. Pit eligibility residual

The C and TS predicates were compared directly:

- `mon_select`: C `reference/src/gen-monster.c:70-108`; TS
  `packages/core/src/gen/gen-monster.ts:169-190`.
- named-pit `mon_restrict`: C `gen-monster.c:115-159`; TS
  `gen-monster.ts:273-331`.
- pit hook: C `reference/src/gen-room.c:901-943`; TS
  `gen-monster.ts:197-220`.
- universal depth/rarity/unique/FORCE_DEPTH gate: C
  `reference/src/mon-make.c:202-270`; TS
  `packages/core/src/mon/make.ts:156-210`.

The flag subset direction, forbidden flag/spell intersection, innate-frequency
comparison, forbidden-monster check, base match, color match, unique exclusion,
and random restriction's first-200 depth window all match. A direct diagnostic
against the bound pack found:

```text
ogre: ridx=181, native level=13, rarity=2, freqInnate=0
eligible named pit profiles: Ogres, Cave dwellers, Moria dwellers
eligible room-type-1 profile: Ogres
```

That is the expected C result: the ogre is not absent because the TS
`mon_pit_hook` rejects it. The depth-6 `ogre C=114, port=0` residual is thus a
profile-selection/population or surrounding generation-stream divergence:
the port's depth-6 telemetry selected no `Ogres` pit profile, while the C
sample's pit-only ogres require an ogre-admitting profile. This is a
presence/absence symptom, but the presence test is upstream of the weight
draw: do not change pit weights or pit data. The next investigation should
trace `set_pit_type`/room-attempt selection and the 16-entry pit population
stream, not alter `mon_pit_hook`.

No commit was made to `p3/s3-fix`.
