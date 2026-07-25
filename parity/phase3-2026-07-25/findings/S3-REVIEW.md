# S-3 review — root-cause verification and prepend-order audit

Reviewed against the read-only `reference/` tree and the live generation and
runtime paths in `packages/core/src`. No port source file was changed.

## 1. Verdicts

| RC | Verdict | What I re-derived | Correction |
|---|---|---|---|
| RC1 | **CONFIRMED** | `reference/src/mon-make.c:1483-1520` draws a full-map `(randint0(width), randint0(height))`, rejects occupied grids, applies `SQUARE_MON_RESTRICT` while `!character_dungeon`, accepts `distance > dis`, and returns after the bounded retry loop. `packages/core/src/gen/util.ts:1811-1842` instead imposes `maxSight + 1`, draws only interior coordinates, omits the restrict test, and halves the distance threshold after retry exhaustion. The generation callers in `gen/cave.ts:1092,1199,1377,1609,1672,1817,1821,2054` reach this helper; most pass `dis == 0`. | The C loop is `while (--attempts_left)`, so it makes 9,999 loop iterations from an initial value of 10,000, not 10,000. This is a small but real exact-stream detail. The separate live helper in `packages/core/src/game/mon-place.ts:739-765` already uses the C distance/full-map/bounded-loop shape; do not “fix” it with the generation helper’s old rules. |
| RC2 | **PARTLY-CONFIRMED** | C head-inserts `drop` and `drop-base` into the same `r->drops` list (`mon-init.c:1534-1559`) and head-inserts `friends` and `friends-base` (`:1589-1630`). The port pushes JSON arrays in file order (`mon/bind.ts:703-740`). The generation helper (`gen/util.ts:1750-1789`) and runtime helper (`game/mon-place.ts:583-620`) both iterate those arrays, so this is live. The C chance/damroll gates consequently attach to different friend entries, and drop order affects which object tails run. | Reversing `friends` and `friends-base` independently is sufficient for their separate C lists. Reversing `drop` and `drop-base` independently is not generally sufficient: C has one interleaved list, while the port concatenates two arrays (`bind.ts:709-710`). A complete repair must preserve one combined source order and reverse that combined stream, or prove the pack format forbids interleaving. |
| RC3 | **CONFIRMED** | C increments the racial count only after successful placement (`mon-make.c:1041-1042`) and `get_mon_num` excludes a unique at/above `max_num` (`:257-258`). Generation `Gen.attachMonster` (`gen/util.ts:360-367`) only updates `placedUniques`; `placeNewMonsterOne` rejects after `getMonNum` (`:1543-1558`). Thus failed unique selections consume generation-side selection draws that C would avoid. | The proposed fix must update the generation race count at the successful-placement boundary, not merely retain the set. It must cover `gen/util.ts:1558` and any generation placement that bypasses that function; copying monsters during cave symmetry (`gen/cave.ts:950`) must not count the same monster again. Runtime placement already increments `(originalRace ?? race).curNum` in `game/mon-place.ts:218`. |
| RC4 | **CONFIRMED AS A LOGIC RE-DERIVATION; RESIDUAL SYMPTOM UNRESOLVED** | The cited C pit/nest code (`gen-room.c:901-994,2641-2962`) and port (`gen/gen-monster.ts:197-253`, `gen/room.ts:1242-1460`) agree on pit-hook filters, `Rand_normal`/conditional rarity selection, and nest/pit placement geometry. The C pit lists are membership tests, not ordered weighted choices. | “Pit code is faithful” does not establish that the post-RC1–RC3 species counts will be faithful. The proposed telemetry—pit attempts, selected profile, empty failures, by depth—is the correct next test. Preserve one normal draw and only the conditional `one_in_` draw per eligible profile; do not tune weights from the current histogram. |

## 2. Proposed-fix judgement and RNG consequences

### RC1

The generation helper should be brought to `mon-make.c:1483-1520` exactly: use
the full map coordinate domain, `distance > dis`, the generation-time
`SQUARE_MON_RESTRICT` check, and one bounded retry loop. Remove the max-sight
floor and threshold-halving fallback. Each failed location attempt consumes the
same two coordinate draws as C; on exhaustion, the helper returns without a
`get_mon_num` draw, also matching C. The caller-side `mcount--` behavior can
remain because it is present around the C call sites too.

The fix belongs in `gen/util.ts`, not only in `game/mon-place.ts`. The latter is
a separate live-game path and is already materially faithful; changing it would
create a new runtime divergence.

### RC2

Reverse the bound representation, or iterate it in reverse, before both
generation and runtime consumers see it. This changes which entry receives each
chance roll but does not change the number of friend chance/damroll draws for a
fixed successful group walk. It does change spatial packing because earlier
groups occupy grids before later groups are attempted.

For drops, repair the data boundary first. C’s `parse_monster_drop` and
`parse_monster_drop_base` append both kinds to `r->drops`; `mon_create_drop`
walks that single reverse-file list. A binder that only does
`reverse(drop)` followed by `reverse(drop-base)` cannot reproduce an interleaved
source. After the combined order is corrected, the number of chance gates is
unchanged, but the selected object may differ and its object-generation RNG
tail may or may not run, so the downstream stream can change.

The call-site coverage in the diagnosis is otherwise complete: friend iteration
exists in `gen/util.ts:1750-1789` and `game/mon-place.ts:583-620`; drop creation
exists on the generation placement path and in runtime monster-death handling.

### RC3

Increment the same race counter at the successful generation placement point
where the C increments `cur_num`. That removes the post-selection unique
rejection cycles and their weighted/OOD draws. It should be paired with the
generation-level cleanup/decrement policy used when generated monsters are
removed or a generated level is discarded; otherwise a reused registry can
retain counts. Keep the set only as a defensive check, not as a substitute for
the counter that `getMonNum` reads.

### RC4

No code correction to pit selection is justified by the current evidence. Once
RC1–RC3 are repaired, compare C and port at the same depth for pit/nest attempt
count, profile name, hook candidate count, and empty-placement result. That will
separate a remaining data/order issue from a genuine pit-selection mismatch
without perturbing RNG while diagnosing it.

## 3. Prepend-order audit

“C order” below means the order consumed by the relevant finished C structure,
not merely the temporary parser list. `ISSUE` means the port’s stored order is
different and the difference can affect behavior; `OK` includes cases where C
temporarily prepends but its finish step restores file/index order or where the
field is a set/bitset. `NON-S3` identifies a real general parity risk outside the
measured monster-generation path.

| C list field | C parser file:line | Prepends? | Port storage file:line | Port order | Order-sensitive behavior? | Verdict |
|---|---:|:---:|---|---|---|---|
| dungeon profiles | `generate.c:106` | yes | `gen/cave.ts:187-209,2797-2803` | file order | C finish copies the prepended records back to file order before weighted profile selection | **OK** |
| profile room entries | `generate.c:150-180` | no, appends | `gen/cave.ts:189-205` | file order | Iterated in file order | **OK** |
| room templates | `generate.c:323` | yes | `gen/room.ts:127-140` | file order | Reservoir selection maps a fixed RNG stream to a different candidate, although the distribution and draw count remain uniform/equal | **ISSUE, NON-S3**; this is the “seed-to-pick” difference the diagnosis called cleared, not a weight difference |
| vaults | `generate.c:484` | yes | `gen/room.ts:148-160` | file order | Same reservoir-order mapping issue as templates | **ISSUE, NON-S3** |
| monster blow methods | `mon-init.c:107` | yes | `mon/bind.ts:348-365,543-544` | name map | Lookup is by method name; no order-dependent consumer found | **OK** |
| monster blow effects | `mon-init.c:294` | yes | `mon/bind.ts:367-386,543-544` | name map | Lookup is by effect name | **OK** |
| monster pain records | `mon-init.c:495` | yes | `mon/bind.ts:337-346,546` | index map | Parsed entries carry explicit pain index; order is not the lookup key | **OK** |
| monster spell records | `mon-init.c:594` | yes | `mon/bind.ts:405-438,545` | name/index map | RSF names/indexes select the record; no list walk | **OK** |
| monster spell levels | `mon-init.c:765` | no, appends | `mon/bind.ts:428-438` | file order | Level cutoffs/effects are consumed in increasing source order | **OK** |
| monster bases | `mon-init.c:1003` | yes | `mon/bind.ts:444-462,546` | name map | Exact base lookup; no order-sensitive selection found | **OK** |
| monster races | `mon-init.c:1122` | yes | `mon/bind.ts:551-560` | file order | C finish reverses the parser list into race indexes/file order; port matches that order | **OK** |
| monster blows | `mon-init.c:1288` | no, appends | `mon/bind.ts:760-783` | file order | Melee iterates the blow array in source order | **OK** |
| alternate spell messages | `mon-init.c:1447` | yes | `mon/bind.ts:481-499,703-706`; consumer `game/mon-message.ts:185-193` | file order, grouped by message type | C `find_alternate_spell_message` returns the first matching list entry; port also returns first, so duplicate same-spell/type overrides differ | **ISSUE, NON-S3** |
| monster drops (`drop` + `drop-base`) | `mon-init.c:1534-1559` | yes, one combined list | `mon/bind.ts:501-518,708-710` | two file-order arrays concatenated | `mon_create_drop`/port death and generation code gate and create entries in iteration order; cross-kind interleaving is lost | **ISSUE — RC2 fix incomplete unless combined order is preserved** |
| monster friends | `mon-init.c:1589` | yes | `mon/bind.ts:718-729`; `gen/util.ts:1750-1762`; `game/mon-place.ts:583-603` | file order | Chance/damroll attaches to a different race and group packing changes | **ISSUE — RC2** |
| monster friends-base | `mon-init.c:1626` | yes | `mon/bind.ts:731-740`; `gen/util.ts:1767-1789`; `game/mon-place.ts:609-620` | file order | Same as friends, with base allocation and group packing | **ISSUE — RC2** |
| monster mimic kinds | `mon-init.c:1652` | yes | `mon/bind.ts:743-746`; `game/mon-place.ts:269-297` | file order | C and port reservoir-sample the list; candidate order changes the chosen object for a fixed stream | **ISSUE, NON-S3** |
| monster preferred shapes | `mon-init.c:1666` | yes | `mon/bind.ts:749-756`; `game/mon-shape.ts:70-87` | file order | Both use `randint0(num_shapes)` then index/walk; candidate order changes the selected race/base | **ISSUE, NON-S3** |
| pit profile records | `mon-init.c:1970` | yes | `mon/bind.ts:581-601` | file order | C finish restores pit array/file order; `setPitType` candidate loop matches | **OK** |
| pit required/banned race flags | `mon-init.c:2063-2104` | not a list; bitsets | `mon/bind.ts:591-600`; resolution in `gen/gen-monster.ts` | raw arrays resolved to bitsets | Token order cannot affect subset/intersection tests | **OK** |
| pit required/banned spell flags | `mon-init.c:2110-2156` | not a list; bitsets | `mon/bind.ts:591-600`; `gen/gen-monster.ts` | raw arrays resolved to bitsets | Token order cannot affect subset/intersection tests | **OK** |
| pit base membership | `mon-init.c:2020` | yes | `mon/bind.ts:590` | file order | C hook only tests membership; no RNG or first-match | **OK** |
| pit forbidden monsters | `mon-init.c:2035` | yes | `mon/bind.ts:596` | file order | C hook only tests whether any race matches | **OK** |
| pit colors | `mon-init.c:2058` | yes | `mon/bind.ts:591` | file order | C hook only tests membership | **OK** |
| lore drops/friends/friends-base/mimics | `mon-init.c:2423-2535` | yes | no corresponding live generation array; lore is deferred/lazy in `mon/lore.ts` | not represented as generation data | These parser lists affect C lore records, not the S-3 generation path; a future lore-data importer would need the same reverse-order rule | **DEFERRED / NON-S3** |
| projections | `obj-init.c:221` | yes | `world/projection.ts:86-135` | indexed by projection code | C finish writes the indexed array in semantic code order; port also indexes by code | **OK** |
| object-base kind records | `obj-init.c:521` | yes | `obj/bind.ts:491-520` | tval-indexed | Lookup is by tval; no list walk | **OK** |
| object slays | `obj-init.c:685` | yes | `obj/bind.ts:530-557` | explicitly reversed to C’s reverse-file 1-based indexes | IDs are referenced by code and the port preserves C indexes | **OK** |
| object brands | `obj-init.c:878` | yes | `obj/bind.ts:560-588` | explicitly reversed | IDs are referenced by code | **OK** |
| object curses | `obj-init.c:1053` | yes | `obj/bind.ts:590-710` | explicitly reversed | IDs/powers are referenced by curse index; port preserves C indexes | **OK** |
| object activations | `obj-init.c:1452` | yes | `obj/bind.ts:777-788` | explicitly reversed | Lookup is by activation name/index | **OK** |
| object kinds | `obj-init.c:1715` | yes | `obj/bind.ts:862-900` | file order | C finish restores kidx/file order; port uses file order | **OK** |
| ego possible type/item lists | `obj-init.c:2322,2350` | yes | `obj/bind.ts:825-850` | `Set<kidx>` membership | C scans for a matching kind with no RNG; set membership is order-independent | **OK** |
| ego records | `obj-init.c:2261` | yes | `obj/bind.ts:790-873` | file order | C finish restores eidx/file order; port matches | **OK** |
| artifact records | `obj-init.c:2707` | yes | `obj/bind.ts:945-1035` | file order | C finish restores aidx/file order; nested slay/brand/curse fields are indexed bitsets | **OK** |
| artifact slay/brand/curse fields | `obj-init.c:2990-3050` (named-field parsers) | no linked-list behavior; indexed fields | `obj/bind.ts:1028-1030` | boolean/power arrays by ID | Token/directive order cannot change the resulting indexed fields | **OK** |
| object properties | `obj-init.c:3195` | yes | `obj/bind.ts:1053-1129` | file order | C finish reverses to 1-based file order; port matches | **OK** |
| player names by section | `init.c:1477` | yes | `session/boot.ts:161-164` | explicitly reversed | Random-name index selection matches C’s reverse linked list | **OK** |
| traps | `init.c:1551` | yes | `world/trap.ts:113-135` | file order | C finish restores trap indexes/file order | **OK** |
| player body records | `init.c:2344` | yes | `player/bind.ts:612-619` | file order | Lookup is by body name; slot entries retain their source order | **OK** |
| history charts | `init.c:2486` | yes | `player/bind.ts:579-603` | keyed by chart index | C finds charts by explicit index; entries are explicitly reversed back to source order in `finish_parse_history` | **OK** |
| history entries | `init.c:2494` | yes | `player/bind.ts:581-595` | file order | C explicitly reverses them before successor resolution and iteration | **OK** |
| magic realms | `init.c:2908` | yes | `player/bind.ts:516-522,565-579` | name map | Class books resolve a realm by name; list order is not used | **OK** |
| player shape records | `init.c:3017` | yes | `player/bind.ts:407-527` | file order with `sidx` assigned by file order | C assigns `sidx` while parsing and lookup is by name/index; port matches semantic indexes | **OK** |
| player shape blows | `init.c:3316` | yes | `player/bind.ts:407-467` | file order | C leaves the prepended linked list intact and shape combat walks it; port’s forward `blows` array reverses the verb order | **ISSUE, NON-S3** |
| class records | `init.c:3404` | yes | `player/bind.ts:531-557,869-904` | file order | C finish assigns cidx back to file order; port matches | **OK** |
| class magic books | `init.c:3726` | no, indexed append | `player/bind.ts:815-865` | file order | Book index and realm association are source order | **OK** |
| class spells | `init.c:3759,3834` | no, indexed append | `player/bind.ts:828-858` | file order | Class-wide sidx and book spell order are source order | **OK** |
| class flags/player-flags | `init.c:3665-3695` | not a list; bitsets | `player/bind.ts:869-904` | bitsets | Token order cannot affect flags | **OK** |
| class starting items | `init.c:3659` | yes | `player/bind.ts:881-887`; consumed `game/gear.ts:1049-1063` | file order | C walks the prepended list, so each `rand_range`/option gate is attached to a different starting item; visible kit and RNG association differ | **ISSUE, NON-S3** |
| player properties / bound UI records | `init.c:1330` | yes for repeated `boundui` records | `player/bind.ts:193-200,626-633` | collapsed to a boolean `bindui` | C can retain repeated bound-UI records/values; port collapses them, so this is data loss rather than only order | **ISSUE, NON-S3** |
| object flavors | `init.c:4246` | yes | `obj/bind.ts:1143-1166`; `obj/flavor.ts:124-187` | file order | C `flavor_init` counts/chooses along the reversed linked list; port’s random flavor assignment walks forward, changing flavor-to-kind mapping for a fixed seed | **ISSUE, NON-S3** |
| shop hints | `init.c:4341` | yes | `session/boot.ts:170-175` | file order | `ui-store.c:120-130` reservoir-walks the linked list; the port’s corresponding order changes the selected hint for a fixed stream | **ISSUE, NON-S3** |
| store normal table | `store.c:162-183` | no, appends | `store/bind.ts:94` | file order | Random normal-stock index and staple membership use the same order | **OK** |
| store always table | `store.c:185-231` | no, appends | `store/bind.ts:83-94` | file order | Always-stock iteration and refill order match | **OK** |
| store turnover | `store.c:156` | scalar | `store/bind.ts:100-104` | scalar | No list order | **OK** |
| store owners | `store.c:247` | yes, but assigns `oidx` in file order | `store/bind.ts:72-104`; `store/store.ts:92-96` | file order | C randomizes an index and resolves by preserved `oidx`; port indexes the same file-order array | **OK** |
| store buy rules | `store.c:263,284` | yes | `store/bind.ts:95-104`; `store/store.ts:252-257` | file order | First matching overlapping tval/flag rule can differ; ordinary non-overlapping tables are equivalent | **ISSUE, NON-S3 / latent** |

The requested `reference/src/p-init.c` does not exist in this checkout. Player
initialization is in `reference/src/init.c`; the audit includes those lists and
also checked the other relevant initializer files (`generate.c`, `obj-init.c`,
`mon-init.c`, `ui-init.c`).

## 4. Pit/nest follow-up

I agree with the diagnosis that the pit/nest algorithms themselves re-derive as
faithful. In C, `set_pit_type` scans the finished pit array, draws
`Rand_normal(ave, 10)` for each eligible profile, and only draws `one_in_(rarity)`
when the candidate is closer than the current best. The port has the same
short-circuit order and file-order pit array. `mon_pit_hook` is pure filtering:
unique exclusion, required/forbidden race flags, required/forbidden spell flags,
innate frequency, forbidden races, base membership, and color membership all
match. The nested pit lists are therefore harmless prepends: every consumer is a
membership scan with no first-match result and no RNG.

The two caveats are important:

1. A fixed-stream reservoir walk through room templates/vaults can select a
   different equally likely candidate when list order differs, even though that
   does not explain a changed theme distribution by itself.
2. If Warriors/Ogres or other pit-only races remain divergent after RC1–RC3 and
   the order findings above are corrected, instrument profile selection and
   empty pit outcomes before changing pit data or weights.

## Bottom line

RC1 and RC3 are definite live generation defects. RC2 is definite for friends
and for drops, but its proposed drop-only array reversal is not a complete data
fix for interleaved `drop`/`drop-base` directives. The prepend audit exposes
additional parity defects outside the immediate S-3 generation symptom; the
highest-priority follow-up after RC1–RC3 is to fix the monster alternate-message,
mimic/shape, and drop-stream representations if exact seeded parity is required.
