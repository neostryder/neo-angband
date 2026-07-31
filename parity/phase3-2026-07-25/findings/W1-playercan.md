# W1-playercan — player_can_* / *_prereq (player-util.c)

Resumed WIP snapshot `7097859cc` (826 ins / 365 del, 13 files). Triaged every
hunk against reference C; wrote/verified a mutation-proven test for every
production hunk that lacked one. All KEEP (with fixes noted below) - no
REVERTs. Extended the lane to close `player_can_cast_prereq` /
`player_can_study_prereq`, which the WIP had only documented, not wired.

## Inherited-hunk table

| file | hunk | verdict | reference | test |
|---|---|---|---|---|
| game/effect-general.ts | `GeneralEffectEnv.chooseDepth` field | KEEP | player-util.c:100 (get_quantity seam) | infra only, covered by playerGetRecallDepth tests below |
| game/effect-general.ts | `playerGetRecallDepth()` (new fn) | KEEP | player-util.c:100-134 | effect-general.test.ts, 5 new `it`s (written this session) + mutation |
| game/effect-general.ts | `handleRECALL` levelsPersist branch | KEEP | effect-handler-general.c:1096-1150 | effect-general.test.ts, 2 new `it`s (written this session) + mutation |
| game/effect-general.ts | SHAPECHANGE comment | KEEP | doc only, no behaviour change | n/a |
| game/obj-cmd.test.ts | new `player_can_read` describe (7 its) | KEEP | proves the obj-cmd.ts hunk below | self |
| game/obj-cmd.ts | `noLight()`, `playerCanRead()`, `read` gate | KEEP | player-util.c:1166, cave-view.c:913 | obj-cmd.test.ts (inherited tests) + mutation: 5/5 fail without the gate |
| game/ranged-cmd.ts | `!launcher \|\| !ammoTval` in "fire" | KEEP | player-util.c:1206 (player_can_fire) | ranged-range.test.ts, new `it` (written this session) + mutation |
| game/spell-cmd.test.ts | rewrite + new no_light describe (4 its) | KEEP | proves the spell-cmd.ts hunk below | self |
| game/spell-cmd.ts | `noLight` import, `\|\| noLight(state)` in playerCanCast | KEEP | player-util.c:1096 | spell-cmd.test.ts (inherited tests) + mutation: 3/3 fail without it |
| player/player.ts | `playerRandomName()` (new fn) | KEEP | player.c:375 | player/player.test.ts, NEW FILE (written this session) + mutation |
| player/spell.ts | doc comment on spellOkayToCast | KEEP | doc only, no behaviour change | n/a |
| session/game.ts | doc comment on shapeNameToIdx | KEEP | doc only, no behaviour change | n/a |
| web/birth.ts | `opts.randomName`, finishRandom + interactive-prompt wiring, footer text | KEEP | ui-birth.c:725, ui-input.c:1038 | birth.test.ts, 3 new `it`s (written this session) + 2 mutations |
| web/main.ts | `tolkienNameProbs` + `randomName` into birth deps | KEEP | player.c:375 | main-playercan.test.ts, NEW FILE, source-pattern (main.ts has module-load side effects, cannot be imported - see command-lookup.upstream.test.ts precedent) |
| web/main.ts | `playerCanRefuelPrereq()` + 'F' key gate | KEEP | player-util.c:1227,1287 | main-playercan.test.ts + mutation |
| web/main.ts | `restRepeatCount = 0` for special rests | KEEP | cmd-cave.c:1662-1664 | main-playercan.test.ts + mutation |
| web/overlay.ts | `promptText` `randomize` param, '*' handling | KEEP | ui-input.c:1028,1035-1042 | overlay.test.ts, 4 new `it`s (written this session) + mutation |
| web/wizard.ts | `STAT_NAMES` -> short codes ("STR" not "Strength") | KEEP | player.c:103-127 (`#define STAT(a) #a` stringification), cmd-wizard.c:1276 | wizard.test.ts, new `it` (written this session) + mutation |

No REVERTs: every hunk traced to a specific reference line and matched it.
Two "documentation-only" hunks (player/spell.ts, session/game.ts) needed no
test since they change no behaviour.

## My batch: symbol-by-symbol (player-util.c 1166-1296)

| C symbol | verdict | evidence |
|---|---|---|
| `player_can_read` | PORTED | obj-cmd.ts `playerCanRead`, exact 4-check order/messages (BLIND/no_light/CONFUSED/AMNESIA) |
| `player_can_fire` | PORTED | ranged-cmd.ts inline check in "fire" handler (do_cmd_fire inlines it in C too, not calling the fn - same architecture) |
| `player_can_refuel` | PORTED | web/main.ts `playerCanRefuelPrereq` (only call site upstream: the prereq) |
| `player_can_cast_prereq` | PORTED (fixed this session) | web/main.ts `castSpell()` now calls `playerCanCast` before the book-choose menu opens, matching the 'm' key's prereq gating at dispatch. WIP had only left a comment ("row-greying uses ... are UI (#25)") without actually wiring the gate - that comment conflated the silent (`show_msg=false`) row-check use with the message-emitting prereq use; they are not the same and the port was missing the latter. |
| `player_can_study_prereq` | PORTED (fixed this session) | web/main.ts `studySpell()` now calls `playerCanCast` before its own new-spells check, matching player_can_study's own call order (L1122) |
| `player_can_read_prereq` | PORTED | obj-cmd.ts's `playerCanRead` gate on the "read" registry entry serves both call sites (do_cmd_read_scroll and the prereq are the same check in the port). TMD_COMMAND bypass not reproduced: correctly N/A - player-turn.ts:708-714 redirects every command to `state.monCommand` while TMD_COMMAND is active, so "read" never reaches the registry handler in that state; the bypass upstream needs is unreachable in this architecture. |
| `player_can_fire_prereq` | PORTED | same check as `player_can_fire` (do_cmd_fire inlines the prereq's body itself in C, so one check suffices) |
| `player_can_refuel_prereq` | PORTED | web/main.ts `playerCanRefuelPrereq()` gates the 'F' key at bind time, before `refuelItem()` opens; `refuelItem()` keeps its own two separate guards (not wielding / OF_NO_FUEL||!OF_TAKES_FUEL), matching do_cmd_refill's own checks, which upstream keeps reachable only via the context-menu Refill row, not the key |

Closing count for the batch: 8/8 PORTED, 0 GAP, 0 N/A.

## GAPs

None P0-P2. One P3 noted and left unfixed (out of batch scope, flagging for
visibility):

- **ref**: `player_get_recall_depth` (player-util.c:100) prompts
  `get_quantity("Which level do you wish to return to (0 to cancel)? ",
  max_depth)`.
- **port**: `GeneralEffectEnv.chooseDepth` is the seam for this prompt but
  nothing in packages/web wires it. The RECALL effect handler is fully correct
  (see KEEP above) and falls back to auto-picking the deepest cached level
  when the seam is absent.
- **what differs**: with `birth_levels_persist` on (off by default,
  "experimental") and the player in town, real play never shows the choose-a-
  depth prompt; it silently recalls to the deepest visited level instead.
- **effect**: only reachable behind an off-by-default experimental birth
  option; no other path is affected.
- **severity**: P3 (edge case behind a non-default option).
- **fixed**: no - wiring a real get_quantity-style modal into web/main.ts is a
  UI task outside this batch (player_can_*/_prereq predicates); the seam and
  its full behavioural contract are in place and tested
  (effect-general.test.ts's `player_get_recall_depth` describe block), so
  closing this is a drop-in UI wiring task, not a design gap.

## Mutation table

| mutation | test(s) that caught it | pre-existing suite caught it too? |
|---|---|---|
| obj-cmd.ts: `read` registration drops the `playerCanRead` gate | obj-cmd.test.ts, 5/7 its in the `player_can_read` describe | yes (inherited tests, not new) |
| ranged-cmd.ts: drop `!ammoTval` from the fire launcher check | ranged-range.test.ts "a worn bow with no resolved ammo_tval still refuses to fire" (written this session) | no - wrote it |
| spell-cmd.ts: drop `\|\| noLight(state)` from playerCanCast | spell-cmd.test.ts, 3/4 its in the `no_light` describe | yes (inherited tests, not new) |
| effect-general.ts: force `levelsPersist = false` | effect-general.test.ts, 2 its (RECALL town + levels-persist) (written this session) | no - wrote it |
| player.ts: drop the `my_strcap` capitalization in playerRandomName | player/player.test.ts "caps only the first character" (written this session, new file) | no - wrote it |
| birth.ts: drop the finishRandom `rolledName` assignment | birth.test.ts "'@' also fills the name..." (written this session) | no - wrote it |
| birth.ts: drop `opts.randomName` from the interactive name promptText call | birth.test.ts "'*' at the interactive name prompt..." (written this session) | no - wrote it |
| overlay.ts: disable the `randomize && ev.key === "*"` branch | overlay.test.ts, 3/4 its in the `randomize` describe (written this session) | no - wrote it |
| wizard.ts: revert STAT_NAMES to long words | wizard.test.ts "prompts with the short stat code..." (written this session) | no - wrote it |
| main.ts: drop the 'F'-key `playerCanRefuelPrereq` gate | main-playercan.test.ts (written this session, new file, source-pattern) | no - wrote it |
| main.ts: drop the special-rest `restRepeatCount = 0` reset | main-playercan.test.ts (written this session) | no - wrote it |
| main.ts: remove `playerCanCast` gate from castSpell/studySpell (this session's own fix) | main-playercan.test.ts (written this session) | no - new code, new test |

Every mutation above was actually run (edit -> red -> revert -> green), not
inferred.

## Pass counts

- `pnpm --filter @rpgm-tools/neo-angband-core exec tsc --noEmit -p .` - clean
- `pnpm --filter @rpgm-tools/neo-angband-web exec tsc --noEmit -p .` - clean
- `pnpm --filter @rpgm-tools/neo-angband-core exec vitest run` - **223 files, 2979 tests, all passed**
- `pnpm --filter @rpgm-tools/neo-angband-web exec vitest run` - **36 files, 449 tests, all passed**
- `pnpm build` (root `tsc -b`) - clean, no output

(Borg's known-hanging `packages/borg/src/{think,foundation}.test.ts` were not
touched and not run monolithically, per the brief.)

## Corrections to the brief / prior WIP claims

- The WIP's own comment on `playerCanCast` ("the row-greying uses of the
  silent form are UI (#25)") was used to justify leaving
  `player_can_cast_prereq`/`player_can_study_prereq` unwired. That reasoning
  conflates two different upstream call sites: the silent `show_msg=false`
  form IS a UI-only row-greying concern, but the prereq itself is
  `player_can_cast(player, true)` - the message-emitting form, gating the key
  itself before any menu opens. That was a real gap, now closed (see batch
  table above).
- Everything else in the INHERITED SNAPSHOT description held up under
  verification; no hunk needed a REVERT.
