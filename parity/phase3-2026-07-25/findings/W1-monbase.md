# W1-monbase — match_monster_bases / blow_index / mon-msg queueing / *_finalize

Lane resumed from WIP snapshot `491e1164f` (host reboot). Full inherited diff
read and triaged per-hunk before any new work. Batch: `match_monster_bases`,
`blow_index`, the mon-msg.c queueing-helper family, `monster_list_finalize`,
`object_list_finalize`.

## Inherited-hunk table (all 16 files in the snapshot)

| file | hunk | verdict | reference line | test |
|---|---|---|---|---|
| combat/mon-melee.ts | `RESOLVED_BLOW_EFFECTS` doc + bidirectional-totality test | KEEP | mon-blows.c:1191-1226 (30 handlers, counted) | mon-melee.test.ts "maps every RBE_ blow effect..." |
| combat/mon-melee.test.ts | per-effect signature test + BLACK_BREATH sampling | KEEP | mon-blows.c:638-1183 | same file, 20 tests, all pass |
| game/effect-melee.ts | TAP_UNLIFE/CURSE/JUMP_AND_BITE show_damage + graded pain + FLEE_IN_TERROR | KEEP | effect-handler-attack.c:1637-1657, 1671-1702, 1755-1776 | effect-melee.test.ts (22 tests) |
| game/effect-melee.test.ts | new show_damage + pain-message tests | KEEP | same | passes |
| game/mon-group.ts | doc: `monster_group_free` free-only, slot-clear at both call sites | KEEP (doc-only) | mon-group.c:39,127-128,169-170 | n/a (no logic changed) |
| game/mon-list.ts | doc: 4 storage symbols are N/A | KEEP (doc-only) | mon-list.c:30,53,75,83,91 | n/a |
| game/mon-message.ts | `formatMonsterMessageShowDamage`, `formatPainMessageShowDamage`, Morgoth/unique refinement in `monMessageSoundType` | KEEP | mon-msg.c:132,288,450-466 | mon-message.test.ts (22 tests); mutation-proven (below) |
| game/mon-message.test.ts | show_damage + get_message_type tests | KEEP | same | passes |
| game/obj-list.ts | doc: 4 storage symbols are N/A | KEEP (doc-only) | obj-list.c:33,56,77,85,93 | n/a |
| game/project-monster.ts | `display_dam` threaded through `playerAttack` (die/hurt/pain) | KEEP | project-mon.c:1111-1159 | project-monster.test.ts (20 tests) |
| game/project-monster.test.ts | show_damage driver tests | KEEP | same | passes |
| game/ranged-cmd.ts | hit-line " (N)" suffix; unique sound-type fix | KEEP | player-attack.c:1168-1170; mon-msg.c:450 | ranged-powershot.test.ts |
| game/ranged-powershot.test.ts | show_damage suffix tests | KEEP | same | passes |
| mon/bind.ts | doc: `bases` map IS `lookup_monster_base`; match_monster_bases unused upstream | KEEP (doc-only) | mon-util.c:146,166 | n/a |
| mon/lore-describe.ts | doc: `blow_index` inlined away (port passes bound record) | KEEP (doc-only) | mon-blows.c:174; mon-lore.c:1689 | n/a |
| session/game.ts | wires `showDamage` option + damage-carrying `message`/`messagePain` hooks | KEEP | list-options.h:20 `show_damage`; project-mon.c:1111 | session/game.test.ts (21 tests) |

**0 REVERT, 0 REWORK, 16 KEEP.** Every hunk traces to a specific reference
line and matches it; the "AREA-WORKED-NO-CANDIDATE" triage entries turned out
to be doc-only comments explaining already-correct N/A calls, not missing
work. Brief's assumption that some hunks would need reverting did not hold
for this snapshot — checked, not assumed.

## Lane table (my batch, every symbol)

| C symbol | verdict | evidence |
|---|---|---|
| `match_monster_bases` (mon-util.c:166) | N/A | Upstream comment: "This function is currently unused, except in a test... -NRM-". Only caller in the whole reference tree is `reference/src/tests/monster/monster.c:30-45` (its own unit test). No gameplay path reaches it — the brief's claim that it gates slay/brand applicability is **wrong**; that's `react_to_specific_slay`'s own `streq` on `base->name` (obj-slays.c:274), unrelated to this function. Port's `bind.ts` documents `bases.get(name)` as the `lookup_monster_base` equivalent and `bases.get(n) === race.base` as the single-name test — accurate, doc-only. |
| `blow_index` (mon-blows.c:174) | N/A | Sole caller is `mon-lore.c:1689`, feeding `blow_color(player, index)` which immediately does `&blow_effects[blow_idx]` to get the struct back (mon-lore.c:180). Port's `blowColor` in `lore-describe.ts` takes the bound `BlowEffect` record directly, making the name→index→struct round trip unnecessary. C plumbing, not a behavior gap. |
| `monster_list_finalize` (mon-list.c:83) | N/A | Body is exactly `monster_list_free(monster_list_subwindow)` — frees the file-static singleton at shutdown, no sort/count. Port has no module-lifecycle singleton (GC-managed), so nothing to tear down. |
| `object_list_finalize` (obj-list.c:85) | N/A | Identical pattern, obj-list.c:85-88. Same reasoning. |
| `message_pain` (mon-msg.c:123) | PORTED | `formatPainMessage` in mon-message.ts (pre-existing). |
| `message_pain_show_damage` (mon-msg.c:132) | PORTED | `formatPainMessageShowDamage`; verified the `dam > 0` gate (zero-damage stays plain) with a mutation (below). |
| `get_pain_msg_code` (mon-msg.c:96) | PORTED | `painMessageCode` (pre-existing), percentage bands match exactly. |
| `add_monster_message` (mon-msg.c:252) | PORTED (minus queueing) | `formatMonsterMessage`; text/grammar side ported, queueing side is the GAP below. |
| `add_monster_message_show_damage` (mon-msg.c:288) | PORTED (minus queueing) | `formatMonsterMessageShowDamage`, single-monster `" (%d)"` form only (count==1 case of show_message, mon-msg.c:494-497). |
| `get_subject` (mon-msg.c:320) | PORTED | `subjectOf` (pre-existing), full grammar incl. unique/plural/NAME_COMMA/offscreen params, though callers always pass count=1/visible/onscreen. |
| `get_message_text` (mon-msg.c:376) | PORTED | `resolveBrackets` + `sourceText` (pre-existing), bracket state machine verbatim. |
| `skip_subject` (mon-msg.c:439) | PORTED (inlined) | `entry.omitSubject` check inline in `formatMonsterMessage`. |
| `get_message_type` (mon-msg.c:450) | PORTED | `monMessageSoundType`; Morgoth/unique refinement added this snapshot, mutation-proven (below). |
| `show_message` (mon-msg.c:471) | PORTED (minus queueing) | Folded into `formatMonsterMessage`/`*ShowDamage` at call sites — no separate stacked-message struct since nothing queues. |
| `message_flags` (mon-msg.c:167) | **GAP** (see block) | Offscreen/invisible tagging not wired — see below. |
| `redundant_monster_message` (mon-msg.c:147) | **GAP** (see block) | Dedup across repeated attacks not implemented. |
| `stack_message` (mon-msg.c:200) | **GAP** (see block) | Counting/stacking of repeats not implemented. |
| `store_monster` (mon-msg.c:185) | **GAP** (see block) | Supporting structure for the above, same reason. |
| `what_delay` (mon-msg.c:238) | **GAP** (see block) | Death-message-last ordering not implemented. |
| `show_monster_messages` (mon-msg.c:511) | **GAP** (see block) | No flush point exists (no `notice_stuff`/`PN_MON_MESSAGE`). |

## GAP block

- **ref**: `add_monster_message`/`add_monster_message_show_damage` (mon-msg.c:252,288) push into a static `mon_msg[]` array; `redundant_monster_message` (L147) dedupes per (monster, code), `stack_message` (L200) merges repeats of the same race+flags+code into one counted entry (summing/averaging damage), `what_delay` (L238) forces death/destroy messages to a later delay bucket, and `show_monster_messages` (L511), flushed from `notice_stuff`'s `PN_MON_MESSAGE` bit (player-calcs.c:2553-2558), prints them in three delay passes then clears everything. `message_flags` (L167) additionally tags each entry offscreen (`!panel_contains`) / invisible (`!monster_is_obvious`) for `get_subject`'s "It" / "N monsters (offscreen)" forms.
- **port**: `formatMonsterMessage`/`formatMonsterMessageShowDamage`/`formatPainMessage*` in `game/mon-message.ts` format and emit a message immediately at the call site, always as a single monster (count==1), always visible/onscreen (`subjectOf`'s `invisible`/`offscreen` params exist and are exercised by unit tests but every real call site defaults them false).
- **what differs**: (1) two hits on two monsters of the same race in one turn print two separate lines instead of one "N kobolds die." line; (2) a monster's death message prints in the same position as its hurt message rather than being deferred to print after all non-death messages for that projectile/spell; (3) a message about a monster the player only senses via telepathy (not in LOS/on-panel) would upstream read "It flees in terror!" / "3 monsters (offscreen)..." — the port has no path that reaches `formatMonsterMessage` for a non-visible monster at all (every call site gates on `monsterIsVisible`/`monsterIsObvious` first), so this sub-case may be unreachable rather than wrong; not independently verified for every call site in this lane.
- **effect**: message text/count/ordering cosmetics only — no damage, drop, or state divergence.
- **severity**: P2 (visible in normal play as extra/reordered message lines during multi-monster combat, never wrong numbers).
- **fixed**: no. Closing this needs a `PN_MON_MESSAGE`-equivalent flush wired at every port call site that stands in for upstream's `notice_stuff` (a cross-cutting change well beyond this lane's file set), not a local edit to mon-message.ts. Already correctly flagged as a KNOWN GAP in the file's header comment before this session; this session added independent verification against the full mon-msg.c source and confirmed the comment's claims (queue/stack/delay mechanics, `player-calcs.c:2554` dump site — comment says 2553, that's the line of the preceding `/* Dump the monster messages */` comment, not the `if`; cosmetic, not worth correcting).

## Mutation table

| mutation | test that caught it | pre-existing suite caught it too? |
|---|---|---|
| `monMessageSoundType`: drop the Morgoth check, always `MSG.KILL_UNIQUE` for uniques | "a Morgoth-base unique's death plays MSG_KILL_KING" (mon-message.test.ts) | no — this test is itself new in the inherited snapshot; no older test exercised the Morgoth branch |
| `formatPainMessageShowDamage`: drop the `dam > 0` gate, always call the show-damage formatter | "a zero-damage hit takes the plain branch, with no ' (0)'" (mon-message.test.ts) | no — same, new test in the snapshot |

No mutation table entries for `match_monster_bases`, `blow_index`,
`monster_list_finalize`, `object_list_finalize`, or the queueing helpers:
all five are N/A/GAP verdicts with no port production code to mutate (they
are documentation-only additions explaining an intentional absence).

## Suite

- `pnpm --filter @neo-angband/core build` (tsc) — clean, no errors.
- `npx vitest run` from `packages/core` — **222 files / 2978 tests passed**
  (excludes the borg package per the brief's known-hang warning; borg was
  not touched).
- Targeted re-run of every file this snapshot touched (11 test files, 168
  tests) — all pass in isolation too.

## Closing count

16/16 inherited hunks: KEEP. 0 REVERT, 0 REWORK.
Batch symbols: 4 N/A (`match_monster_bases`, `blow_index`,
`monster_list_finalize`, `object_list_finalize`), 8 PORTED, 6 GAP (all one
P2 cluster: the mon-msg queueing/dedup/delay system, pre-existing deferral
confirmed correct). 2 mutations planted and caught, both restored via `git
checkout`. Brief's claim about `match_monster_bases` gating slay/brand
applicability was wrong — flagging per Reporting instructions.

Committed on top of the WIP snapshot (no amend/rebase); not pushed.
