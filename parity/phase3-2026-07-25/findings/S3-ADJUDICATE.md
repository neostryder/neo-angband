# Adjudication — S-3 fix batch (commit `d6dcdbf46`), CODE evidence only

Independent adversarial review. The withdrawn `delta-G` / G-test / p-value
statistic is **not** used anywhere below. Each change is judged solely on
whether the post-fix port reproduces the C behaviour. Every C citation was
re-read against the source; where `S3-FIX.md` mis-cites, it is called out.

Method note on the RNG-stream point: this project's parity harness compares
*distributions*, and the port keeps its own stream by design (decision D1=B).
So a change that alters *which* candidate a fixed number of identical draws
lands on is a real parity question (it shifts the distribution), whereas a
change that only relabels two independent uniform draws of equal count is not.
This distinction is used explicitly below (see RC1 draw order).

---

## 1. RC1 — `pickAndPlaceDistantMonster`

**Verdict: CORRECT.**

### C authority
`reference/src/mon-make.c:1483-1520`:
- `int attempts_left = 10000;` then `while (--attempts_left)` (L1487, L1492).
  Pre-decrement ⇒ the body runs with `attempts_left` = 9999,9998,…,1, i.e.
  **9999** location attempts, then the loop exits at 0.
- `grid = loc(randint0(c->width), randint0(c->height));` (L1494) — **full map**,
  not interior; edges included.
- `if (!square_isempty(c, grid)) continue;` (L1497).
- `if ((!character_dungeon) && square_ismon_restrict(c, grid)) continue;`
  (L1500-1501).
- `if (distance(grid, to_avoid) > dis) break;` (L1504) — **strict `>`**.
- On exhaustion `if (!attempts_left) … return false;` (L1507-1512); on the break
  it falls through to `pick_and_place_monster(c, grid, depth, sleep, true,
  ORIGIN_DROP)` (L1515), i.e. group_ok = true, origin = ORIGIN_DROP.

### Port
`packages/core/src/gen/util.ts:1837-1849`:
```
let attemptsLeft = 10_000;
while (--attemptsLeft) {
  const grid = loc(g.rng.randint0(c.width), g.rng.randint0(c.height));
  if (!squareIsEmpty(g, grid)) continue;
  if (c.info(grid).has(SQUARE.MON_RESTRICT)) continue;
  if (distance(grid, pgrid) <= dis) continue;
  return pickAndPlaceMonster(g, grid, depth, sleep);
}
return false;
```
`pickAndPlaceMonster` (util.ts:1814-1826) defaults `groupOkay = true`,
`origin = ORIGIN.DROP` — matches the C `true, ORIGIN_DROP`.

### Divergence
None material. Point-by-point:
- **Count:** `while(--attemptsLeft)` from 10000 ⇒ 9999 attempts. Matches. The
  pre-fix code had a max-sight floor + halving-retry that is entirely absent
  from C; its removal is correct.
- **Range / order:** full-map `randint0(width)` then `randint0(height)`. The
  pre-fix `randint0(width-2)+1` interior range was a genuine divergence; the fix
  removes it. C's argument-evaluation order for `loc(randint0(w),randint0(h))`
  is *unspecified* by the C standard, but this is immaterial: the two draws are
  independent uniforms of equal count, so the (x,y) distribution and the total
  draw count are identical regardless of order. No distribution effect.
- **MON_RESTRICT guard:** C gates on `(!character_dungeon)`. This util.ts helper
  is **generation-only** — its callers are all in `gen/cave.ts` (lines
  1092,1199,1377,1609,1672,1817,1821,2054,2613,2634); the play-time spawn uses
  the separate `game/mon-place.ts:739`. During generation `character_dungeon`
  is always false, so C's `(!character_dungeon)` is always true and the port's
  unconditional check is equivalent. Confirmed the C callers match the port's
  usage (gen-cave.c 1308/1582/2216/2948/3186/3507/3643/3889/3898 with dis=0,
  2711 with dis=3).
- **Strict `>`:** port `distance(...) <= dis → continue`, else place ⇒ accepts
  `distance > dis`. Matches C's strict `>`. `distance` is symmetric, so
  `distance(grid,pgrid)` = `distance(grid,to_avoid)`.
- **break-then-place vs return / exhaustion:** equivalent; the dropped
  `cheat_xtra/cheat_hear` message has no RNG or state effect.

### Correction
None.

---

## 2. RC3 — generation `curNum`

**Verdict: CORRECT** (the `original_race` branch the fix omits is unreachable on
this path; see below).

### C authority
`reference/src/mon-make.c:1041-1042` inside `place_new_monster_one`:
```
if (new_mon->original_race) new_mon->original_race->cur_num++;
else new_mon->race->cur_num++;
```
This runs **after** attach/`monster_group_assign` (L1032-1033) and **before**
`mon_create_drop` (L1044-1046) / `mon_create_mimicked_object` (L1048-1051).
The unique gate is `get_mon_num` at `reference/src/mon-make.c:257-258`:
`if (rf_has(race->flags, RF_UNIQUE) && (race->cur_num >= race->max_num))
continue;` — the exclusion happens **inside** `get_mon_num`, i.e. the unique is
removed from the probability table *before* the weighted draw.
Decrement on death/wipe: L324-325 (`delete_monster`) and L599-601
(`wipe_mon_list`).

### Port
`packages/core/src/gen/util.ts:1576` — `race.curNum++;` placed after
`g.attachMonster(...)` (L1570) and before `createDrop(...)` (L1586). The
port's `get_mon_num` twin `packages/core/src/mon/make.ts:185` reads the same
gate: `if (race.flags.has(RF.UNIQUE) && race.curNum >= race.maxNum) continue;`.

### Why this is right (and what it fixes)
- **Boundary/ordering:** increment sits at exactly C's position (after attach,
  before drops). It consumes no RNG; its only effect is that the *next*
  `getMonNum` sees the updated count — matching C.
- **Within a level:** after placing a unique, `curNum=1 ≥ maxNum=1`, so
  `getMonNum` excludes it from the table before drawing — identical to C.
  Pre-fix, `curNum` stayed 0 and the unique was still selectable in `getMonNum`;
  placement was rejected afterward by `uniqueAlreadyPlaced` **after** the
  selection draws were already spent. That was the divergence; the fix removes
  it.
- **Across sub-chunks of one level (lair/moria/gauntlet/arena):** these
  generate separate `Gen`s that share the registry. Pre-fix, `placedUniques` is
  per-`Gen` (util.ts:304) and `curNum` stayed 0, so the *same* unique could be
  placed in two sub-chunks — a duplicate unique on one level, impossible in C.
  Sharing `curNum` now prevents that, matching C's shared `r_info` cur_num.
- **No double-increment:** `placedUniques` is a `Set` populated in
  `attachMonster` (util.ts:377-379), not a counter — it cannot double-count.
  The symmetry copy in `gen/cave.ts:948-951` calls `dest.attachMonster(...)`
  directly, never `placeNewMonsterOne`, so it does not increment. This matches
  C: `chunk_copy` (`reference/src/gen-chunk.c:414-429`) transfers monsters by
  `memcpy` with no `cur_num` change; the count was already taken when the
  monster was placed into the source sub-chunk via `place_new_monster_one`.
- **Harness reset:** `runStatsBatch` (`packages/cli/src/stats.ts:319`) rebinds
  the registry per *run* (curNum starts 0), and per level zeroes `maxNum` for
  placed uniques (L336-339), mirroring main-stats `kill_all_monsters`. For
  uniques the port's `curNum=1 ≥ maxNum=0` and C's post-delete `curNum=0 ≥
  maxNum=0` both evaluate true ⇒ same "retired for the descent" outcome. For
  non-uniques `curNum` is never read by the gate, so its accumulation is inert.
  No cross-level pollution results.

### The `original_race` omission
The fix writes `race.curNum++` unconditionally, dropping C's `if
(new_mon->original_race)` branch. On the **generation** path this branch is
dead: `placeNewMonsterOne` builds a fresh monster via `createMonster`
(util.ts:1564) which never sets `originalRace` — shapechange only happens in
play (`game/mon-shape.ts`), which uses `game/mon-place.ts:218,984`
(`(mon.originalRace ?? mon.race).curNum++`) and *does* honour it. So the
unconditional increment correctly corresponds to C's taken `else` branch here.
Not a defect for this path.

### Correction
None required. (Optional hardening: mirror the play path's
`(mon.originalRace ?? race).curNum++` for symmetry, but it changes no behaviour
because `originalRace` is always null at generation.)

---

## 3. friends  &  4. friends-base — bind-time reversal

**Verdict: CORRECT (both).**

### C authority
Both are head-inserted:
- `parse_monster_friends` `reference/src/mon-init.c:1589-1590`:
  `f->next = r->friends; r->friends = f;`
- `parse_monster_friends_base` `reference/src/mon-init.c:1626-1627`:
  `f->next = r->friends_base; r->friends_base = f;`

`finish_parse_monster` (`reference/src/mon-init.c:1756-1826`) reverses **only
the top-level race-record list** into `r_info` (ridx `r_max-1 … 0`, L1782-1795)
and rebuilds `blow` into an array; it `memcpy`s the record (L1789) so the
`friends`/`friends_base` head pointers are copied unchanged. It does **not**
reverse these sub-lists. Therefore at consume time they are in **reverse file
order**.

Consumer `place_new_monster` (`reference/src/mon-make.c:1385-1400` friends,
`:1402-1434` friends_base) walks each list head→tail, drawing per entry:
`randint0(100)` vs `percent_chance` (L1387, L1408), then
`damroll(number_dice, number_side)` (L1391, L1411); friends_base additionally
runs `get_mon_num` over the escort base table (L1416-1420). Order therefore
decides which entry receives which `randint0(100)` — order **is** observable.

### Port
`packages/core/src/mon/bind.ts:734` (`friends`) and `:746` (`friends-base`)
now iterate `[...(rec.friends ?? [])].reverse()` / `[...(rec["friends-base"] ??
[])].reverse()`. The pack stores directives in file order (compiler appends in
parse order), so reversing yields reverse-file = C order. Consumer
`packages/core/src/gen/util.ts:1769-1782` (friends) and `:1785-1808`
(friends_base) walks the stored order with the same
`randint0(100)`→`damroll`(→`getMonNum`) sequence as C.

### Divergence
Pre-fix the port walked **file order** while C walks **reverse-file**; for any
monster with ≥2 friends of differing chance/number this mispaired the draws.
Observability confirmed in the shipped pack: 85 monsters have ≥2 `friends`, 14
have ≥2 `friends-base` (e.g. `kobold shaman`:
`friends-base:30:1d2:kobold` then `70:...`, differing chance). Fix aligns them.

### Correction
None.

---

## 5. drop / drop-base — one combined list

**Verdict: CORRECT** (pack still faithful to `monster.txt`; a latent fallback
caveat is noted but does not affect the shipped pack).

### C authority
Both directives prepend to the **same** `r->drops` list:
- `parse_monster_drop` `reference/src/mon-init.c:1534-1535`:
  `d->next = r->drops; r->drops = d;`
- `parse_monster_drop_base` `reference/src/mon-init.c:1558-1559`: identical.

So `r->drops` is one interleaved stream in reverse file order (not reversed by
`finish_parse_monster`, same argument as §3). It is walked **twice**, both in
list order:
- `mon_create_drop_count` (non-maximize) `reference/src/mon-make.c:728-734`:
  `randint0(100)` vs `percent_chance`, then `randint0(max-min)+min`.
- `mon_create_drop` `reference/src/mon-make.c:830-845`: `randint0(100)` vs
  `percent_chance`, then object creation.
Order affects both walks ⇒ observable.

### Port
- Compiler (`packages/content/src/records.ts:27-28,150,237-247`) records a
  per-node `drop-order` array of `directive:occurrence` tokens in **file
  order** across both directives, driven by the `orderKey:"drop-order"` on the
  two specs in `packages/content/src/specs/mon-init.ts:129-140`. The underlying
  `drop`/`drop-base` value arrays are unchanged.
- Binder `packages/core/src/mon/bind.ts:502-537`: with metadata it reverses the
  single token stream once (`[...order].reverse()`, L516) and dereferences each
  token into the correct source array — producing reverse-file of the combined
  stream, matching C. `packages/core/src/mon/bind.ts:732` calls it once:
  `bindDrops(drops, rec.drop, rec["drop-base"], rec["drop-order"])`.

### Pack exactness (independently checked — no `data-exactness` test exists)
The `monster.json` diff **only adds** `drop-order` arrays; no `drop`/`drop-base`
entry is altered (verified from `git show d6dcdbf46 -- …/monster.json`). I
loaded the compiled pack and confirmed: 43 monsters carry `drop-order`; **no**
monster interleaves `drop` with `drop-base` in one list (so the "interleaved
stream" is well-defined and degenerate to one kind per monster in practice); 34
have ≥2 entries. Spot-check `kobold shaman` against
`reference/lib/gamedata/monster.txt`: file order `drop-base:magic book`,
`drop-base:prayer book` → pack `drop-order = ["drop-base:0","drop-base:1"]`;
binder reverse → `[prayer book, magic book]` = C's prepend result `[B,A]`. The
two entries differ in tval, so the pre-fix `[magic, prayer]` was a real
divergence that the fix corrects.

### Divergence / caveat
Pre-fix bound `drop` (file order) then `drop-base` (file order), i.e. neither
combined nor reversed — divergent whenever a monster has ≥2 drops. Fixed.
Latent (not triggered by the shipped pack): the metadata-less fallback
`bind.ts:534` does `[...dropLines, ...baseDropLines].reverse()`, which is only
correct if `drop` always precedes `drop-base` in file order; a custom pack with
the opposite file order would be mis-ordered. The shipped pack always uses the
metadata path, so this does not affect current parity.

### Correction
None for the shipped pack. If metadata-less packs must be supported exactly,
the fallback needs the real interleave order, not a `drop`-before-`drop-base`
assumption.

---

## 6. room templates / vaults — load-time reversal

**Verdict: CORRECT.**

### C authority
Head-inserted:
- room template `reference/src/generate.c:323`: `t->next = h;` (h = old head).
- vault `reference/src/generate.c:484`: `v->next = h;`.

`finish_parse_room` (`reference/src/generate.c:450-453`) and
`finish_parse_vault` (`:614-617`) merely set the head pointer
(`room_templates`/`vaults`) and destroy the parser — **no** reversal into an
array. So both reach the consumer as linked lists in **reverse file order**.
(Contrast the pit finisher the brief flags, `mon-init.c` finish_parse_pit,
which *does* copy backward into file order — that governs the `pits` list used
by `setPitType`, a different loader. The fix correctly leaves pit ordering
untouched: the `room.ts` diff changes only `loadRoomTemplates`/`loadVaults`.)

Consumers walk the list head→tail with a reservoir `one_in_(n)`:
- `random_room_template` `reference/src/gen-room.c:55-68`.
- `random_vault` `reference/src/gen-room.c:76-90`.
The reservoir is uniform, but for a fixed RNG sequence the **selected** element
depends on the list order of eligible candidates, so duplicate (typ,rating) /
(typ,depth-range) records make order observable.

### Port
`packages/core/src/gen/room.ts:128` `loadRoomTemplates` and `:149` `loadVaults`
now `[...records].reverse().map(...)`. Records arrive in file order, so the
loaded arrays are reverse-file = C order. Consumers
`packages/core/src/gen/room.ts:169-184` (`randomRoomTemplate`) and `:187-197`
(`randomVault`) walk the array in order with the same `oneIn(n)` reservoir.

### Divergence
Pre-fix walked file order; C walks reverse-file. Observable via duplicate
records — `S3-FIX.md` itself reports two generation assertions now select the
*other* duplicate `Round` vault and change one deep layout, which is exactly the
expected consequence of correcting the order. Fix matches C.

### Correction
None.

---

## 7. mimic kinds / preferred shapes — bind-time reversal

**Verdict: CORRECT.**

### C authority
Head-inserted:
- mimic `reference/src/mon-init.c:1652-1653`: `m->next = r->mimic_kinds;
  r->mimic_kinds = m;`
- shape `reference/src/mon-init.c:1666-1668`: `s->next = r->shapes;
  r->shapes = s; r->num_shapes++;`
Not reversed by `finish_parse_monster` (same argument as §3) ⇒ reverse file
order at consume time.

Consumers:
- mimic reservoir `reference/src/mon-make.c:902-914`: seed `kind =
  mimic_kinds->kind`, then `for (…, i=1; …; i++) if (one_in_(i)) kind = …`.
  `one_in_(1)` at i=1 is always true, so element 1 always overwrites the seed;
  the draw **count** = number of mimic kinds regardless of order, but the
  **selected** kind depends on order once there are ≥2 kinds.
- shape `reference/src/mon-util.c:1590-1601`: `choice = randint0(num_shapes)`
  then walk `choice` `->next` steps — indexes into the reverse-file list, so
  order maps index→shape and is observable for ≥2 shapes.

### Port
- mimic `packages/core/src/mon/bind.ts:765` `[...(rec.mimic ?? [])].reverse()`;
  consumer `packages/core/src/game/mon-place.ts:283-290` replicates the
  reservoir (`kind = kinds[0]`; `for (mk of kinds) if (oneIn(i)) kind = …; i++`)
  over the stored order.
- shape `packages/core/src/mon/bind.ts:766` `[...(rec.shape ?? [])].reverse()`;
  consumer `packages/core/src/game/mon-shape.ts:73-75`
  `shapes[randint0(shapes.length)]` indexes the stored order.
With the reversal, stored order = reverse-file = C order in both.

### Divergence
Pre-fix stored file order; C consumes reverse-file. Observable: 4 monsters have
≥2 mimic kinds (potion/scroll/ring/chest mimic, 6 each) and 8 have ≥2 shapes.
Fix aligns both. (Shapes are a play-time path, not generation, so this does not
touch the generation species histogram — but it is still correct C parity.)

### Correction
None.

---

## 8. alternate spell messages — bind-time reversal

**Verdict: CORRECT** (direction matches C; a no-op on the shipped data).

### C authority
`add_alternate_spell_message` `reference/src/mon-init.c:1447-1448`:
`alt->next = r->spell_msgs; r->spell_msgs = alt;` — **one** list shared by
`message-vis`/`-invis`/`-miss` (all three parsers call it: L1470, L1486,
L1502), interleaved in reverse file order. Not reversed by
`finish_parse_monster`.

Consumer `find_alternate_spell_message` `reference/src/mon-spell.c:72-86`: walks
`r->spell_msgs` and returns the **first** entry matching *both* `s_idx` **and**
`msg_type`. Because the match filters on both index and type, the interleaving
of the three types is irrelevant; only the order **within** a (spell,type) group
matters, and first-match over reverse-file means the **last-parsed** override
for a given (spell,type) wins.

### Port
`packages/core/src/mon/bind.ts:489` binds each type array via `for (const line
of [...lines].reverse())`, appending to one `spellMsgs` list. Consumer
`packages/core/src/game/mon-message.ts:190-193` returns the first entry matching
`index` and `msgType`. Reversing each type array makes the first same-(spell,
type) match the last-parsed one — matching C. Binding the three types as
separate reversed runs is equivalent to C's single interleaved reverse list
because the lookup filters by type.

### Divergence / observability
Pre-fix iterated file order, so first-match returned the **first-parsed**
override — opposite of C — *whenever a monster had ≥2 overrides for the same
(spell,type)*. In the shipped pack **no** monster has a duplicate spell within
`message-vis` (checked: 0), and different spells never collide in the lookup, so
the reversal changes no observed message with current data. The fix is therefore
a correct-direction no-op today; it becomes load-bearing only if such a
duplicate is ever added.

### Correction
None.

---

## Summary

| # | Change | Verdict |
|---|--------|---------|
| 1 | RC1 `pickAndPlaceDistantMonster` | CORRECT |
| 2 | RC3 generation `curNum` | CORRECT (omitted `original_race` branch is unreachable on the gen path) |
| 3 | friends reversal | CORRECT |
| 4 | friends-base reversal | CORRECT |
| 5 | drop/drop-base combined list | CORRECT (pack still faithful; metadata-less fallback has a latent order assumption) |
| 6 | room templates / vaults reversal | CORRECT |
| 7 | mimic kinds / preferred shapes reversal | CORRECT |
| 8 | alternate spell messages reversal | CORRECT (matches C's first-match rule; no-op on shipped data) |

All eight changes move the port toward C parity and none introduces a
divergence; the pre-fix code diverged in every case where order/count was
observable. The commit message's "measurement got worse" refers to the withdrawn
`delta-G` statistic, which — per the brief — is void and carries no weight
against these code-level verdicts. The residual pit/nest species mismatch that
`S3-FIX.md` documents is a *separate*, still-open divergence
(`gen/util.ts:1533-1537` notes pit/nest `mon_restrict` theming is simplified);
it is not caused by, nor fixed by, this batch, and is out of scope for these
eight items.

### Notes on `S3-FIX.md` citations
- §1 cites port "util.ts:1830-1850"; the rewritten loop is at util.ts:1837-1849
  — accurate enough.
- §2 cites `mon-make.c:1041-1046` and `257-258` — both verified correct.
- §3 friends `mon-init.c:1563-1630`, drops `1507-1559`, room
  `generate.c:323/:484`, mimic/shape `1632-1674`, alt-msg `1447` +
  `mon-spell.c:72-90` — all verified correct.
- The one substantive gap in `S3-FIX.md` is that it asserts the C sub-lists are
  reverse-order without citing the finishers that *fail to* reverse them
  (`generate.c:450-453`, `:614-617`; `mon-init.c:1789` memcpy). Those citations
  are supplied above and confirm the claim.
