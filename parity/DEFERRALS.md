# What is not ported, and what was judged unnecessary

**Dated 2026-08-04. Every deferral note in this repository has a verdict.**

**Working the list?** [PORT_TODO.md](PORT_TODO.md) is the checklist derived from
this document — the same citations, tiered, with the two items that unlock a
dozen others first. This document is the *accounting*: why each verdict was
reached, and what was judged unnecessary rather than missing.

For most of this port's life "deferred" was written in a comment by whoever was
closing a lane, and nobody could tell afterwards which of those notes described a
hole and which described work that had since landed. The word appeared 439 times.
This document is the answer to "so what is actually missing", and it is backed by
a re-runnable census rather than by recollection.

```
node parity/tools/deferral-census.mjs             # rebuild the row list
node parity/tools/deferral-triage.mjs             # add the mechanical hint column
node parity/tools/deferral-verdict.mjs <ref> ...   # record one adjudication
node parity/tools/deferral-report.mjs             # regenerate the appendix below
node parity/tools/ledger-deferred-items.mjs       # the second tranche (see below)
```

## Addendum, 2026-08-09: a class of gap this census cannot see

Every row below starts from a **note** — a comment, a ledger `deferred:` entry —
and asks whether it is still true. That finds stale excuses. It cannot find a
seam that was declared, documented, consumed by the engine and **never written
by the production wiring**, because such a seam has no note: it reads as
finished from every angle except running it.

Measured with a producer-form sweep over all non-test TypeScript in
`core` / `web` / `cli` / `mcp` (both scripts are on task #160): for each optional
member of every `*Deps` / `*Env` / `*Hooks` / `*Callbacks` / `*Ports` interface —
85 of them — does *any* producer form exist anywhere? A literal entry, a
mutation, a shorthand. **21 interfaces carry an optional that nothing in the
shipped game supplies.** Closed so far:

- **`GameEffectEnv.banishSymbol`.** `EF_BANISH` returned `false` on every real
  cast, so the Banishment spell (`class.txt:429`), the Scroll (`object.txt:2776`)
  and Staff (`object.txt:4364`) of Banishment and the artifact activation all
  silently did nothing. The ledger called the absent seam "mirroring a cancelled
  prompt" — an excuse that ships a dead spell.
- **Nine of `TeleportEnv`'s sixteen members.** Dimension Door returned `false`
  every time; the OF_NO_TELEPORT curse never blocked a teleport and its rune was
  never learned; a teleport could land the player in lava; nexus resistance never
  foiled a hostile teleport-level; `force_descend` targeted the current depth
  instead of the deepest reached; the dungeon bottom was hardcoded to 128. Each
  of these was deferred on a subsystem — `#19` monster spells, `#21` traps, `#23`
  level change, `#24` targeting — that had **already shipped**.
- **`TeleportEnv.targetMonster`** is no longer a dep. `monsterTargetMonster` has
  been exported from `game/effect-mon-origin.ts` for a long time and three other
  effect modules call it directly; the teleport handlers were the ones left
  behind, so a monster teleporting the monster it was aiming at teleported
  *itself*.

Both fixes are guarded by tests written as the **consumer** — a real game, the
real command, the observable outcome — with the control run recorded:
`session/banish-symbol-wiring.test.ts` and `session/teleport-env-wiring.test.ts`.
Removing a supply makes them fail; that was checked, not assumed.

A second batch, same sweep:

- **`FloorEnv.onBreak` / `onDrop`.** An item that broke on a throw, or vanished
  because `floor_carry` had no room for it, disappeared in **silence** —
  upstream's `floor_carry_fail` says "The Potion of Death breaks." A *third*
  defect fell out of testing it: `installRangedCommands` passed a bare `{}` as
  its `FloorEnv` at both `dropNear` sites, so the fired-arrow and thrown-flask
  paths could not see the new messages, the ignore rule, *or* the trap rule.
  Every other `dropNear` call site in the port already threaded it — a seam
  supplied to every path but one.
- **`SpellChanceEnv.hasPf`.** `player_has(p, pf)` reads `p->state.pflags` — race
  ∪ class ∪ shape. With no producer, every live `spell_chance` and
  `beam_chance` read the **class** flags alone. Identical on the shipped 4.2.6
  data (nothing but a class grants ZERO_FAIL / UNLIGHT / BEAM) and wrong the
  moment a mod ships a race or shape that does.
- **`ObjectInfoDeps.inStore`.** `object_is_in_store`: a shop shows a useable
  item's real effect even when its flavour is unknown, which is the entire point
  of being able to read the shelf. Nothing ever set it.
- **`ProjectMonsterHooks.onUpdate`.** `update_mon` on a monster that *survived* a
  projection (`project-mon.c:1262`), so one that was polymorphed, knocked back,
  woken or revealed kept its pre-projection visibility.

Guarded by `session/seam-producer-wiring.test.ts`; the control strips the four
supplies and four of its six tests fail.

**Adjudicated and correctly benign** — each has a real default that reads the
live game, so the optional is an override and not a hole:
`PickupEnv.pickupAlways` / `pickupInven` and `FloorEnv.birthStacking` (all three
fall through to `state.options`), `ObjCmdEnv.chooseDir` / `SpellCmdEnv.chooseDir`
(the shell asks and rides the answer on `args.dir`, gated by the same
`objNeedsAim` / `spellNeedsAim` predicate core reads),
`GeneralEffectEnv.chooseDepth`, `MeleeSideDeps.healHp`,
`LoreDeps.spellLoreDamage`, and `TakeHitHooks.onRedrawHp` (a `PR_HP` redraw flag
has no analogue: the renderer is immediate-mode and recomputes every frame).
Host and platform config — `SoundHooks`, `UpdateCheckDeps`, `FileSinkDeps`,
`FreshnessDeps`, `TitleDeps`, `DesktopRefreshDeps`, `BuildScoreDeps` — is not
game behaviour and is out of scope for this document.

**`ProjectWorldEnv.protectedObj`** — upstream's "the object that created this
projection must not be destroyed by it" (`project.c:921` passes `obj` to every
`project_o`, and every effect handler passes `context->obj`). The port's
`CastSource` carried no source object at all, so the exemption could never fire:
a wand or rod lying on the floor inside its own blast burned itself. `CastSource`
now carries `obj`, `sourceFor` reads it off the effect context, and
`castProjection` installs it on the world env. Guarded by two identical scrolls
on one grid, one handed to `effect_do` as `obj` — a run without the fix destroys
both.

Nothing from the sweep is left open.

The lesson for this document: **"is the note still true" and "does the seam have
a producer" are two different questions, and only the first one has ever been
asked here.**

## The headline

**141 of the 367 notes were describing a state of the code that no longer held,
and they have been rewritten.** The census is 232 rows because 140 of those
notes no longer read as deferrals at all.

The notes were a fossil record of the build order, not a description of the port.
The single most common shape: core was built as a headless library first, so a
note says "the launcher analysis is deferred" or "calc_mana is deferred" and means
"the world layer that does this had not been written the week I wrote this line".
Both are ported. So is the quiver, the options menu, the target system, monster
shapechange, `pit.txt` selection, `message_lookup_by_name`, monster-vs-monster
melee, `react_to_slay` on the player's pack, `pack_overflow`, the fear block of
`mon_take_hit`, `generateStats`, the store's book expansion, O-combat, temporary
brands and slays, the elemental component of monster blows, and every one of the
twenty command codes the base registry registers as stubs.

A further 27 notes were not parity claims at all — a variable named `todo`, a
`setTimeout` "deferred a tick past focus", one mod that "defers to" another.

**What was genuinely missing was 76 citations, collapsing to 68 work items in
[PORT_TODO.md](PORT_TODO.md)** - all of them closed as of 2026-08-07. The counts
in this sentence have moved in both directions since it was first written, which
is the point: re-reading the ledger finds work about as often as it kills it.
Grouped below by what a player would notice. Two
are architectural (`notice_stuff` / `PN_*`, and the carried-weight total nothing
sums); the largest by volume is a debug log.

### The second pass, and why a closed item does not close its row

**A verdict is dated evidence exactly like the note it judges.** Closing those 68
work items meant rewriting the notes that described them, and a note whose prose
changes is a different row: the census keys a row on its file and the opening of
its text. So re-running it after the closure work retired **71 rows** and
delivered **76 with no verdict at all** — mostly the same claims, re-adjudicated
because the sentence they were made in had been replaced.

Retired rows go to `parity/reports/deferral-census-retired.tsv` with the reason
each one left (54 rewritten, 15 deleted, 2 in files that no longer exist) rather
than disappearing, because **44 of them had been adjudicated `real`** and a row
that vanishes takes its claim with it. Four families were spot-checked against
the code rather than against the retirement note: the two chest sites now call
`equipLearnFlag(OF_TRAP_IMMUNE)` (`game/chest.ts:277`, `:362`), the two death-cause
sites call `monsterDesc(mon, MDESC_DIED_FROM)` (`game/effect-attack.ts:694`,
`game/project-cast.ts:136`), the knowledge browser produces `object_info`'s
computed lines (`web/src/knowledge.ts:1000`, `:1176`), and the birth screens
answer `?` with `runHelp`.

The 76 came back mostly `note-is-fix` — a record of a repair, which is what a
rewritten note is. Two are worth reading, and neither is what it looked like.

**A whole deferred list that was already ported.** `mon-make.yaml` deferred
`update_mon`, `mon_create_drop`, `mon_create_drop_count`, mimicked-object
creation, summon placement and compaction. Every single one is in the tree —
`game/known.ts:895`, `game/mon-death.ts`, `game/mon-place.ts:335`, `summonSpecific`
via `game/effect-summon.ts:83`, and `compactMonsters` at `game/loop.ts:372` with
`monsterIndexMove` at `game/world.ts:660`. The list described the week it was
written.

**A gap that turned out to be an upstream wart.** `game-effect-general.yaml`
deferred `update_smart_learn(PF_NO_MANA)` in `EF_DRAIN_MANA`, and it read as the
familiar shape — an engine that exists (`mon/spell.ts`), already wired elsewhere
(`game/mon-cast.ts:199`), with one call site not reaching it. It is not. The
upstream call is `update_smart_learn(mon, player, 0, PF_NO_MANA, -1)`
(`effect-handler-general.c:992`), and `mon-util.c:794` returns immediately when
the flag is 0 and the element is out of range — which is that argument list
exactly. It is the **only one of the nine call sites in 4.2.6 that passes a
pflag**, so the pflag arm at `mon-util.c:822-829` is unreachable and
`known_pstate.pflags` is never written in any game of Angband. Porting the call
would have reproduced a function that returns before its own body. The reason the
port's comment gave — "rides lore (#24)" — named a blocker that was never the
reason, which is why this took a reading of the C to settle rather than a reading
of the note.

### The third thing: a retraction that read one of its five sites

**Prose is not behaviour, and that includes a comment written by the person
checking.** One of the two rows the second pass left owed was `pile_insert_end`,
and it had already been retracted once: an earlier pass censused all five upstream
call sites, tested four of them, and closed the fifth by quoting the port's own
docblock — *"`wieldAll`'s docblock already records the deferred-append
behaviour."*

It recorded something else. Upstream's `wield_all` collects each split remainder
into a local `new_pile` with `pile_insert`, which **prepends**, and appends that
block to the gear exactly once after the loop, so the tail reads `[last split …
first split]`. The port pushed each remainder as it made it. What the docblock
actually described was the deferred **scan** — the loop walks a snapshot, so a
remainder is not re-wielded — and the sentence was read as the deferred
**insert**. A retraction that tests four sites and reads the fifth has tested four
sites.

The consequence is bounded, and that was measured rather than assumed:
`wield_slot` returns `-1` for ammo (obj-gear.c:341-367) and the only stacked
WIELDABLE item in any of `class.txt`'s 52 `equip:` lines is the Wooden Torch, so
4.2.6 creates exactly one remainder and one element reversed is itself. **A mod
whose starting kit stacks two wieldables sees it** — the same shape as the
element-name mirror in `add_brand`, where a guard proved the port matched 4.2.6
and could not see the case that mattered.

Fixed, and pinned by a test whose fixture is a two-stacked-wieldable kit no class
ships, mutation-verified by dropping the `reverse()`. The sentence that fed the
census row went too: `pile.upstream.test.ts` said "pile_insert_end has NO port
counterpart: nothing in the live port appends", which was true of the **floor**
and false of the port. **A claim scoped to one pile must say which pile.**

### And the other owed row was not owed: a grep for a name the port never uses

The second of the two survivors said `cmd_disable_repeat_floor_item` had **"no
port equivalent (0 references)"**. It has eight: `game/repeat.ts`'s
`cmdDisableRepeatFloorItem`, called from `game/context.ts:1276` and `:1282`,
`game/project-obj.ts:206`, and `session/game.ts:2307`, `:2358`, `:2487`, `:2677`,
with the flag it reads set by `repeatBeginCommand` at `game/player-turn.ts:1003`.

The reference count was produced by searching for `cmd_disable_repeat_floor_item`
— the C's `snake_case` name — in a `camelCase` codebase. It finds nothing whatever
exists. **A count is only evidence if the thing counted is spelled the way the
code spells it.**

The ledger note that carried the claim was pre-game-loop prose ending "tracked for
the game-loop phase". That phase happened — PORT_TODO 2.12 wired every site — and
nobody came back to the line. It also **bundled a second, unrelated claim** (the
interactive `cmd_get_*` prompting helpers), which is why it could not be closed:
a row asserting two things is closable only when both resolve the same way. Split,
and the second half classified: the port resolves every command argument in the
shell *before* dispatch rather than lazily inside the getter, so the item picker,
the targeting overlay and `getQuantity` are the same prompts at a different moment.
That is a divergence with a stated cost — a command cannot decide mid-execution to
ask for something it did not know it needed — not an absence.

**With both survivors resolved, this census holds no `real` rows.** Which is worth
one sentence of suspicion rather than a celebration: one of the two was closed by
fixing code and the other by discovering the claim was never true, and only the
second kind is free.

### Live defects this found

Both by re-reading a note that had handed its work to somebody else, and they
share a shape: **a function or a field that exists, is correct, and is wired to
nothing.**

**A retraction first, because it is the more useful finding.** This section
previously said *"`disturb()` has no callers"*, and that was wrong. It has eleven
importers and 24 call sites. The claim came from greping the port for the C's own
spelling, `disturb(player)`, which the port never writes — the same
failed-transliteration mistake that had already cost four wrong verdicts earlier in
this sweep, running in the opposite direction.

Worse, the same mistake was in the census that produced the claim: the C writes
both `disturb(player)` and `disturb(p)`, and greping one spelling found **38 sites
where there are 53**. The fifteen it could not see included the player's own
melee, a monster's blow landing or visibly missing, and the two run safety-stops
that are the entire point of the DTrap indicator.

Doing the census properly — [game/disturb-census.test.ts](../packages/core/src/game/disturb-census.test.ts),
which now derives it from the C rather than declaring it — found **twelve genuinely
absent sites**, all since wired:

| Upstream | What was missing |
|---|---|
| `player-attack.c:996` | the player's own melee did not disturb |
| `mon-attack.c:594` | a monster's blow CONNECTING (before damage, so a 0-damage effect blow was silent) |
| `mon-attack.c:721` | a visible monster MISSING you |
| `cmd-cave.c:1086` | a run walked the player onto their own detected traps |
| `cmd-cave.c:1150` | a run carried the player out of the detected-traps zone |
| `cmd-cave.c:1599`, `player-util.c:1609` | stepping onto a shop door |
| `cmd-pickup.c:430` | autopickup — an `env.disturb?.()` seam nothing ever supplied |
| `cave-view.c:852` | the mid-level object feeling, message and all (see below) |
| `game-world.c:794`, `:820` | word recall and deep descent activating |
| `game-world.c:1017` | arriving on a new level |

Note which instrument found what. A grep produced three wrong answers in a row.
The census — parse the C, count, reconcile both directions — produced the list
above, and it fails if either side changes. That is the difference between a search
and a measurement.

**The feeling reveal is worth its own line, because the near side of the seam was
tested.** `cave-view.c:849-853` announces the object feeling the moment the player
uncovers enough of a level. The port turned that into `events.signal("feeling")`,
and three tests in `world/fov.test.ts` proved it fires at exactly the right
crossing. **Nothing subscribed to it, in either host.** The event had test
subscribers and no production ones, so the message never reached a player and the
run never stopped — with a green suite over it. "The event fires" is not "the game
reacts", and a test that owns only one side of a seam cannot tell them apart.

**Nothing summed the player's carried weight** — fixed. `player.upkeep.totalWeight`
was set to 0 in `playerOutfit` and thereafter written only by the wizard's quantity
editor (`game/wizard.ts:1470-1471`); `calc_inventory`'s weight accumulation had no
port at all. So `calc_bonuses`' carrying-weight speed penalty
(`player/calcs.ts:1216`) could not fire at any load, the shield bash was short by
`trunc(totalWeight / 80)` (`combat/melee.ts:617`), and the character sheet's Burden
line read `0.0 lb` for every character.

Upstream does not recompute the total; it maintains a running one at four choke
points in `obj-gear.c` and re-sums the whole gear on load, and that is what the port
now does (`game/gear.ts`, plus the `load.c:1179-1185` re-sum in `session/game.ts` —
which is also the migration, since a character saved by any earlier build has a
stored total of zero). Proved by
[game/gear-weight.test.ts](../packages/core/src/game/gear-weight.test.ts), which
tests the three observable consequences rather than the accounting statements and
derives its ground truth by summing the gear: breaking any one of the four sites
kills at least one assertion.

How it hid is the interesting part. Its note read *"the running carried-weight
total (beyond the reset to 0); recomputing it belongs to the calc/inventory
owner"* — a deferral that names its successor instead of itself. The calc owner
never took it, and because the note called it an upkeep counter rather than a
mechanic, nothing about it looked like a gameplay bug. **A handoff with no
recipient reads as done to everyone who passes it.**

**The cursed weapon's combat terms** were the other, and they are fixed.
`object_to_hit` and `object_to_dam` (`obj-util.c:296-326`) add each **active
curse's** template bonus to the object's own, and the port returned `obj.toH` /
`obj.toD` alone. The comment excusing it — *"no object carries curses through
combat yet"* — had stopped being true: `GameObject.curses` is real and `applyCurse`
fills it during generation. Three shipped curses carry a combat penalty
(enveloping −5/−5, irritation −15/−15, air swing −20/0), so a cursed weapon's
to-hit and damage were wrong in play. Fixed, with the curse table threaded from
both live melee paths (`MeleeOptions.curses`) and the expected values derived from
the shipped pack in `combat/object-bonus-curses.test.ts`.

Note what it reproduces: `calc_bonuses` already folds a worn item's curse `to_h`
into `state->to_h`, and `py_attack_real` then adds `object_to_hit(weapon)` on top,
so upstream counts a cursed **weapon's** penalty twice. Core keeps the C's warts;
the `bug-fixes` mod is where that would be corrected.

The ledger line that carried the stale label — `combat-melee.yaml`'s
`object_to_hit, object_to_dam, object_weight_one (curse terms DEFERRED)` — has
been corrected too, which is why the census fell from 228 rows to 227 and the
`real` count from 86 to 85. Recording a verdict and leaving the lie in the file
is not a fix.

### The second tranche, measured: 331 items

The census greps for deferral *wording*, and the ledger's `deferred:` **list
items** mostly do not repeat the word:

```yaml
deferred:
  - Curse contributions to object_to_hit/to_dam/weight.
  - monster_attack_monster (monster-vs-monster melee).
```

Neither line was ever a census row, and both had stopped being true — the first
was the live defect above. The bare-key exclusion was right (a field name is not a
claim); the reasoning written next to it, that the entries underneath are "matched
on their own text", was wrong, which is the worse of the two errors.

`parity/tools/ledger-deferred-items.mjs` now scans those blocks structurally and
finds **331 items across 72 ledger files**. The one file
worked as a sample — `combat-melee.yaml`, 11 items — came out **ten stale, one
real**, which is the same rate as the first tranche and the reason the live defect
above sat unnoticed: it was in a list nobody re-read.

**Progress: 135 of 331 adjudicated** — `ui-display`, `ui-player`, `ui-entry`,
`wizard-debug`, `game-gear`, `obj-knowledge`, all four `store-*`,
`player-history`, `obj-desc`, `mon-lore`, `mon-lore-describe`,
`game-effect-terrain`, `game-effect-teleport`, `game-player-path` and
`game-mon-cmd`. The rate held: **47 `ported`, 19 `stale-doc`, 13 `divergence`,
5 `not-a-deferral`, 3 `n-a`, 2 `note-is-fix` against 28 `real` and 18
`partial`** — two rows in three were not owed work. The owed ones are what
matters, and they include both live defects above. 196 remain.

## Genuinely not ported

Grouped by what a player would notice, worst first. Every line is backed by a row
in the appendix with the file, the C reference and the evidence.

### It changes what happens in play

- **Nothing sums the player's carried weight** (`game-gear.yaml:77`,
  `store-transact.yaml:54`). `player.upkeep.totalWeight` is written in exactly two
  places — set to 0 at birth, and adjusted by the wizard — so the speed penalty for
  being overloaded (`player/calcs.ts:1216`) can never fire. See above.
- **`square_isempty` is weaker than upstream's** (`game/context.ts:1088`).
  `cave-square.c:604` rejects a player trap, a web, and any object; the port
  checks only passable / no monster / not the player, at 48 call sites. Placement
  loops can accept grids upstream rejects, which also moves RNG draws.
- **The `PN_IGNORE` notice pass is never run** (`game/context.ts:297`,
  `session/game.ts:542`, `obj/knowledge.ts:1366`). Becoming aware of an item kind
  sets the flag and nothing consumes it, so newly-ignored items are not dropped.
  The menu / `K` trigger of the same pass *is* reproduced.
- **Monster-vs-monster theft ignores `react_to_slay`** (`mon/steal.ts:234`,
  `mon-util.c:1548`). The player's own pack is protected correctly.
- **`alter` (`+`) has no chest or floor-trap branch** (`game/cave-cmd.ts:1045`).
  The note excused this because "alter is not wired to a shell key yet"; the
  shell has bound it since, which is what makes the gap reachable.
- **The chest `OF_TRAP_IMMUNE` rune is never learned** (`game/chest.ts:268`,
  `:346`) — the branch upstream learns in is empty in the port.
- ~~**`known_only` does not exist**~~ (`player-calcs-bonuses.yaml:78`) - CLOSED
  by PORT_TODO 2.6. `CalcBonusesOptions.knownOnly` is the flag, the session
  derives `p->known_state` beside `p->state`, and `prt_ac`, the character
  sheet's combat panel and the monster-recall colouring read it. The row's
  scoping was wrong in an instructive way: all three combat runes are granted
  at birth (`player-birth.c:1264-1267`), so the `to_a` / `to_h` / `to_d` gates
  never close and the two screens barely move. What `known_state` withholds is
  RESISTS and OBJECT FLAGS, and the reader that cares is
  `player_inc_check(..., lore = true)`.
- **`pile_insert_end` is absent** (`game/gear.ts:1173`), so ordering inside a
  floor pile can differ from upstream's append-at-end.
- **`path_analyse`** (`game/known.ts:750`) and the **known-object shadow cave**
  (`game/floor.ts:18`). ~~`list_object` / `oidx` bookkeeping~~ - re-adjudicated as
  a DIVERGENCE (`game/mon-place.ts:267`, `:328`): the port replaced upstream's
  `cave->objects[]` registry with a grid-keyed pile map plus `obj.mimickingMIdx`,
  and nothing observable depends on an oidx.
- **`object_flag_is_known` at the three store sites** (`store/store.ts:232`,
  `:262`, `store-maint.yaml:34`). `store_init`'s runtime owner selection turned
  out to be PORTED (`storeChooseOwner`, `store/store.ts:100`).
- **The `OSTACK_LIST` stacking checks** (`obj/object.ts:923`, `:1000`): two
  objects the player cannot tell apart must not merge in a list context.
- **`cmd_disable_repeat_floor_item`** (`cmd-core.yaml:25`).
- The **monster-source decoy / target-monster branches of `EF_TOUCH`**
  (`game/project-cast.ts:685`).

### It changes what the player is told

- ~~**`add_monster_message` has no queue**~~ (`game/mon-message.ts:15`) - CLOSED
  by PORT_TODO 3.1. This was called "the one architectural item on the list", and
  it was: the grammar was verbatim and every emit site printed its own sentence,
  so repeats never combined into "3 kobolds die.", a monster caught twice by one
  splash was described twice, and a death could be reported before the pain that
  caused it. `mon_msg[]`, `stack_message`, `redundant_monster_message`,
  `what_delay` and `show_monster_messages` are now ported whole, `PN_MON_MESSAGE`
  is the third `PN` bit, and `noticeStuff` drains it. What reading the C then
  turned up, and the item did not say: `player_kill_monster` calls `notice_stuff`
  ITSELF before the kill line (`mon-util.c:1046`, `:1055`) — two of upstream's
  fifteen `notice_stuff` sites, both unwired until now.
- **The killer's name is a race name, not `monster_desc(MDESC_DIED_FROM)`**
  (`effects/handlers.ts:78`, `game/effect-attack.ts:687`). Both halves exist —
  `MDESC_DIED_FROM` is defined at `mon/desc.ts:61` — and are not joined.
- ~~Monster recall has no computed percentages~~ - PORTED and wired:
  `meleeHitPercent` and `monsterHitPercent` at `web/main.ts:3650` and `:3652`,
  `breathProjection` at `:3659`, with `web/screens.test.ts:929` asserting the real
  melee percentage reaches the recall screen. Four interface comments still said
  `DEFERRED`, which is the whole reason this line was here.
- **Object and ego recall show no computed lines** (`web/knowledge.ts:1095`,
  `:1185`). `desc_obj_fake` and `desc_ego_fake` print a name and the record's lore
  text where upstream prints `object_info(OINFO_FAKE)` / `object_info_ego`'s flag
  and combat lines. The producer exists (`obj/object-info.ts`).
- **Monster spell and breath damage are not bound to the casting race**
  (`mon-lore-describe.yaml:55`). `deps.spellLoreDamage`
  (`mon/lore-describe.ts:149`) is a full override with no supplier anywhere, so
  `monSpellLoreDamage` returns 0 and upstream's `(N)` is omitted at every spell.
  Distinct from the two above: a `mon/spell.ts` binding, not a display call.
- ~~`show_floor` for multiple objects~~ - PORTED: `showFloorList`
  (`web/src/overlay.ts:301`), called at `web/main.ts:5967`.
- **The knowledge browser's thematic grouping columns** (`web/screens.ts:872`,
  `gamedata.yaml:478` — this is `ui_knowledge.txt`). The browser is ported; the
  grouping the datafile defines is not.
- **The high-score entry cannot name the real killer** (`high-scores.yaml:96`).
- **The character sheet's launcher contribution is 0** (`game/ui-entry.ts:1392`,
  `ui-entry.yaml:133`) — and the reach it calls deferred exists, at
  `player/calcs.ts:1246`. ~~`show_combined` / `EQUIPCMP_SCREEN` never iterated~~ -
  PORTED: `equipCmpCategories` (`game/ui-entry.ts:1965`) is iterated by
  `equipCmpSummary` (`game/equip-cmp.ts:391`), with the combined row asserted the
  same length as the columns (`game/equip-cmp.test.ts:116`).
- **`update_sidebar`'s priority culling and from-bottom placement**
  (`ui-display.yaml:124`). The sidebar itself is drawn.
- **The birth screens answer help with a no-op** (`web/birth.ts:1051`).
- **Temporary brands/slays are not shown in object info**
  (`obj/object-info.ts:962`). The combat half is ported.
- **The shape-lore textblock chain** (`web/main.ts:3697`, `:3701`).
- **The lore title does not recolour a unique with `purple_uniques`**
  (`mon/lore-describe.ts:1348`). Of that row's three claims only this one survived
  reading: the secondary glyph and the tile gating are the shell's, but
  `purple_uniques` is a live option (`generated/options.ts:25`) honoured by the map
  text layer and ignored by `loreTitle`.
- **Rune-learning messages still use the `ODESC_BASE` stand-in**
  (`obj/known-object.ts:160`). The real `object_desc` DID land - `describeObject`,
  `game/describe.ts:48` - but `objBaseName` (`obj/knowledge.ts:220`) is still "the
  kind's plain name" with `~` and `&` stripped, used by every rune message. The
  layering reason is real, so the fix is a seam rather than an import.
- **`equip_learn_flag` has no shape branch** (`obj-knowledge.yaml:98`), so gear
  merged into a shape is still learned from while shapechanged.
- ~~`object_list_format_name`'s own decoration~~ - PORTED:
  `objectListEntryName` (`game/obj-list.ts:289`) passes the summed count through
  `ODESC.ALTNUM` as upstream does. Only the shell-side "%3.3s" padding differs.

### Whole modes that were never begun

- **Arena mode** (`mon/take-hit.ts:17`, `gen/cave.ts:31`, `gen/generate.ts:11`,
  `gen-cave.yaml:49`, `game-mon-ranged.yaml:31`). `hard_centre_gen` is PORTED
  (`hardCentreGen`, `gen/cave.ts:1914`); only `arena_gen` remains.
- **The quest system** (`gen/cave.ts:2833`, `gen/generate.ts:11`).
- **Persistent levels and the town builder's full store generation**
  (`gen/cave.ts:30`).
- ~~`room_of_chambers` needs a caller~~ - CLOSED. The builder works
  (`gen.test.ts:2175` builds it, asserts true, and checks the chambers are
  connected and themed) AND `spreadMonsters`, whose note claimed no builder
  reached it, is called twice: `gen/cave.ts:1721` and `:1865`.

### History, notes and files

- **`history_find_artifact` / `history_lose_artifact`** ARE wired
  (`game/context.ts:687`, `:695`, installed by `wireGame`) - only the store
  PURCHASE site is missing (`store/transact.ts:26`); find-on-sight entries are blocked on remembered
  floor-pile contents (`:75`); there is **no player notes command** (`:91`).
- **`randart.log` / `randart.txt`** (`obj/randart.ts:38`). Upstream's `do_randart`
  writes it whenever randarts generate and `exit(1)`s if it cannot open it: 193
  `file_putf` sites. The largest single item here, and a debug log no player
  reads.
- **`options_save_custom` / `restore_custom` / `restore_maintainer`**
  (`options.yaml:76`) — per-user customised defaults in `ANGBAND_DIR_USER`. Now
  buildable: the host seam and the pref-file writer both exist.
- **`RANDNAME_TOLKIEN`** is not loaded (`obj-randart.yaml:51`), so randart names
  come from the port's own generator.
- The **spoiler files' missing lines** (`game/spoil.ts:93`, `:518`, `:519`,
  `:550`) and **`randart-build.ts:38`**'s timed-effects failure tables.

### Wizard mode: nothing owed. This section was wrong.

Every row here has been re-adjudicated to `ported`. **Wizard mode is built**:
`runPlayItem` with upstream's full `A/K/S/R/T/C/Q` submenu
(`web/src/wizard.ts:1894-1923`), `runChangeQuantity`, `runTweakItem` /
`runRerollItem` / `runCurseItem`, `runWriteMap` over `game/dump-level.ts`,
`runCollectObjMonStats` / `runCollectPitStats` / `runCollectDisconnectStats`,
`runStatItem` over `wizStatItem`, `runSpoilers` over the four `spoil*`
generators (`game/spoil.ts:255`, `:344`, `:453`, `:505`), and `ArtifactState`
(`obj/make.ts:736`) as `aup_info[]`, serialized in the save.

**Why this document said otherwise.** The verdicts rested on greps for a
camelCase transliteration of the C name — `changeItemQuantity`, `playItem` —
which the port never uses. A failed transliteration grep is not evidence of
absence, and four of the eight verdicts of that shape were wrong.
`parity/tools/deferral-crosscheck.mjs` now greps the port for the **C name**,
which this codebase reliably cites beside its port, and its output is a list of
leads for a reader rather than a verdict.

The one thing that looked like a wizard gap and is real is the **ENTER command
browser** (`web/wizard.ts:498`, `textui_action_menu_choose`), absent for every
command list rather than for debug mode. `world-kernel.yaml:27` stays open as a
decision.

### Dead, and a decision rather than a task

- **`project-path.yaml:58`**: a ported function whose only caller would be an
  absent UI branch. Wire it or cordon it — leaving it is the
  shipped-is-not-reachable trap.

## Judged unnecessary, with the mechanism

81 rows. These are not gaps, and each names *why* rather than asserting it.

- **The `PU_*` / `PR_*` dirty-flag pipeline does not exist and cannot** (50 rows
  of the `n-a` set are this or a layer boundary). The front end recomputes and
  repaints everything after every state-changing action, so there is no flag for
  a core write to set. `game/known.ts:153` states it at the site.
- **`obj->known` is synthesised, not stored** (31 `divergence` rows). Upstream
  gives every object a stripped twin; the port derives an equivalent shadow on
  demand from the player's cumulative rune knowledge
  (`obj/known-object.ts objectKnownShadow`) and `desc.ts` reads the shadow
  exactly where upstream reads the twin. `known-object.ts` carries the
  equivalence argument field by field.
- **`Rand_init`'s time/pid seeding** is deliberately replaced: the port seeds at
  the host and stores the seed in the save, which is what makes a run
  reproducible.
- **Upstream's `look` is a UI function with `CMD_NULL`** (`ui-knowledge.c:4169`),
  and **4.2.6 has no search command at all** — no `do_cmd_search`, no
  `CMD_SEARCH`. Those two of the twenty stub codes are correctly never replaced.
- **`monster_index_move`** exists only to serve `arena_gen`'s `memcpy`;
  **`expression_free`** is garbage collected; **`old_class.txt`** is retired data
  the 4.2.6 game does not load; **`pricing.log`** is behind a `PRICE_DEBUG` that
  upstream defines nowhere.
- **The panic save has no counterpart**, because the port autosaves
  continuously: there is no second artifact and no window in which one could be
  newer. Recorded on the CLI text census's `"A panic save exists.  Use it? "`.

## How to keep this honest

- `deferral-census.mjs` merges verdicts forward by (file, collapsed line text)
  and **names every verdict it drops**, because a dropped adjudication is
  normally good news (the note was rewritten) and must still be visible.
- `deferral-triage.mjs` writes a `hint`, never a verdict, and counts references
  so a symbol that is declared and never called reads as `dead-candidate` rather
  than as evidence of a port.
- `deferral-verdict.mjs` exits non-zero naming any reference that matched no row.
- The appendix below is generated. `deferral-report.test.ts` fails when it is
  stale, so this document cannot drift from the census. It also fails on a new
  deferral note with no verdict, and on a verdict with no evidence.
- `ledger-deferred-items.mjs` is deliberately NOT under that ratchet yet: 331
  items are unadjudicated, and a test asserting zero would just be turned off.
  Adjudicate them and then bring it under the same guard.
- `port-todo.test.ts` holds [PORT_TODO.md](PORT_TODO.md) to the same census:
  every file with an owed row must be cited by a work item, the stated totals
  must match, and a cited path must exist. It is keyed on **file**, not
  `file:line`, on purpose — a line-keyed guard fails on every unrelated edit
  above a citation, and a churning test gets turned off.
- **The hand-written `file:line` numbers in the prose above are the one part of
  this document that drifts, and they already have once**: rewriting the notes
  moved ten of them by a line or two, and nothing caught it until the two
  documents were diffed against the census by hand. Prefer the generated
  appendix and PORT_TODO.md's `Sites:` lines, which come from the TSV. When the
  prose and the appendix disagree, the appendix is right.

<!-- BEGIN GENERATED: deferral-report.mjs -->

## Appendix: every row, with its verdict

Generated from `parity/reports/deferral-census.tsv` (232 rows).

| verdict | meaning | rows |
| --- | --- | --- |
| `partial` | Part ported; the note must say which part is not | 7 |
| `divergence` | Deliberately different, with the mechanism named | 32 |
| `n-a` | Not applicable to this port, with the mechanism named | 53 |
| `ported` | Done; the note was stale and has been rewritten | 27 |
| `stale-doc` | The note described a state of the code that no longer holds | 5 |
| `note-is-fix` | The wording sits inside a record of a FIX, not a gap | 79 |
| `not-a-deferral` | Ordinary English, not a parity claim | 29 |
| | **total** | **232** |

### `partial` - Part ported; the note must say which part is not (7)

- `packages/core/src/game/context.ts:1292` - delete_monster_idx's group removal, mimicked-object deletion, square clear and slot free are all here; the caller runs monster_death for drops beforehand, so only the redraw bookkeeping (the ratified repaint divergence) is outstanding
- `packages/core/src/game/ui-entry.ts:26` - The gameplay half of player_flags_timed IS ported - calcs.ts:1094-1104 folds each active timed effect's oflagDup into state.flags. What is missing is ui-entry.c:928's separate timed cache, which lets the sheet mark a flag as temporary
- `packages/core/src/store/transact.ts:26` - Of the four named: the known twin is a divergence and total_weight IS maintained (gear.ts:1283, shown as Burden at char-sheet.ts:409). Autoinscription (the registry exists at game/context.ts:254) and history_find/lose_artifact are genuinely absent here
- `parity/ledger/game-mon-ranged.yaml:31` - The glyph-of-warding exclusion is available (TRF.GLYPH is handled at monster-turn.ts:1536); the arena exclusion goes with arena mode
- `parity/ledger/gen-framework.yaml:57` - Pit/nest theming IS ported (buildPit/buildNest call setPitType then table.prep(monPitHook)), which is what this row records; the escort-base note it preserves is the part still outstanding
- `parity/ledger/project-path.yaml:83` - The targeting display is ported (game/target-loop.ts) and draw_path now reads memory rather than the live chunk, which is what this row records; it names the object half (square_object(player->cave, ...)) as still approximate, and that is the outstanding part
- `parity/ledger/world-kernel.yaml:36` - The row's own headline records a fixed live defect (monster light defaulted to [] so 107 races lit nothing). What it still defers splits three ways: the square predicates needing knowledge ride the C1 twin (#126), the render-layer items (grid_data / map_info, feeling display) are the ratified repaint divergence, and square_set_feat's in-game side effects are the part genuinely outstanding

### `divergence` - Deliberately different, with the mechanism named (32)

- `packages/core/src/game/curse-tick.ts:98` - known-twin write; obj/known-object.ts synthesises the shadow on demand, so the object-info display reads the same value
- `packages/core/src/game/gear.ts:205` - Same: the known twin is synthesised, not stored (obj/known-object.ts objectKnownShadow)
- `packages/core/src/game/gear.ts:398` - The note already contains its own answer - objKnown.toA is 1 from birth, so the shadow at known-object.ts:446 yields the real toA and the twin write has no observable consumer
- `packages/core/src/game/gear.ts:444` - Same write, same reason (known-object.ts:446)
- `packages/core/src/game/gear.ts:1095` - objectSimilar's equipped test: isEquipped is ported; the OSTACK_LIST knowledge checks read the synthesised shadow
- `packages/core/src/game/gear.ts:1181` - The obj->known twin, ratified as DIVERGENCES.md C1 - synthesised on demand by objectKnownShadow rather than stored. Scheduled for replacement by the persistent twin under work item #126, at which point this becomes ported
- `packages/core/src/game/gear.ts:1250` - pval bonuses are live; equip_cnt is upstream's equipment-count UI counter, which the port's character sheet derives directly from player.equipment
- `packages/core/src/game/known.ts:126` - Same C1 divergence, remembered-pile half: an entry points at the original object so it reports the original's properties, which is what a stored obj->known would carry. Scheduled under #126
- `packages/core/src/game/known.ts:1046` - Known twin synthesised on demand (obj/known-object.ts)
- `packages/core/src/game/known.ts:1074` - Known twin synthesised on demand; monsterCarry itself is ported and called two lines below (known.ts:854)
- `packages/core/src/game/mon-place.ts:279` - LEAD READ. Re-adjudicated from real. list_object/delist_object is oidx bookkeeping for upstream's cave->objects[] registry, and the port replaced that registry rather than omitting it: state.floor is a pile map keyed by grid, and the mon<->obj mimicry link is obj.mimickingMIdx === mon.midx, which become_aware reads and the save persists. Nothing observable depends on an oidx. Ratified in game/floor.ts:19-21
- `packages/core/src/game/mon-place.ts:340` - LEAD READ. Same ratified substitution as mon-place.ts:267 - the pile map IS the object list
- `packages/core/src/game/monster-turn.ts:1361` - The player-cave placeholder copy rides the knowledge subsystem, which the port models as synthesised knowledge rather than a second grid array
- `packages/core/src/game/shape-inspect.ts:108` - Class spell effects are held as raw pack records (ClassSpell.effectsRaw, player/types.ts:151) rather than compiled into an Effect chain at parse time; game/spell-cmd.ts casts and aims off the same records. A representation difference, not a missing feature
- `packages/core/src/gen/generate.ts:11` - The known-level ("player cave") duplicate, ratified at game/known.ts:153 - the same decision as the per-object twin, applied to terrain. Related to work item #126
- `packages/core/src/obj/bind.ts:1361` - The known-object side is synthesised on demand (obj/known-object.ts) rather than bound as a second object
- `packages/core/src/obj/desc.ts:15` - The header's inline DEFERRED notes are all known-twin reads, which desc.ts now takes from objectKnownShadow
- `packages/core/src/obj/knowledge.ts:22` - Per-object twin replaced by on-demand synthesis (obj/known-object.ts objectKnownShadow)
- `packages/core/src/obj/knowledge.ts:786` - A known-twin display marking, subsumed by the shadow
- `packages/core/src/obj/knowledge.ts:805` - Same
- `packages/core/src/obj/knowledge.ts:1302` - Same
- `packages/core/src/obj/known-object.ts:9` - This module IS the divergence: the twin is synthesised on demand and desc.ts reads the shadow wherever upstream reads obj->known
- `packages/core/src/obj/object.ts:7` - Header points at obj-model.yaml; the model's absent twin is the synthesised shadow
- `packages/core/src/obj/object.ts:290` - Known-twin field
- `packages/core/src/obj/object.ts:388` - The explicit statement of the divergence: no persistent twin, synthesis instead (obj/known-object.ts)
- `packages/core/src/obj/object.ts:988` - object_similar's two object_is_equipped guards (obj-pile.c:400-403) read the global player->body. The port's Gear keeps pack, quiver and equipment as separate lists, so no caller can reach the guard: combinePack walks gear.pack only, and gear.ts:614/696 and pickup.ts:164 are pack/quiver/floor. Upstream's own combine_pack walks player->upkeep->inven, where the guard is likewise belt-and-braces
- `packages/core/src/obj/object.ts:1250` - Knowledge system read, answered by the shadow
- `packages/core/src/store/store.ts:391` - The obj->known pile is synthesised on demand (obj/known-object.ts)
- `parity/ledger/game-gear.yaml:73` - The known twin is synthesised on demand; the line's own "NOT deferred" clause lists what is live
- `parity/ledger/rng.yaml:40` - Rand_init's time/pid seeding is deliberately replaced: the port seeds from crypto/Math.random at the host and stores the seed in the save, which is what makes a run reproducible
- `parity/ledger/ui-entry.yaml:107` - Synthesised on demand (obj/known-object.ts)
- `parity/ledger/ui-entry.yaml:114` - The port folds merged curse data into the object's own flags, which the note states is equivalent

### `n-a` - Not applicable to this port, with the mechanism named (53)

- `packages/core/src/game/cave-square.ts:58` - Adjacent-decoy destruction on floors; no RNG, and the decoy itself is modelled
- `packages/core/src/game/cave-square.ts:68` - Same adjacent-decoy note, no RNG
- `packages/core/src/game/effect-general.ts:587` - The drain-mana update_smart_learn note from #125, re-matched on a different line of the same comment after that pass rewrote it. Same adjudication: upstream's call (effect-handler-general.c:992) returns at mon-util.c:794 before reaching its own body, so known_pstate.pflags is never written in any game of Angband and there is nothing to port.
- `packages/core/src/game/known.ts:250` - The note names its own mechanism: the front end runs updateView + noteSpots after every state-changing action, so there is no dirty-flag pipeline for a PU_/PR_ bit to set
- `packages/core/src/game/loop.ts:339` - A message on a seen trap re-arming; the port has no PR_ dirty-flag pipeline and the front end repaints unconditionally
- `packages/core/src/game/mon-death.ts:342` - PR_MONLIST is a redraw bit with no port equivalent (the front end repaints unconditionally); the note itself records quest_check as wired
- `packages/core/src/game/monster-turn.ts:1303` - Presentation only, no RNG; the port routes messages through the shell sink
- `packages/core/src/game/monster-turn.ts:1677` - Lore note on OF_AGGRAVATE, no RNG; monster lore is otherwise wired
- `packages/core/src/game/monster-turn.ts:1710` - Message plumbing and lore; the messages route through the shell sink
- `packages/core/src/game/player-path.ts:95` - Sound and redraw halves; no RNG, and the port has no PR_ pipeline
- `packages/core/src/game/player-turn.ts:825` - Two of the 20 are correctly never replaced: upstream's "look" is a UI function with CMD_NULL (ui-knowledge.c:4169, bound by the shell to l/x at web main.ts:8039), and 4.2.6 has no search command at all - no do_cmd_search, no CMD_SEARCH
- `packages/core/src/game/project-cast.ts:10` - Layer boundary with live suppliers: session/game.ts:1223 supplies the monster hooks and :1289 the player hooks, so the "deferred consequences" all run in play
- `packages/core/src/game/project-cast.ts:31` - basicPlayerActor is the worldless view; the live path supplies the real actor (session/game.ts:1289)
- `packages/core/src/game/project-cast.ts:141` - CastHooks is the seam, supplied at session/game.ts:1223/:1289
- `packages/core/src/game/project-cast.ts:143` - ProjectMonsterHooks supplied at session/game.ts:1223
- `packages/core/src/game/project-cast.ts:145` - ProjectPlayerHooks supplied at session/game.ts:1289, onSideEffects via makePlayerSideEffects (game/player-side.ts:139)
- `packages/core/src/game/project-monster.ts:48` - The seam's suppliers are live (session/game.ts:1223)
- `packages/core/src/game/project-player.ts:16` - Same seam discipline; supplied at session/game.ts:1289. The killer-name half is tracked separately as the MDESC_DIED_FROM gap
- `packages/core/src/game/project-player.ts:93` - Supplied at session/game.ts:1289
- `packages/core/src/game/spoil.ts:379` - seed_randart only matters under birth_randarts and this is a dev tool; the note states the condition
- `packages/core/src/mon/project-mon.ts:45` - The seam's suppliers are live (session/game.ts:1223)
- `packages/core/src/mon/take-hit.ts:24` - The PR_HEALTH redraw, which is the ratified repaint divergence (DIVERGENCES.md B1): the renderer is immediate-mode and has no dirty-flag to raise. The state it gates, state.healthWho, IS tracked
- `packages/core/src/mon/timed.ts:223` - Health-bar / monster-list redraw; the front end repaints unconditionally
- `packages/core/src/obj/desc.ts:625` - is_unknown's placeholder path belongs to the object-list screen, which the web layer draws (game/obj-list.ts + web screens)
- `packages/core/src/obj/object.ts:1004` - The two OSTACK_LIST checks are unreachable in 4.2.6 - every OSTACK_* argument in the C tree is PACK, QUIVER, MONSTER, STORE or FLOOR, measured call site by call site - and obj/ostack-list.test.ts is the ratchet that reopens this if a caller ever appears
- `packages/core/src/obj/randart-log.ts:72` - object_value_real's pricing.log is guarded by #ifdef PRICE_DEBUG, which no shipped configuration defines, so its seven file_putf sites are dead in every build a player can obtain
- `packages/core/src/player/bind.ts:15` - Layer boundary: the raw effect chain is compiled by the effects domain, which is ported (effects/effect.ts) and wired at session boot
- `packages/core/src/player/birth.ts:395` - Kind-name refs are resolved by the session (outfitPlayer + tvalFindIdx at gear.ts:1300); the binding layer holding names is the design
- `packages/core/src/player/birth.ts:443` - Same: "deferred references" names the binding boundary
- `packages/core/src/player/birth.ts:446` - Same
- `packages/core/src/player/exp.ts:17` - PU_/PR_ update flags have no port equivalent; the front end repaints unconditionally
- `packages/core/src/player/types.ts:152` - Binding boundary: the raw record is compiled by the effects domain at boot
- `packages/core/src/player/types.ts:170` - Same binding boundary
- `packages/core/src/player/types.ts:203` - Same, handed to the obj domain
- `packages/core/src/player/types.ts:205` - Same
- `packages/core/src/player/types.ts:224` - Same: tval/sval names resolved by the obj domain
- `packages/core/src/world/chunk.ts:10` - square_light_spot is a lighting refresh with no port equivalent; the front end recomputes and repaints every frame
- `packages/web/src/mapview.ts:71` - The rounding branches are dead code upstream; not porting dead code is the documented policy
- `parity/ledger/bitflag.yaml:54` - flag_has_dbg / flag_on_dbg are the C's debug-build assert wrappers around flag_has / flag_on. TypeScript's FlagSet asserts unconditionally (assertValidFlag), so the debug twin has nothing to add. Ratified N/A, not deferred.
- `parity/ledger/dice.yaml:38` - dice_free is manual deallocation. Nothing to port to a garbage-collected runtime. Ratified N/A, not deferred.
- `parity/ledger/effects-interpreter.yaml:138` - recharge_failure_chance IS in the obj domain, which is where the note says it belongs; the rest of the line is about GC and serialisation
- `parity/ledger/expression.yaml:31` - expression_free is garbage collected and the strtol saturation is documented in the helper; neither is reachable behaviour
- `parity/ledger/game-arena.yaml:16` - monster_index_move exists only to serve arena_gen's memcpy; the port's arena builder reads state.healthWho instead
- `parity/ledger/game-effect-detect.yaml:48` - What remains after the closures this row records is the DTRAP border and the item/monster list redraws, both the ratified repaint divergence. The row's third clause is FALSE: there are no detection sounds to defer - effect_handler_DETECT_* (effect-handler-general.c:1321-1874) uses msg() and never sound()
- `parity/ledger/game-effect-detect.yaml:58` - The monster recall WINDOW refresh (PR_MONSTER) is the ratified repaint divergence; an immediate-mode renderer has no window to invalidate
- `parity/ledger/game-effect-general.yaml:97` - The call this row owes is a NO-OP UPSTREAM. effect-handler-general.c:992 is update_smart_learn(mon, player, 0, PF_NO_MANA, -1), and mon-util.c:794 returns immediately when flag is 0 and the element is out of range - which is exactly that argument list. It is the ONLY one of the nine call sites in 4.2.6 that passes a pflag, so the pflag branch at mon-util.c:822-829 is unreachable and known_pstate.pflags is never written. Porting the call would reproduce a dead branch; the omission is behaviourally identical
- `parity/ledger/game-gear.yaml:70` - Pack overflow at birth: a birth kit cannot overflow, and packOverflow itself is ported and called (obj-cmd.ts:276, session/game.ts:806)
- `parity/ledger/gamedata.yaml:502` - old_class.txt is retired data the 4.2.6 game does not load
- `parity/ledger/player-model.yaml:53` - Starting-inventory kind-name refs are resolved by the session; a binding boundary
- `parity/ledger/ui-display.yaml:155` - update_topbar / SIDEBAR_TOP, the prt_*_short handlers, hp_colour_change and every Term_* positioning call are the curses term's own layout machinery. The port draws the same values on a canvas grid (game/display.test.ts covers the value formatting); there is no subterm to position
- `parity/ledger/ui-player.yaml:68` - The resist/ability/sustain grid is ported, in the separate module the note points at (characterGrid, ui-entry.ts:1863, drawn by web charsheet.ts:270)
- `parity/ledger/wizard-debug.yaml:163` - The action is reachable by another route already ported; upstream's separate entry point adds no behaviour
- `parity/ledger/wizard-debug.yaml:170` - Process lifetime belongs to the shell, which owns it in this port

### `ported` - Done; the note was stale and has been rewritten (27)

- `packages/core/src/game/cave-cmd.ts:36` - STALE. do_cmd_steal is game/steal.ts (installSteal registers "steal"), reachable on s / roguelike s via web/src/main.ts:4515 stealCmd. Grepping do_cmd_steal's port name, not the C name, is what showed it.
- `packages/core/src/game/wizard.ts:68` - CORRECTED from real. The wiz-spoil.c generators ARE ported - spoilObjDesc / spoilArtifact / spoilMonDesc / spoilMonInfo (game/spoil.ts:255, :344, :453, :505) - and reachable through runSpoilers (web/src/wizard.ts:373, case "spoilers" at :874), which writes the file through the host seam. The remaining spoiler gaps are content lines, tracked at spoil.ts:93 / :518 / :519 / :550
- `packages/core/src/gen/gen-monster.ts:350` - LEAD READ, and CORRECTED from real. The note says spreadMonsters is "not wired to a builder yet (room_of_chambers/cavern callers are deferred)". It is wired, twice: gen/cave.ts:1721 (the lair, after setPitType/monRestrict) and gen/cave.ts:1865. room_of_chambers is built too, and its builder asserts true in gen/gen.test.ts:2175
- `packages/core/src/mon/lore-describe.ts:862` - LEAD READ, and CORRECTED from real. Both halves the note calls unavailable exist and are wired: chanceOfMeleeHitBase (combat/melee.ts:242) and hitChance (combat/hit.ts:60), joined at web/src/main.ts:3650 as meleeHitPercent: (race) => getHitChance(chanceOfMeleeHitBase(state.actor.combat, state.actor.weapon), race.ac). web/src/screens.test.ts:929 asserts the real percentage reaches the recall screen. The seam default of 0 survives only for callers with no player - the core spoiler dump, tracked at game/spoil.ts:518
- `packages/core/src/mon/lore-describe.ts:1315` - LEAD READ, and CORRECTED from real. Same: monsterHitPercent is wired at web/src/main.ts:3652 as getHitChance(max(race.level,1)*3 + effect.power, defense.ac + defense.toA), which is chance_of_monster_hit_base (combat/mon-melee.ts:191) against the player's live defensive state
- `packages/core/src/obj/knowledge.ts:1423` - STALE. PN_IGNORE is consumed: game/notice.ts:37-38 tests the bit, clears it and runs the ignore-drop pass, and session/game.ts:581 raises it. PORT_TODO 1.1 built the notice pipeline after this verdict was recorded and never touched this note
- `packages/core/src/obj/object.ts:998` - STALE. object_is_equipped is ported (isEquipped, 15 non-comment sites) and there IS player gear.
- `packages/web/src/main.ts:5818` - CORRECTED from real. show_floor for multiple objects IS ported: showFloorList (web/src/overlay.ts:301), an overlay over screen_save, called at main.ts:5967
- `packages/web/src/main.ts:5839` - CORRECTED from real. Same: showFloorList exists and is called. My "0 showFloor sites" was a transliteration grep
- `parity/ledger/game-obj-list.yaml:45` - CORRECTED from real. object_list_format_name IS ported: objectListEntryName (game/obj-list.ts:289) passes the summed stack count through ODESC.ALTNUM exactly as upstream and gates the name by knowledge via describeObject. Only the terminal "%3.3s" padding of the upstream DRAW code stays with the shell, which is front-end-agnostic
- `parity/ledger/game-project-cast.yaml:53` - STALE. BOTH branches of effect_handler_TOUCH are ported at game/effect-attack.ts handleTOUCH: the decoy arm at :433-443 (caveFindDecoy, ball sourced at the decoy) and the target-monster arm at :445 (monsterTargetMonster, ball sourced at mon->target.midx). game/project-cast.ts:705 says so too - the branches belong one level up, not here
- `parity/ledger/high-scores.yaml:96` - STALE. The killer IS wired: monsterDesc(mon, MDESC_DIED_FROM) feeds it at game/effect-attack.ts:694 and game/project-cast.ts:136, project_p's takeHit hooks record it (session/game.ts:1394-1404), player.diedFrom round-trips through the save, and both the tombstone and the score entry read it (web/src/main.ts:4900 scoreBuildDeps, web/src/charsheet.ts:482)
- `parity/ledger/player-history.yaml:46` - STALE on its own premise. dump_history is in the character dump (web/src/charsheet.ts:504 calls historyLines under the "[Player history]" header), and character-dump-to-file exists - dumpCharacterFile, now through the host seam.
- `parity/ledger/player-history.yaml:79` - CORRECTED from real. Both hooks ARE wired: onArtifactFound (game/context.ts:687-693, installed by wireGame, called from pickup.ts playerPickupAux) and onArtifactLost (:695-701, the destroy / abandon / store-discard paths). The store-PURCHASE site is the part still missing, tracked at store/transact.ts:26
- `parity/ledger/player-history.yaml:91` - STALE. do_cmd_note (cmd-misc.c:88) is web/src/main.ts:4435-4467, bound to ':' and calling historyAdd with HIST.USER_INPUT, with web/src/rest-steal-note.test.ts:60 covering it
- `parity/ledger/store-price.yaml:21` - CORRECTED from real. store_init's runtime owner selection IS ported: storeChooseOwner (store/store.ts:100, rng.randint0 over store.owners) called at :116, :120 and :700. My "0 storeInit sites" was a transliteration grep
- `parity/ledger/ui-entry.yaml:138` - CORRECTED from real, same bullet as ledger row :135. The EQUIPCMP_SCREEN category IS iterated: equipCmpCategories (game/ui-entry.ts:1965) is called by equipCmpSummary (game/equip-cmp.ts:391), one column per entry across all five categories plus a combined row of matching length (game/equip-cmp.test.ts:116). show_combined = false on CHAR_SCREEN1 is upstream's own character-screen behaviour
- `parity/ledger/wizard-debug.yaml:14` - CORRECTED from real. The artifact-created registry EXISTS: ArtifactState (obj/make.ts:736) is aup_info[] with isCreated / mark, one instance per game, serialized as artifactsCreated (session/save.ts:976, :1200, :1346)
- `parity/ledger/wizard-debug.yaml:87` - CORRECTED from real. The shell follow-up exists: runTweakItem (web/src/wizard.ts:2043), reached from the play-item T branch at :1914, alongside runRerollItem and runCurseItem
- `parity/ledger/wizard-debug.yaml:112` - CORRECTED from real. dump_level IS ported: game/dump-level.ts with its own test (dump-level.test.ts), driven by runWriteMap (web/src/wizard.ts, case "write-map" at :878)
- `parity/ledger/wizard-debug.yaml:139` - CORRECTED from real. The wiz-spoil.c generators ARE ported (game/spoil.ts:255, :344, :453, :505) and wired through runSpoilers (web/src/wizard.ts:373). "Deferred entirely" has not been true for some time
- `parity/ledger/wizard-debug.yaml:144` - CORRECTED from real. The three Monte-Carlo collectors ARE ported and wired: runCollectObjMonStats / runCollectPitStats / runCollectDisconnectStats (web/src/wizard.ts, cases at :883, :886, :889)
- `parity/ledger/wizard-debug.yaml:147` - CORRECTED from real. The wiz-stats sampler IS ported: wizStatItem (game/wizard.ts) driven by runStatItem (web/src/wizard.ts)
- `parity/ledger/wizard-debug.yaml:154` - CORRECTED from real. Same as :164 - runChangeQuantity (web/src/wizard.ts) is reached from the play-item Q branch at :1921
- `parity/ledger/wizard-debug.yaml:164` - CORRECTED from real. do_cmd_wiz_change_item_quantity IS ported: runChangeQuantity (web/src/wizard.ts), reached from the play-item submenu's Q/q branch (wizard.ts:1921). My "0 changeItemQuantity sites" was a grep for a camelCase name the port never uses
- `parity/ledger/wizard-debug.yaml:166` - CORRECTED from real. The play_item shell IS ported: runPlayItem (web/src/wizard.ts), case "play-item" at :779, with upstream's full A/K/S/R/T/C/Q submenu at :1894-1923 and the core-side session snapshot/restore/commit (wizPlayItemBegin / Reject / Accept, game/wizard.ts:61-63)
- `parity/ledger/wizard-debug.yaml:167` - CORRECTED from real. Same: the play_item shell exists, so the quantity action does have somewhere to live

### `stale-doc` - The note described a state of the code that no longer holds (5)

- `packages/core/src/mon/lore-describe.ts:22` - LEAD READ. "The two hit-chance callbacks are the remaining integration seams for the combat layer (still default to 0 unwired)" is no longer true: web/src/main.ts:3650 and :3652 wire both, and web/src/screens.test.ts:929 asserts the real melee percentage reaches the recall screen. breathProjection is wired at main.ts:3659 too
- `packages/core/src/mon/lore-describe.ts:148` - The interface comment marks meleeHitPercent DEFERRED. It is not: web/src/main.ts:3650 supplies getHitChance(chanceOfMeleeHitBase(state.actor.combat, state.actor.weapon), race.ac). The 0 default survives only for callers with no player, which is the core spoiler dump (game/spoil.ts:518)
- `packages/core/src/mon/lore-describe.ts:154` - Same: monsterHitPercent is supplied at web/src/main.ts:3652 from chance_of_monster_hit_base against the player's live defence
- `packages/core/src/mon/lore-describe.ts:170` - breathProjection is supplied: web/src/main.ts:3659, (subtype) => projections?.[subtype]. Breath damage no longer shows as 0 in play
- `parity/ledger/mon-make.yaml:32` - EVERY ITEM IN THIS DEFERRED LIST IS PORTED. update_mon is game/known.ts:895; mon_create_drop and mon_create_drop_count are game/mon-death.ts; mimicked-object creation is game/mon-place.ts:335; summon placement is summonSpecific (mon-place.ts) driven by game/effect-summon.ts:83,105; compaction is compactMonsters (game/loop.ts:372,376) with monsterIndexMove at game/world.ts:660. The list describes the week it was written

### `note-is-fix` - The wording sits inside a record of a FIX, not a gap (79)

- `packages/core/src/combat/mon-melee.ts:29` - The rewritten header: it records that all four formerly-listed items are ported and names the one that is not (mon/steal.ts:234)
- `packages/core/src/effects/handlers.ts:82` - Records that the "deferred (8.9)" note outlived its wiring: this worldless layer has no monster registry, and the GAME override names the killer through monsterDesc(MDESC_DIED_FROM) at game/effect-attack.ts and game/project-cast.ts
- `packages/core/src/game/cave-cmd.ts:23` - The sentence records that player_best_digger IS now ported; "was deferred" is history, not a deferral.
- `packages/core/src/game/cave-cmd.ts:33` - Records that count_feats is NOW PORTED and that deferring it had been wrong; easy_open does not exist in 4.2.6.
- `packages/core/src/game/context.ts:312` - Records the REMOVAL of a stand-in (noticeIgnore) that nothing read. PlayerUpkeep.notice is the real mask now, raised where upstream raises it and drained by game/notice.ts (PORT_TODO 2.5)
- `packages/core/src/game/context.ts:492` - Records why tempBrandSlay is a required peer rather than an optional seam - the note it replaces (PORT_TODO 3.20) had claimed a predicate was missing that existed
- `packages/core/src/game/context.ts:908` - "exactly as when it was deferred" records that the curse tick is now installed by the session
- `packages/core/src/game/context.ts:1209` - Records the DELETION of a wrong predicate. squareIsEmpty was not square_isempty; the faithful port squareIsEmptyLive in game/mon-place.ts is now the only one
- `packages/core/src/game/effect-general.ts:295` - Records that the gear_to_label letter IS printed: GEAR_LABELS is indexed by body slot exactly as known.ts:775 does, and the row that called it a display concern was wrong
- `packages/core/src/game/effect-general.ts:546` - Records that the monster-vs-monster disenchant branch is ported and ordered first, and that "rides monster-spell targeting (#19)" stopped being true when monsterTargetMonster landed
- `packages/core/src/game/effect-teleport.ts:33` - Records two closures: the three teleport sounds (PORT_TODO 3.26) and the MON_MSG_BRIEF_PUZZLE queue entry (PORT_TODO 3.1)
- `packages/core/src/game/effect-teleport.ts:39` - The sentence says teleportMonster IS the backing that project-monster deferred - a record of the wiring, not a gap
- `packages/core/src/game/effect-terrain.ts:253` - Records a fixed crash (arena entry, out-of-bounds) and states that deferring to the caller's refresh is what upstream's flag does
- `packages/core/src/game/mon-group.ts:28` - The sentence records a CORRECTION to an earlier wrong claim about monster_can_see, not a deferral
- `packages/core/src/game/monster-turn.ts:24` - "NOW WIRED (was deferred)" is a record of the fix
- `packages/core/src/game/monster-turn.ts:1387` - Records that the "rune of protection is broken!" message IS printed below, and that the line calling it deferred sat beside the code doing it
- `packages/core/src/game/monster-turn.ts:1411` - Records that item pickup, group behaviour and lore are all ported (PORT_TODO 7.2) and that two of the three were already ported when the note was written
- `packages/core/src/game/monster-turn.ts:1525` - Records a fixed live defect: destroyDecoy had printed the message for its five other callers all along, and this site - the commonest way a decoy dies - was one of the two that went around the function
- `packages/core/src/game/obj-cmd.ts:1762` - Records that the port routes this through combine_pack, which is what happens - a design record, not a gap
- `packages/core/src/game/player-path.ts:28` - "are wired (W2-003 navigate-up/down, explore, pathfind)" records the fix
- `packages/core/src/game/project-cast.ts:705` - Records that the decoy / target-monster branches are ported one level up in game/effect-attack.ts handleTOUCH, and that the stale note manufactured PORT_TODO 2.13
- `packages/core/src/game/ranged-cmd.ts:24` - The sentence explicitly says the item "had been listed here as deferred, which is" wrong - a correction
- `packages/core/src/game/take-hit-hooks.ts:23` - Records that the port deliberately mirrors upstream's close_game ordering, and names where it happens
- `packages/core/src/game/ui-entry.ts:1408` - Records that PORT_TODO 3.8's stated cause was wrong - player_flags_timed is ported at player/calcs.ts:1097 - and that the DEFERRED comment on the seams had outlived it
- `packages/core/src/game/ui-entry.ts:1411` - Same fix record, temp_resist half: TimedEffect.tempResist exists at player/types.ts:341, so PORT_TODO 3.7's stated cause was also wrong
- `packages/core/src/gen/cave.ts:32` - Records that neither thing this header called deferred still is: the town builder places all eight stores and the persistent-level connectors are live end to end (PORT_TODO 4.3)
- `packages/core/src/gen/generate.ts:15` - Records that arena levels (PORT_TODO 4.1) and quest levels (4.2) are both built and driven, and had been for some time
- `packages/core/src/gen/generate.ts:23` - Records that getJoinInfo, getMinLevelSize and collectJoins are all present and that session/changeLevel drives them (PORT_TODO 4.3)
- `packages/core/src/mon/lore-describe.ts:1375` - Records that the tile_width/tile_height gate is unconditionally true here (a ratified divergence at web/src/mapview.ts:70) and is omitted rather than deferred
- `packages/core/src/mon/steal.ts:35` - Records that react_to_slay on the monster-thief path IS ported (PORT_TODO 2.2) and that the reason originally given for skipping it was untrue when written
- `packages/core/src/mon/steal.ts:36` - The continuation of the same fix record - the precedent it cited ("the EAT_ITEM blow already defers it") was itself false
- `packages/core/src/obj/knowledge.ts:714` - Records that the shared launcher accessor closed two DEFERRED notes whose stated obstacle was three lines of body-slot walk (PORT_TODO 3.9)
- `packages/core/src/obj/make.ts:1235` - Explains why the current behaviour matches upstream at a site that was once a stub
- `packages/core/src/obj/make.ts:1240` - Records that book rejection is live and that the stale note is what manufactured PORT_TODO 2.15; the real defect was the wiring, and it is named
- `packages/core/src/obj/object-info.ts:270` - Records why the temp brand/slay dep is required rather than optional - an optional field would have reproduced the bug it fixes (PORT_TODO 3.20)
- `packages/core/src/session/game.ts:3128` - Records the single binding of tempBrandSlay that closed PORT_TODO 3.20; the melee hooks used to build a private copy nothing else could reach
- `packages/core/src/session/game.ts:3947` - The load path's copy of the same fix record
- `packages/core/src/store/store.ts:167` - This line IS the expansion the other notes call deferred
- `packages/core/src/store/transact.ts:13` - The header's LIVE list records that both sides of the rune learn loop are now wired, and says the DEFERRED label is what made the asymmetry read as intentional
- `packages/core/src/store/transact.ts:24` - The sentence records the fix and why the stale label was harmful
- `packages/web/src/main.ts:3749` - Records that all three greyed-browser claims were wrong: everseen is modelled and wired, and shapeLoreLines is a full port of shape_lore
- `packages/web/src/main.ts:8484` - Records why the first FOV after birth/load clears only_partial, and that it is thrown rather than skipped so a missing updateFov cannot hide behind a black screen
- `parity/ledger/combat-melee.yaml:91` - The comment recording that this list was adjudicated and that ten of its eleven entries had stopped being true
- `parity/ledger/game-arena.yaml:64` - Records that monster reproduction is ported and wired (multiplyMonster supplied at session/game.ts:1855) and that the row was wrong in both halves
- `parity/ledger/game-arena.yaml:71` - Records that ALTER_REALITY is ported and that its arena guard was simply missing rather than blocked - a live defect, now closed (PORT_TODO 4.1)
- `parity/ledger/game-arena.yaml:87` - Records that EVENT_GEN_LEVEL_START("arena") has nothing to defer: its only 4.2.6 subscriber is wiz-stats.c:2635, a debug statistics collector
- `parity/ledger/game-effect-melee.yaml:44` - "Every formerly-deferred handler is now DONE"
- `parity/ledger/game-effect-melee.yaml:52` - Records the closure of all four items (2026-08-07): message_pain with its show_damage branch, the mon_msg queue grammar, MSG_TELEPORT for the JUMP_AND_BITE jump
- `parity/ledger/game-effect-monster.yaml:44` - Records that the arena guards are present at both sites upstream has them (PORT_TODO 4.1)
- `parity/ledger/game-effect-monster.yaml:52` - Records a fixed live message defect: the heal handlers now call monsterDesc with MDESC_STANDARD and MDESC_PRO_VIS|MDESC_POSS as effect-handler-attack.c:268-271 does
- `parity/ledger/game-effect-teleport.yaml:37` - Records that teleportMonster is the backing for the hook
- `parity/ledger/game-effect-teleport.yaml:83` - Records that MSG_TELEPORT / MSG_TPOTHER / MSG_TPLEVEL now go through state.sound at every site upstream calls sound() (PORT_TODO 3.26)
- `parity/ledger/game-effect-terrain.yaml:53` - Records that squareMemorize, squareKnowPile and squareSensePile are all ported and called, and that square_light_spot falls under the ratified repaint divergence
- `parity/ledger/game-monster-ai.yaml:40` - "NOW WIRED (were deferred)"
- `parity/ledger/game-project-feat.yaml:45` - Records that exposeToSun is ported and that the reason for deferring it ("no town or day-night cycle yet") expired when PORT_TODO 4.3 built town generation
- `parity/ledger/game-trap.yaml:54` - Records that the trap hooks are supplied by the live session and that equip learning fires on both upstream paths (trap.c:515-518 and 534-539)
- `parity/ledger/game-trap.yaml:58` - A continuation line of the bullet above; the census matched the quoted fragment of the claim being corrected, not a claim of its own
- `parity/ledger/game-trap.yaml:61` - Records that no_light, the monster glyph and web interactions are ported, and that trap effect coverage is classified as a whole surface with a control proving the pass is not vacuous
- `parity/ledger/game-trap.yaml:70` - Records that the trapdoor persistent-levels check and the is_quest check beside it read the live option store; the row had named the option system as unbuilt
- `parity/ledger/gamedata.yaml:482` - Records that both halves of "front-end/UI concern, not part of the core rules pack" were wrong - the pack ships the file and core parses it
- `parity/ledger/gen-cave.yaml:48` - Records that every builder the list called missing is registered and selectable, and names arena_gen as the one genuine exception
- `parity/ledger/gen-framework.yaml:77` - Records that the three persistent-level connector functions are all present and that the one_off lists are an AVOID list, imposing no minimum
- `parity/ledger/mon-lore-describe.yaml:106` - Records that the tile-size gate is unconditionally true and omitted rather than faked, a ratified divergence at web/src/mapview.ts:70
- `parity/ledger/mon-make.yaml:42` - Records that LEVEL RATING was listed as deferred and is not - add_to_monster_rating is wired for generation and for live summons/breeders
- `parity/ledger/mon-take-hit.yaml:31` - Records that onKill is supplied by the live session and that player_kill_monster's consequences all run from there
- `parity/ledger/mon-take-hit.yaml:40` - Records that melee routes through monTakeHit at every site and that nothing applies damage inline any more
- `parity/ledger/obj-desc.yaml:44` - The sentence names objectKnownShadow as the replacement - the divergence, recorded
- `parity/ledger/obj-ignore.yaml:91` - Records that the port applies ignore settings immediately on read, so the flag is belt-and-braces; the ignore redraw is the ratified repaint divergence
- `parity/ledger/obj-knowledge.yaml:113` - Records the closure of every call-site family the row deferred, each named with its port location
- `parity/ledger/obj-randart.yaml:50` - Records that artifact_gen_name's word list IS ported (obj/randname.ts, checked against an independent oracle) and had been longer than the note claimed otherwise
- `parity/ledger/options.yaml:31` - Records that the options store replaced the scattered per-seam defaults
- `parity/ledger/options.yaml:74` - Records that options_save_custom / restore_custom / restore_maintainer landed as PORT_TODO 5.3, and that both halves of the reason for deferring them were wrong
- `parity/ledger/player-history.yaml:72` - Records that the earlier "find-on-sight" reading was a misreading of the C: object_touch is gated on loc_eq(grid, player->grid), so there is no on-sight discovery at a distance to reproduce
- `parity/ledger/project-path.yaml:78` - Records that square_isbelievedwall is ported and wired on both halves, and that every clause of the entry it replaces had stopped being true
- `parity/ledger/session-save.yaml:80` - Records that the web host keeps a character roster with per-character slots and migrates legacy single-slot saves; save slots are a host concern and the format carries them
- `parity/ledger/session-save.yaml:92` - Records that birth_levels_persist is honoured and SavedGame.levelCache serializes every StoredLevel (save.c:1001)
- `parity/ledger/store-bind.yaml:55` - Describes the bookseller's data shape, which the expansion at store.ts:173 consumes
- `parity/ledger/store-maint.yaml:37` - Records that both conjuncts of the buy check are ported and that the object_flag_is_known half landed with PORT_TODO 2.10
- `parity/ledger/ui-entry.yaml:133` - Records that PF_FAST_SHOT is live and that the launcher-slot reach the row called deferred already existed in player/calcs.ts

### `not-a-deferral` - Ordinary English, not a parity claim (29)

- `packages/core/src/game/cave-cmd.ts:954` - Describes the fallback when the traps module is absent, not a missing feature; trap.ts registers the real disarm and session/game.ts:1698 supplies trapDeps
- `packages/core/src/game/context.ts:349` - Prose about why the options store is optional, and it states the fallback is exact; no feature is claimed absent
- `packages/core/src/game/context.ts:820` - Policy prose about an optional seam, not a parity claim, and the policy is honoured: state.combinePack IS supplied by the live session at session/game.ts:899, so only a worldless harness leaves the bit owed
- `packages/core/src/game/gear.ts:1269` - A sentence ABOUT the census, not a parity claim: the docblock explains that the local is named newPile after upstream rather than "deferred", and in saying so it matched the census itself. Left as-is rather than reworded, because the clearer sentence is worth one classified row.
- `packages/core/src/game/notice.ts:16` - Ordinary English ("would defer it by a turn") in prose explaining why ignore must run before combine; no feature is claimed absent
- `packages/core/src/game/notice.ts:50` - Policy prose, and the policy is honoured: state.combinePack is supplied at session/game.ts:899, so leaving PN_COMBINE set describes only an unwired harness. notice.test.ts asserts both halves
- `packages/core/src/game/pickup.ts:16` - Describes the behaviour when the module is not installed; installPickup replaces the stub and is called in the live composition
- `packages/core/src/player/options.ts:28` - Describes how seams read the store, and states the fallback is exact
- `packages/core/src/session/game.ts:989` - A note about JavaScript declaration order, not a parity claim
- `packages/core/src/session/game.ts:3234` - A note about the mod event flood, not a parity claim
- `packages/web/src/charselect.ts:130` - Describes the shell's own command hook, not a parity claim
- `packages/web/src/main.ts:3648` - Records that a utility is deliberately unbound; nothing upstream is missing
- `packages/web/src/main.ts:8411` - A setTimeout, chosen because the fault surfaces inside core
- `packages/web/src/mod-browse.ts:1154` - A variable named `todo`
- `packages/web/src/mod-browse.ts:1156` - A variable named `todo`
- `packages/web/src/mod-code.ts:207` - "rather than deferring to it" is about which layer reports a mod error
- `packages/web/src/mod-taint.ts:64` - "must defer" is about deferring to a tick, not a parity claim
- `packages/web/src/mod-zip-source.ts:129` - A one-tick setTimeout around a Chrome focus/change ordering quirk
- `packages/web/src/pwa.ts:29` - The beforeinstallprompt event, which is literally called a deferred prompt
- `packages/web/src/pwa.ts:51` - Same event
- `packages/web/src/userdir.ts:222` - A one-tick setTimeout around the same Chrome quirk
- `packages/cli/src/host-node.ts:50` - Quotes init.c's own "ToDo" comment as evidence about upstream
- `packages/desktop/src/main.ts:1133` - A variable named `todo`
- `packages/desktop/src/main.ts:1135` - A comment about that variable
- `packages/desktop/src/main.ts:1142` - Same variable
- `packages/desktop/src/main.ts:1146` - Same variable
- `packages/desktop/src/main.ts:1191` - Same variable
- `packages/mod-sdk/src/sort.ts:216` - A mod-conflict reason string: one mod "defers to" another
- `parity/ledger/gamedata.yaml:5` - A structural comment about the document layout

<!-- END GENERATED -->
