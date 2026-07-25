# S-3 — Root cause: monster species-mix divergence at depths 5–8

**Worktree:** `C:\Repositories\na-wt-fx` (`p3/s3`)  
**Date:** 2026-07-25  
**Mode:** diagnosis only — no port source modified; no commit.

Evidence baseline: two-sample G-test of homogeneity on 200 levels/depth
(`parity/phase3-2026-07-25/findings/W3-STATS-S2-S3.md`). Density and level
feelings pass; species mix fails from depth 5 down. Index alignment, mean race
level, and `get_mon_num` were already ruled out there and re-checked here.

## Method / experiments run

1. Side-by-side re-derivation of `set_pit_type`, `mon_pit_hook`, `mon_restrict`,
   `build_pit` / `build_nest`, `place_friends` / `place_new_monster`, and
   `pick_and_place_distant_monster` against `reference/src`.
2. Bound pack inspection: `pit.json` (40 profiles, file order), Warriors /
   Thieves / Ants / Jelly / Minor demons / Ogres accept lists via `monPitHook`.
3. `setPitType` Monte Carlo (5000 draws/depth/type): at depth 5–8, type-1
   (pits) ≈ Kobolds 31–33%, Spellcasters/Minor demons ~16% each, Warriors /
   Thieves ~7% each, Ogres ~2–3%; type-2 (nests) ≈ Ants 45–47%, Jelly ~28%,
   Creepy crawlies ~24%.
4. Reproduced C-vs-port histograms with `runStatsBatch` (base seed 1337, 200
   runs, depths 1–8) against `packages/cli/baseline/c-stats-baseline.json`.
5. Confirmed pit-only races at these depths: `warrior` (level 12) and `ogre`
   (level 13) cannot appear freestanding under `get_mon_num(depth)` with the
   usual OOD boost (`min(depth/4+2, ood-amount)` at depth 6 tops out at 9).
   Absolute counts of those races are therefore **pit-fill counts**.

No scratch files left behind.

---

## Root causes

### RC1 — `pick_and_place_distant_monster` is not the C algorithm (HIGH)

**C:** `reference/src/mon-make.c:1483-1520`  
**Port:** `packages/core/src/gen/util.ts:1811-1842`  
**Callers with `dis == 0`:** `classic_gen` / `modifiedStyleGen` etc.
(`packages/core/src/gen/cave.ts:1091-1092`, `:1192-1199`;
`reference/src/gen-cave.c:1304-1308`, `:2941-2948`).

Derivation:

| Step | C | Port |
|------|---|------|
| Distance gate | `distance(grid, to_avoid) > dis`. With the live call `dis == 0`, any non-player grid qualifies. | `minDist = Math.max(dis, maxSight + 1)` → with `dis == 0`, **requires distance > 21** (`maxSight` is 20). |
| Grid draw | `loc(randint0(c->width), randint0(c->height))` | `loc(randint0(width-2)+1, randint0(height-2)+1)` — different domain, never samples the outer ring. |
| `SQUARE_MON_RESTRICT` | Skips grids marked during generation (`square_ismon_restrict`, L1500-1501). Vaults / rooms of chambers mark this. | **Never checked.** Freestanding monsters can land inside mon-restricted rectangles. |
| Failure | After 10 000 tries, return false. | Halves `minDist` and retries (absent upstream). |

**Player-visible effect:** freestanding monsters are forced out of LOS-ish range, avoided near the player, may fail more often (wasted `mcount` slots still decrement), and may pollute mon-restricted themed rooms. That changes the **freestanding vs themed absolute mix** and the species histogram even when density stays inside the z-test.

**RNG draw order:** each placement attempt draws more `randint0` location samples on the port before `get_mon_num` (stricter acceptance). The distance-halving path adds whole extra 10 000-try loops. Any fix must restore the C distance gate (`> dis` only), the full-map coordinate draws, the mon-restrict skip, and delete the fallback loop so the draw count per freestanding attempt matches C.

**Severity:** HIGH — every dungeon level’s freestanding fill.

---

### RC2 — `friends` / `friends-base` / `drops` lists are file order; C walks reverse-file (prepend) order (HIGH)

**C:** `reference/src/mon-init.c:1534-1535` (drops prepend), `:1589-1590` (friends prepend), `:1626-1627` (friends-base prepend). Walk order is head-first = **last line first**.  
**Port:** `packages/core/src/mon/bind.ts:712-740` pushes pack arrays in **file order**.

Verified on `warrior`:

- pack / port: `Brigand → Priest → Illusionist → Same`
- C runtime: `Same → Illusionist → Priest → Brigand`

`place_new_monster` (`reference/src/mon-make.c:1386-1434`;
`packages/core/src/gen/util.ts:1750-1790`) walks the list in order, drawing
`randint0(100)` then `damroll` per entry. Same number of entries ⇒ same number
of chance rolls, but:

1. Chance rolls attach to **different friend races** (composition skew).
2. Spatial packing: placing a large `Same` group first (C, e.g. snaga `2d9`)
   fills neighbours before later friends; reverse order changes how many
   secondary escorts land. That is a **count bias**, not mere seed remapping.
3. Multi-drop races (e.g. kobold shaman magic/prayer books) reverse the
   specified-drop loop inside `mon_create_drop`, changing which object-creation
   RNG tails fire when only one of two chance gates succeeds — stream pollution
   for everything after that placement.

**Player-visible effect:** wrong escort mixes (warrior parties, snaga packs,
half-orc/warg groups, multi-friend uniques). Amplified species like
group-capable ants (`giant white ant` `friends:100:4d4:same`) swing hard when
primary pick rates or packing differ.

**RNG draw order:** fix by reversing each race’s `friends`, `friendsBase`, and
`drops` arrays at bind (or iterating reverse) so walk order matches C prepend
lists. That **changes** which friend/drop each draw applies to; total chance /
damroll **count** per race stays the same. Do not reverse at call sites that
already assume file order.

**Severity:** HIGH for group composition; contributes to S-3 histogram tails.

---

### RC3 — generation placement does not advance `race.cur_num` (HIGH)

**C:** `place_monster` increments `race->cur_num` (`reference/src/mon-make.c:1041-1042`).  
`get_mon_num` refuses uniques with `cur_num >= max_num` (L257-258).  
**Port:** `attachMonster` only records `placedUniques` (`packages/core/src/gen/util.ts:360-367`).  
`getMonNum` still keys off `race.curNum` (`packages/core/src/mon/make.ts:185`), which stays 0 during generation.  
`placeNewMonsterOne` rejects via `uniqueAlreadyPlaced` (L1543) **after**
`get_mon_num` has already spent its OOD / weighted / harder-monster draws.

**Derivation:** once a unique is on the level, C’s alloc table drops it.
Port’s table still offers it; placement then fails; callers such as
`pick_and_place_distant_monster` return false while classic/modified still
do `mcount--`. That wastes freestanding slots and desynchronises the stream
relative to C (failed path skips `mon_create_drop` / friends draws).

**Player-visible effect:** unique frequency and freestanding fill efficiency;
interacts with the stats harness’s `max_num` retirement (W3) but is a live
generation bug on its own.

**RNG draw order:** fixing by incrementing `curNum` on successful generation
place (and decrement on wipe, as C does) removes the extra failed
`get_mon_num`→reject cycles. That **reduces** draw count on levels that
re-rolled a placed unique. Matching C requires the cur_num bump, not only the
local `placedUniques` set (the set can remain as a belt-and-braces check).

**Severity:** HIGH for uniques and stream fidelity; medium direct contribution
to non-unique species mix.

---

### RC4 — Species lumps are themed-room shaped; pit/nest **code** re-derives faithful, but pit-only races still diverge (HIGH observation)

**C builders:** `reference/src/gen-room.c:2641-2962` (`build_nest` / `build_pit`),
`set_pit_type` L968-994, `mon_pit_hook` L901-954.  
**Port:** `packages/core/src/gen/room.ts:1242-1460`,
`packages/core/src/gen/gen-monster.ts:197-253`.

Re-derivation (cleared as *logic* mismatches):

- `set_pit_type`: same candidate loop, `Rand_normal(ave, 10)`, short-circuit
  `dist < best && one_in_(rarity)`, default index 0. Port pit list is file
  order (matches C’s finish_parse reverse-then-write). Extra empty C slot at
  `pit_max` is skipped when `type != 0`.
- `mon_pit_hook`: unique ban, `rf_is_subset(race, pit req)`, forbidden
  intersect, spell subset/intersect, innate-freq floor (`100/pct` stored),
  mon-ban, base membership, colour membership. FlagSet `isSubset` argument
  order matches `flag_is_subset(this, other)`.
- Nest 64 disordered picks; pit 16 picks, bubble-sort by level, even indices,
  concentric layout — match.
- Room profiles: `"monster pit"` / `"monster nest"` map via `list-rooms.h` to
  builders `pit` / `nest`; rarity 2; shared `level_pit_max` (2).

Measured absolute counts (200 levels, seed 1337), depth 6:

| race | C | port | note |
|------|---|------|------|
| warrior | 0 | 36 | pit-only at this depth |
| ogre | 0 | 40 | pit-only |
| ruffian | 2 | 37 | Warriors-pit colour set |
| giant white ant | 571 | 862 | Ants nest + freestanding groups |
| tengu | 156 | 50 | Minor demons pit member (depth 7–8 flips the other way) |

Lump classification on the port (200 levels, depth 6): large clumps map to
Ants / Orc / Warriors / Ogres / Creepy crawlies themes — the brief’s “blocks
of tens” signature.

**Player-visible effect:** whole rooms of the wrong theme (Warriors pits full of
umber persons vs Thieves pits full of blue persons; Ogre pits; ant nests vs
jelly nests). This is the bulk of the G-test failure.

**Why logic can match while outcomes differ:** freestanding fill (RC1/RC3) and
list-order (RC2) do not change `set_pit_type`’s *mathematical* distribution,
but they change absolute freestanding mass and group amplification. Pit-only
zeros on the C side for warrior/ogre still imply the C sample built essentially
no successful Warriors/Ogres pits at depth 6 while the port did. No second
logic bug was found inside `set_pit_type` / `mon_pit_hook` / empty-failure
handling after re-derivation. Remaining mechanism is therefore:

1. Fix RC1–RC3 first (they are definite C divergences on the live generation
   path), re-run the G-test; and/or
2. Instrument both sides for `(depth → pit/nest attempts → chosen profile name
   → empty failure)` — not done here (no C rebuild in this pass).

**Proposed fix order for RC4:** do not “tune” pit weights. After RC1–RC3,
if Warriors/Ogres still diverge, add a diagnostic that logs `set_pit_type`
choices and empty returns per depth and compare to a C `ROOM_LOG` / wiz-stats
pit dump. Only then consider a hidden filter bug.

**RNG:** any pit-theme fix must preserve one `Rand_normal` + conditional
`one_in_` per candidate in file order.

**Severity:** HIGH for the S-3 symptom; mechanism residual after RC1–RC3.

---

## Cleared (do not re-investigate without new evidence)

| Item | Why cleared |
|------|-------------|
| Race index / pack order | Shift-correlation peaks at 0 (W3); names align (`warrior` ridx 175, etc.). |
| Mean placed race level / general OOD | W3: depth 6 C 3.99 vs port 3.97; similar OOD tail. |
| `get_mon_num` formula | OOD chance/amount, town gate, seasonal, unique `cur_num` gate, FORCE_DEPTH, harder retries, `(100/rarity)*(1+level/10)` match (`mon/make.ts` vs `mon-make.c`). |
| Unique recurrence across depths in the **harness** | `kill_all_monsters` max_num zeroing already fixed; cleared depths 1–4. Residual unique *per-depth* shape still differs because C continuous descent ≠ port `deriveSeed` per cell (methodology, not `set_pit_type`). |
| `mon_pit_hook` FlagSet subset direction | `race.flags.isSubset(pit.flags)` ≡ `flag_is_subset(race, pit)`. |
| Pit colour / base filters for Warriors & Thieves | Warriors → soldier/ruffian/warrior; Thieves → cutpurse/rogue/brigand; colours `u,s,M` vs `b` resolve to the C attrs. |
| `random_room_template` / `random_vault` reverse list walk | Reservoir still uniform over candidates; changes seed→pick mapping only, not theme weights. Ledger already notes this. |
| Room-profile wiring names | `"monster pit"` → builder `pit`, etc. via `ROOM_ENTRIES`. |
| Pit data packing | 40 profiles; alloc rarity/level match `pit.txt`; `innate-freq` double-converted only in `resolvePits` from raw pct. |
| Nest/pit builder geometry & 16/64 pick structure | Line-faithful to `gen-room.c`. |

---

## Proposed fix plan (for a later repair task)

1. **RC1** — Rewrite `pickAndPlaceDistantMonster` to match `mon-make.c:1483-1520` exactly: full-map `randint0` coordinates, `distance > dis` only, skip `SQUARE_MON_RESTRICT` while `!character_dungeon` (generation), no maxSight floor, no minDist halving.  
   **RNG:** fewer failed location draws; no fallback loops.
2. **RC2** — Reverse `friends`, `friendsBase`, and `drops` at monster bind (mirror prepend). Unit-test `warrior` / `snaga` / `giant white ant` order against C head-first order.  
   **RNG:** same draw *counts* per race; different binding of draws to entries.
3. **RC3** — On successful generation `place_monster` equivalent, `race.curNum++` (and mirror decrements on wipe). Keep `placedUniques` optional.  
   **RNG:** eliminates failed unique re-picks’ get_mon_num draws.
4. **RC4** — Re-run `parity-c-stat.test.ts`. If still red, add pit-theme telemetry (profile name + empty) and compare to C; do not retune `pit.txt`.

---

## Severity summary

| ID | Severity | Player-visible |
|----|----------|----------------|
| RC1 | HIGH | Where/how many freestanding monsters appear; mon-restricted room pollution |
| RC2 | HIGH | Escort/group composition |
| RC3 | HIGH | Unique allocation / wasted freestanding slots |
| RC4 | HIGH (symptom) | Wrong themed rooms (Warriors/Ogres/ant lumps driving the G-test) |

S-3 should not be closed until the G-test over depths 5–8 is green after RC1–RC3 (and RC4 follow-up if needed). Density already passes; do not “fix” S-3 by widening tolerances.
