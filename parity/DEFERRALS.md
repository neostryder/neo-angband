# What is not ported, and what was judged unnecessary

**Dated 2026-08-04, re-verified end to end 2026-08-14. Every deferral note in
this repository has a verdict.**

Two passes, both of which found the page overstating what was missing:

- **"Genuinely not ported" re-verified against the code 2026-08-09 (task #162):
  36 claims, 3 survived.** The rest had been closed and never struck through.
- **Those three re-verified 2026-08-14 (task #228), and none of them survived
  either.** One is `unreachable-in-upstream` — upstream makes no such call — and
  **two had been ported for some time**, each with a call site *and* a test, while
  this page went on listing them. [Genuinely not ported](#genuinely-not-ported) is
  now empty.
- **The appendix re-verified the same day (task #226), all 34 divergence and
  `partial` rows read individually.** Both `partial` rows closed — one `ported`,
  one `unreachable-in-upstream` — so **no row in the appendix is outstanding
  work**. 30 of the remaining 32 are deliberate divergences, 1 is `n-a`, 1 is
  `unreachable-in-upstream`. All 68 items in [PORT_TODO.md](PORT_TODO.md) were
  re-read in the same pass and all 68 held: 64 `ported`, 2 meta, 2
  `unreachable-in-upstream`.

**The direction of the error is worth naming, because it is the safe one and it
still cost a week.** Every correction from both passes moved a row from *owed* to
*finished*. Nothing was found hiding. What this page was bad at was noticing when
work landed — a verdict is dated evidence, and nothing here re-dates itself.

> **Owner ruling, 2026-08-09: a verdict is not a finish line.** "All 'deferrals'
> must be either marked as not part of the port or as ported. I don't want
> anything deferred." So the tallies in the appendix are bookkeeping, not
> progress: `n-a` and a deliberate `divergence` are finished states, and
> **everything else on this page is work**, including every line under
> [Genuinely not ported](#genuinely-not-ported) and every `partial`. The only
> acceptable reason for an absence is that it does not fit this platform or
> front end, with the mechanism named. When reporting status, lead with what a
> player would notice — never with the adjudication count.

> **Owner ruling, 2026-08-09 (later the same day): a THIRD finished state.**
> "I also think we can leave out orphaned code and data that will simply never
> be used." So an item is finished when it is **ported**, when it is a deliberate
> **divergence / n-a**, *or* when it is **unreachable in upstream's own C** —
> no path in 4.2.6 can execute it, so no player can observe its absence. This is
> the ruling on the long-open `OSTACK_LIST` question, answered **A**, and it
> generalises: duplicated C functions with no caller, dead generators, data
> records nothing reads.
>
> Two conditions, because this state is the easy one to abuse:
>
> 1. **Unreachability is evidence, not an impression.** Name the C `file:line`
>    and say what makes it unreachable — no caller, a constant-false guard, a
>    `#define` that is never set. "I could not find a caller" is a lead.
> 2. **It is unreachable in UPSTREAM, not merely unreached by the port.** The
>    port skipping a call site is a port defect wearing this state's clothes.
>
> The same ruling relaxed code parity to **gameplay parity** — refactors and a
> different RNG stream are allowed where play feels the same. See
> [docs/PARITY.md](../docs/PARITY.md#the-standard-is-gameplay-parity-not-code-parity-ruled-2026-08-09)
> for the standard and for the two seams a stream change is *not* free on. What
> did not change: the port adds no content and no features, ever.

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
and they have been rewritten.** The live census is 227 rows; five additional
stale-documentation records were retired to the census ledger with their original
verdicts and closure evidence, rather than silently disappearing.

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

**Re-verified line by line 2026-08-09 (task #162), and it was mostly wrong.** Of
the 36 claims this section carried, **three** survived reading the code. The
rest had been closed by tasks #114-#121, #131, #132 and the PORT_TODO waves and
never struck through here. A verdict is dated evidence; this section is what
that costs when the date passes.

Two rules for anyone editing below. **A comment saying "IS ported" is prose, not
behaviour** - every surviving claim cites a call site, and the closed ones cite a
call site or a test, because that is the difference between a lead and a verdict.
And **a failed grep for a camelCase transliteration is not evidence of absence**,
which is the mistake that produced half of this section's original contents; grep
the C name, which this codebase cites beside its port.

### Still owed (0) - re-verified 2026-08-14 (task #228)

All three survivors of the 2026-08-09 pass are closed, and **two of them had been
closed for some time without this page being struck through** - which is the same
failure the 2026-08-09 pass was written to correct, recurring inside the section
that recorded it. A verdict is dated evidence.

- **The store PURCHASE history entry** - **unreachable in upstream.** There is no
  purchase-side history call to port. `store.c` has exactly four history calls:
  `:1087` and `:1303` (`history_lose_artifact`, store turnover and the
  black-market purge), `:1924` (`history_find_artifact`, inside `do_cmd_sell`,
  which begins at `:1865`, under the comment *"Update the auto-history if selling
  an artifact that was previously un-IDed"*), and `:1988` (the store refusing what
  it just bought). **`do_cmd_buy` runs `store.c:1646-1774` and contains no history
  call of any name.** The earlier note named a call upstream does not make - the
  direction was backwards - and `store/transact.ts:26-39` now records the
  correction at the site. The sell pair is wired at `session/game.ts:3621-3622`
  and `:3666-3667`. This duplicated PORT_TODO 2.16, which had already closed it on
  the same evidence.
- **The player notes command** - **ported.** `do_cmd_note` (`cmd-misc.c:88`) is
  `noteCmd` at `web/src/main.ts:4615`, with the `"Note: "` prompt at `:4618`
  (`cmd-misc.c:98`), `historyAdd(..., HIST.USER_INPUT, ...)` at `:4642`, and the
  `':'` binding at `:8201` (`ui-game.c:211`).
  `web/src/rest-steal-note.test.ts:60-80` is the test.
- **The last two sections of the shape-lore textblock chain** - **ported.**
  `game/shape-inspect.ts:163` and `:164` supply `changeEffectText` and
  `triggeringSpells`; `web/src/main.ts:4164` is the live shape browser building
  its env through `makeShapeLoreEnv`; `game/shape-inspect.test.ts:279-295` asserts
  both tail lines reach `shapeLoreLines` for a real shipped shape. All ten of
  `shape_lore`'s sections (`ui-knowledge.c:3035`, calls at `:3047-3056`) map
  one-to-one onto `player/shape-lore.ts:253-267`.

> **The contradiction this page was carrying, recorded rather than quietly
> repaired (2026-08-14).** Until today the "ported" row for
> `parity/ledger/player-history.yaml:91` in the appendix **closed a different row
> by citing the notes command**, while the bullet above said in as many words that
> no `do_cmd_note` counterpart existed anywhere in the port. Two sections of this
> document disagreed about whether a whole command was written, and the appendix
> was the half that was right. Both are corrected above; the appendix row also
> carried a `main.ts:4557` line number that had drifted to `:4642`. Noted here
> because a ledger that edits itself silently is worth less than one that shows
> where it was wrong.

### Needs a verdict, not work (1)

- **`spoil.ts`'s `timedDesc` / `summonDesc`** (`game/spoil.ts:94`) are
  "deliberately NOT supplied". PORT_TODO 5.6's other half closed
  (`monsterHitPercent` is supplied, `:553`; the fourth argument is real, `:599`).
  Whether the two remaining describers are a deliberate divergence or an
  unfinished supply has never been decided. Decide it; do not leave it here.

  **Re-measured independently 2026-08-14 (task #227), and the decision is now the
  only thing missing.** A throw-instrumented probe was injected into `spoil.ts`'s
  own `extras` - the real producer, not a copy - and `spoilObjDesc`,
  `spoilArtifact` and `spoilMonInfo` all completed **without consulting either
  describer**. The instrument is demonstrably live rather than silently inert:
  the same throwing describers, on the same
  `objectInfo(OINFO.SPOIL)` + `makeObjectInfoDeps` path the file uses at
  `spoil.ts:417`, fire for 5 of the 409 object kinds in the shipped pack (Elvish
  Waybread, Whisky, Fine Wine, Orcish Liquor, Berserk Strength) - all food and
  potion kinds neither dump describes. So the two describers are unreached by
  every spoiler this port generates, and the open question is a verdict, not
  work.

## Not part of the port, with the mechanism

- **The three `OSTACK_LIST` checks** (`obj-pile.c:409`, `:410`, `:485`). Absent
  on purpose, and the reason is a measurement rather than a judgement: **nothing
  in Angband 4.2.6 ever passes `OSTACK_LIST`.** It is declared at
  `obj-pile.h:33`, tested three times and supplied never; every `OSTACK_*`
  argument in the C tree is PACK, QUIVER, MONSTER, STORE or FLOOR, and no
  arithmetic anywhere sets `0x04`. `obj/ostack-list.test.ts` is the ratchet: it
  fails the moment any port code passes the bit, which is the point at which the
  three checks become owed. Unreachability is a property of the CALLERS, so the
  guard sits on the thing that can change.
  **Ratified by the owner 2026-08-09 (option A):** "unreachable in upstream's
  own C" is a finished state, not an open question. This entry is the template
  the third finished state above is judged against - a `file:line`, an
  enumeration of every call site, and a ratchet on the callers.

- **`RSF_BR_MANA` is declared and never used** (`list-mon-spells.h:38`,
  `monster_spell.txt:425`). 93 `RSF(` lines minus `NONE` and `MAX` gives 91 real
  spells; every `spells:` directive in `lib/gamedata/monster.txt` was split and
  matched against the declared set, and **90 of the 91 appear - `BR_MANA` is the
  only one no monster race ever sets.** The port carries the same shape exactly:
  the enum entry (`generated/mon-spells.ts:33`, `BR_MANA: 25` at `:130`, matching
  `list-mon-spells.h:38` minus the first `RSF(` at `:13`), the spoiler record
  (`content/pack/monster_spell.json:720`), and a borg `case` mirroring
  `borg-danger.c:931` / `borg-update.c:933`. `content/pack/monster.json` uses the
  same 90 and nothing undeclared.
  **The enum entry must NOT be removed.** `RSF` is a bit position that is
  PERSISTED ([MOD_REACH.md](../docs/modding/MOD_REACH.md), row 22); dropping index
  25 would shift `BOULDER` and every RSF above it and silently corrupt the monster
  spell flagsets in every existing save, which no `SAVE_VERSION` bump can repair -
  the old bytes would still decode against the new numbering. Only the DATA fact
  is unreachable; the entry is load-bearing padding that happens to be faithful.
  `packages/content/src/data-exactness.test.ts` is the ratchet: it re-parses
  `reference/lib/gamedata/monster.txt` and diffs field by field against the pack
  (specs registered at `content/src/specs/mon-init.ts:99` and `:62`), so a
  `spells:BR_MANA` appearing on the port side alone fails it today. **No new test
  was written, because there is nothing left for one to assert.**

- **`old_class.txt` is shipped and never parsed** (`lib/gamedata/old_class.txt`).
  `lib/gamedata/Makefile:8` **installs it into every player's data directory**,
  and `init.c` registers no `old_class_parser`. The only other mentions in the
  tree are `src/Makefile.ibm:114` (an 8.3-FAT rename for the DOS build),
  `src/win/vs2019/Angband.vcxproj:707` and `.vcxproj.filters:1657` (an MSVC `Text`
  item), and comments in three tileset `.prf` files. **Shipped is not reachable**,
  and the install is the stronger sentence than the DOS rename: the file reaches
  every player and no code path reads it.
  `packages/content/src/data-exactness.test.ts` is the ratchet: it asserts the
  file exists upstream and is non-empty AND that no spec named `old_class` is
  registered, so the guard sits on the port's spec list - the thing that can
  change - and compiling the file fails it.

- **`PRICE_DEBUG`'s seven `file_putf` sites** (`obj-power.c:1117`, `:1144`,
  `:1153`, `:1166`, `:1175`, `:1197`, the block closing at `:1206`, with the
  `#else` arm at `:1134`). `PRICE_DEBUG` is defined **nowhere** - not
  `configure.ac`, not any `Makefile`, not `CMakeLists.txt` - so it is a
  hand-edit-only switch and `pricing.log` cannot be written by any shipped 4.2.6
  build. The port emits nothing on this path: `obj/value.ts`, the port of
  `object_value_real`, contains no log call at all, and `obj/randart-log.ts:70-78`
  records the exclusion. The sink is imported only by `obj/power.ts`,
  `obj/randart-build.ts`, `obj/randart-data.ts` and `obj/randart.ts` - the
  `do_randart` path, which is upstream's genuinely live `log_obj`, a different
  file from `pricing.log`.
  `packages/cli/src/text-census.test.ts:62-66` is the ratchet and **it fails in
  BOTH directions**: the two `pricing.log` strings sit under a `not-in-this-build`
  reason key, and that file's own header says a stale entry whose text the port
  later gains must be deleted.

### Upstream `#if 0` blocks: classified, deliberately NOT ratcheted

Six constructs in 4.2.6 sit inside `#if 0`, so no build can reach them. They are
recorded here as `unreachable-in-upstream` and **no test is written for any of
them**, for a reason that follows from the `OSTACK_LIST` template above:
unreachability is a property of the CALLERS, and the guard belongs on the thing
that can change. A test asserting that `#if 0` still brackets a line in
`reference/` pins a vendored tree at a tag - the one thing here that does not
change except by a deliberate repin, which re-runs this whole sweep anyway. Such
a test could only ever produce a false alarm in an unrelated file.

Four of the six have no port surface at all: the port replaces upstream's C
frontends with a canvas terminal, so nothing in this repository could grow a
caller and a test would be a tautology dressed as coverage. The two that do have
a surface (`equip-cmp.ts`, `ui-entry.ts`) are already moved on by the existing UI
parity tests if an arm appears, which is cheaper than a bespoke ratchet.

| upstream | construct | guard |
|---|---|---|
| `ui-equip-cmp.c:265`, `:285`, `:287` (decls) / `:1649`, `:1700`, `:1707` (defs) | `sel_better_than`, `sel_exclude_slot`, `sel_only_slot` | `#if 0` at `:264-267`, `:284-289`, `:1648-1654`, `:1699-1712`. The other eight `sel_*` are live (`:1657-1696`, plus `sel_exclude_src` at `:1715` and `sel_only_src` at `:1722`). Port: `game/equip-cmp.ts:225-249` implements only the four live selector categories. |
| `ui-entry.c:1292-1304` | the `OBJ_MOD_STEALTH` (`:1293`) / `OBJ_MOD_SEARCH` (`:1299`) cases in `modifier_to_skill` (`:1275`) | `#if 0` at `:1292`, `#endif` at `:1304`, with the in-file reason above it. Port: `game/ui-entry.ts:1235-1237` handles only `TUNNEL`, matching the live behaviour. |
| `wiz-stats.c:1342-1356` | `static double total(double stat[MAX_LVL])` | the file's only `#if 0`; its comment says "Left this function unlinked for now". |
| `main-sdl.c:995-1020` | `sdl_ButtonBankRemove` (def `:999`) | `#if 0` at `:995`, `#endif` at `:1020`; no other reference in the tree. |
| `main-win.c:1626-1645` and `:2679-2683` | `Term_init_win` / `Term_nuke_win` (`:1631`, `:1640`) and the `init_hook` / `nuke_hook` assignments (`:2681`, `:2682`) | both blocks `#if 0`; both bodies are `/* XXX Unused */` stubs. |
| `main-xxx.c:123-134` | `color_data[MAX_COLORS]` (`:132`) | `#if 0` - **and the whole file is dead anyway**: it is gated on `USE_XXX` (`:78`, `:749`), which its own header says is defined by "Makefile.xxx" (`:24`), and **no `Makefile.xxx` exists in the tree**. No target compiles it; `Makefile.std:189` and `Makefile.ibm:152` mention it only in comments. Cite the file, not the `#if 0`. |

**A frontend excluded by a CMake default is NOT in this class**, and this is
recorded because a sweep proposed the frontends as a finding and it would have
been a large wrong answer. `CMakeLists.txt:72-80` is a *fallback*, not an
exclusion - its own comment says "If none of the graphical front ends will be
configured, configure the one for Windows if that's the target plaform or the X11
one for anything else" - and `SUPPORT_SDL_FRONTEND`, `SUPPORT_GCU_FRONTEND` and
the rest are
user-settable `option()`s, and `-DSUPPORT_SDL_FRONTEND=ON` builds a working SDL
frontend. **The test is "does a shipped artifact exist that turns this on?", not
"is it on by default?"** That is exactly what separates `USE_XXX` (the enabling
makefile is absent, so unreachable) and `PRICE_DEBUG` (no switch anywhere, so
unreachable) from the frontend options (the switch ships in CMake, so reachable).
By the same discriminator `SCORE_BORGS` is not in this class either: `#ifndef`
means the body fires by default.

## Closed since this document was dated (2026-08-04)

Kept rather than deleted, because a correction that leaves no trace invites the
same claim to be re-derived. Each line names the evidence that closed it.

### It changes what happens in play

- ~~Nothing sums the player's carried weight~~ - `session/game.ts:3948` sets
  `player.upkeep.totalWeight = gearTotalWeight(gear)`; `game/gear-weight.test.ts`
  is the test. The overload speed penalty (`player/calcs.ts:1216`) can fire.
- ~~`square_isempty` is weaker than upstream's, at 48 call sites, and moves RNG
  draws~~ - **wrong twice over.** The weak predicate was deleted, not repaired
  (`game/context.ts:1257-1273`); `squareIsEmptyLive` in `game/mon-place.ts` is
  the faithful port; and the generation-time `squareIsEmpty` in `gen/util.ts` was
  faithful all along, "which is why the claim that this could shift level
  generation was wrong."
- ~~The `PN_IGNORE` notice pass is never run~~ - `game/notice.ts:37-38` tests the
  bit and clears it. It has a consumer.
- ~~Monster-vs-monster theft ignores `react_to_slay`~~ - `mon/steal.ts:49`
  imports `reactToSlay` and `:263` calls it at upstream's `mon-util.c:1548`.
- ~~`alter` (`+`) has no chest or floor-trap branch~~ - `game/cave-cmd.ts` opens
  with both: the chest branch via `chestDeps` (`chestCheck`, `doCmdOpenChest`,
  `doCmdDisarmChest`, imported `:53`) and the sibling floor-trap disarm action.
- ~~The chest `OF_TRAP_IMMUNE` rune is never learned~~ - `game/chest.ts:277` and
  `:362` both call `equipLearnFlag(..., OF.TRAP_IMMUNE)`. The branch is not empty.
- ~~`pile_insert_end` is absent~~ - closed by #131.
  `game/pile.upstream.test.ts:35` says the old line was wrong in as many words;
  five upstream call sites have port counterparts (`game/gear.ts:1364`,
  `game/known.ts:642`).
- ~~`path_analyse`~~ - `game/known.ts` ports it, with `known.test.ts` covering it.
- ~~The known-object shadow cave~~ - `game/floor.ts:18` states it: `state.known.objects`
  is a remembered pile per grid and `knownObject` is `map_info`'s loop over it
  (PORT_TODO 2.9).
- ~~`object_flag_is_known` at the three store sites~~ - `store/store.ts:250`,
  `:392`: `flagKnown` is `object_flag_is_known` bound to the object.
- ~~`cmd_disable_repeat_floor_item`~~ - closed by #132; all four upstream sites
  are ported (`game/repeat.ts:18`, `session/game.ts:2472`, `:2523`, `:2652`,
  `:2847`).
- ~~The monster-source decoy / target-monster branches of `EF_TOUCH`~~ -
  `game/effect-attack.test.ts:337` is a describe block over exactly those branches.

### It changes what the player is told

- ~~The killer's name is a race name, not `monster_desc(MDESC_DIED_FROM)`~~ -
  `game/effect-attack.ts:703` calls `monsterDesc(mon, MDESC_DIED_FROM)`, and the
  comment records that it used to be the bare race name.
- ~~Object and ego recall show no computed lines~~ - `objectFakeRecall`
  (`web/knowledge.ts:1139`) calls `objectInfo(obj, OINFO.FAKE | OINFO.SUBJ, ...)`,
  which is `desc_obj_fake`'s own flags (`obj-info.c:2394`), and `egoFakeRecall`
  (`:1345`) calls `objectInfoEgo`. `artifactFakeRecall` (`:933`) is the third.
  `web/knowledge-recall.test.ts` covers them.
- ~~Monster spell and breath damage are not bound to the casting race, so
  `monSpellLoreDamage` returns 0 and `(N)` is omitted at every spell~~ -
  `mon/lore-describe.ts:440` computes the real `mon_spell_dam` by default and
  `:390` calls it. `deps.spellLoreDamage` is a full override *only*; an
  unsupplied optional with a working default is not an unreachable feature.
- ~~The knowledge browser's thematic grouping columns~~ - and it is REACHABLE,
  which is the half worth checking: `session/boot.ts:180` binds the compiled
  `ui_knowledge.txt` categories via `bindMonsterCategories`, and
  `web/main.ts:4060` passes `registries.monsterCategories` into
  `monsterKnowledgeGroupViews`. `web/knowledge.ts:1431` is
  `do_cmd_knowledge_monsters`' browser (`ui-knowledge.c:1309-1378`).
- ~~The high-score entry cannot name the real killer~~ - `score/types.ts:60`
  carries `died_from` as `how[32]` and `score/score.ts:266` gates it as upstream does.
- ~~The character sheet's launcher contribution is 0~~ - `game/ui-entry.ts:1482`
  supplies `launcher: equippedLauncher(p, state.runeEnv)`. Only the PORT_TODO
  comment at `:1481` was stale.
- ~~`update_sidebar`'s priority culling and from-bottom placement~~ -
  `game/display.ts:571` is `side_handlers[]` verbatim, "all 22 rows in table
  order with the priority update_sidebar culls on, INCLUDING the four entries
  whose hook is NULL"; `:583` is the negative-priority print-from-bottom rule
  (`ui-display.c:871-875`) and `:646` uses it. `display.test.ts` covers it.
- ~~The birth screens answer help with a no-op~~ - `web/birth.ts:56` imports
  `runHelp`, and the race/class help blocks are registry data (`:196`).
- ~~Temporary brands/slays are not shown in object info~~ -
  `obj/object-info.ts:265-270`: the reader is REQUIRED and reads
  `GameState.tempBrandSlay`. The comment records that this note outlived its gap.
- ~~The lore title does not recolour a unique with `purple_uniques`~~ -
  `mon/lore-describe.ts:1388` is the `else if (deps.purpleUniques)` arm.
- ~~`equip_learn_flag` has no shape branch~~ - `obj/knowledge.ts:693`, `:740`,
  `:761` port the shape's own `to_a` / `to_h` / `to_d`
  (`obj-knowledge.c:1992-1998`, `:2026-2032`, `:2066-2078`).
- ~~Rune-learning messages still use the `ODESC_BASE` stand-in~~ - the seam
  landed: `obj/knowledge.ts:252` is `env.describeBase?.(obj) ?? objBaseName(obj)`,
  wired in `session/describe-wiring.test.ts`. `objBaseName` is now the
  worldless-caller fallback, which is what it should be.

### Whole modes that were never begun - all three are begun

- ~~Arena mode~~ - closed by #119; `arenaGen` is in `gen/generate.ts`.
- ~~The quest system~~ - closed by #120; `game/quest.ts` with `quest.test.ts`.
- ~~Persistent levels and the town builder's full store generation~~ - closed by #121.

### History, notes and files

- ~~`randart.log` / `randart.txt`, the largest single item here~~ - closed by
  #118; `obj/randart-log.ts`, with `obj/randart-log.census.test.ts`.
- ~~`options_save_custom` / `restore_custom` / `restore_maintainer`~~ - closed by
  #117; `player/options-file.ts` with `session/options-custom-wiring.test.ts`.
- ~~`RANDNAME_TOLKIEN` is not loaded, so randart names come from the port's own
  generator~~ - `obj/randart.ts:34` passes
  `reg.nameSections.get(RANDNAME_TOLKIEN)` into `doRandart`. The corpus is supplied.

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

- ~~`project-path.yaml:58`: a ported function whose only caller would be an absent
  UI branch~~ - `projectPath` has live callers at `world/project.ts:201` and
  `:391`. Not shipped-and-unreachable.

## Judged unnecessary, with the mechanism

81 rows when this section was written. These are not gaps, and each names *why*
rather than asserting it. **Five of them moved out on 2026-08-14** into the third
finished state — they were claims about UPSTREAM wearing `n-a`'s clothes, which
is a claim about *this port's* platform. See
[Not part of the port](#not-part-of-the-port-with-the-mechanism) and the appendix
tally, which is generated and therefore always current.

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
- **Upstream's `look` is a UI function with `CMD_NULL`** (bound at `ui-game.c:143`; the function is `ui-knowledge.c:4057`),
  and **4.2.6 has no search command at all** — no `do_cmd_search`, no
  `CMD_SEARCH`. Those two of the twenty stub codes are correctly never replaced.
- **`monster_index_move`** exists only to serve `arena_gen`'s `memcpy`;
  **`expression_free`** is garbage collected. Two more used to be listed here and
  have been re-filed as `unreachable-in-upstream` (2026-08-14), because their
  mechanism is a measurement of the C rather than a property of this platform:
  **`old_class.txt`**, which upstream *installs into every player's data
  directory* and never parses, and **`pricing.log`**, behind a `PRICE_DEBUG` that
  upstream defines nowhere. Both are written out in full above, with their
  ratchets.
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
- ~~**Known 2026-08-11 reconciliation debt:** the `port-todo.test.ts` count
  guard is currently red.~~ **Settled 2026-08-14.** The guard was green before
  this pass touched anything (measured, not assumed - the debt note had outlived
  its repair, exactly like the rows above it), and it is green after:
  PORT_TODO.md's stated totals were moved to **13 citations, 5 `real` + 8
  `partial`** when this pass closed the deferral census's last two `partial`
  rows. Kept struck through rather than deleted, because a note saying "this is
  broken" that quietly disappears teaches nobody what happened to it.
- **One guard lost its subject when the census emptied, and it says so.**
  `port-todo.test.ts`'s mutation check picked a real owed file to hole out; with
  zero `real`/`partial` rows left in this tranche there is no such file. It now
  names the empty case and asserts against a synthetic path instead of passing by
  not running - a mutation check with nothing to mutate is a green test measuring
  nothing, and it would have left the guard it protects vacuous with no sign of
  it.
- **The hand-written `file:line` numbers in the prose above are the one part of
  this document that drifts, and they already have once**: rewriting the notes
  moved ten of them by a line or two, and nothing caught it until the two
  documents were diffed against the census by hand. Prefer the generated
  appendix and PORT_TODO.md's `Sites:` lines, which come from the TSV. When the
  prose and the appendix disagree, the appendix is right.

<!-- BEGIN GENERATED: deferral-report.mjs -->

## Appendix: every row, with its verdict

Generated from `parity/reports/deferral-census.tsv` (226 rows).

| verdict | meaning | rows |
| --- | --- | --- |
| `divergence` | Deliberately different, with the mechanism named | 30 |
| `n-a` | Not applicable to this port, with the mechanism named | 49 |
| `unreachable-in-upstream` | No path in 4.2.6 can execute it, measured in the C (the third finished state) | 7 |
| `ported` | Done; the note was stale and has been rewritten | 25 |
| `note-is-fix` | The wording sits inside a record of a FIX, not a gap | 83 |
| `not-a-deferral` | Ordinary English, not a parity claim | 32 |
| | **total** | **226** |

### `divergence` - Deliberately different, with the mechanism named (30)

- `packages/core/src/game/context.ts:1345` - mon-death.ts:417-418 calls monsterDeath before deleteMonster; context.ts:1351-1412 removes groups, targets, artifacts, mimics, square and slot. The only remainder is the documented repaint-layer divergence.
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
- `packages/core/src/gen/generate.ts:11` - The known-level ("player cave") duplicate, ratified at game/known.ts:153 - the same decision as the per-object twin, applied to terrain. Related to work item #126
- `packages/core/src/obj/bind.ts:1367` - The known-object side is synthesised on demand (obj/known-object.ts) rather than bound as a second object
- `packages/core/src/obj/desc.ts:15` - The header's inline DEFERRED notes are all known-twin reads, which desc.ts now takes from objectKnownShadow
- `packages/core/src/obj/knowledge.ts:22` - Per-object twin replaced by on-demand synthesis (obj/known-object.ts objectKnownShadow)
- `packages/core/src/obj/knowledge.ts:773` - A known-twin display marking, subsumed by the shadow
- `packages/core/src/obj/knowledge.ts:792` - Same
- `packages/core/src/obj/knowledge.ts:1210` - Same
- `packages/core/src/obj/known-object.ts:9` - This module IS the divergence: the twin is synthesised on demand and desc.ts reads the shadow wherever upstream reads obj->known
- `packages/core/src/obj/object.ts:7` - Header points at obj-model.yaml; the model's absent twin is the synthesised shadow
- `packages/core/src/obj/object.ts:182` - Known-twin field
- `packages/core/src/obj/object.ts:296` - The explicit statement of the divergence: no persistent twin, synthesis instead (obj/known-object.ts)
- `packages/core/src/store/store.ts:560` - The obj->known pile is synthesised on demand (obj/known-object.ts)
- `parity/ledger/game-gear.yaml:73` - The known twin is synthesised on demand; the line's own "NOT deferred" clause lists what is live
- `parity/ledger/rng.yaml:40` - Rand_init's time/pid seeding is deliberately replaced: the port seeds from crypto/Math.random at the host and stores the seed in the save, which is what makes a run reproducible
- `parity/ledger/ui-entry.yaml:107` - Synthesised on demand (obj/known-object.ts)
- `parity/ledger/ui-entry.yaml:114` - The port folds merged curse data into the object's own flags, which the note states is equivalent

### `n-a` - Not applicable to this port, with the mechanism named (49)

- `packages/core/src/game/cave-square.ts:58` - Adjacent-decoy destruction on floors; no RNG, and the decoy itself is modelled
- `packages/core/src/game/cave-square.ts:68` - Same adjacent-decoy note, no RNG
- `packages/core/src/game/known.ts:250` - The note names its own mechanism: the front end runs updateView + noteSpots after every state-changing action, so there is no dirty-flag pipeline for a PU_/PR_ bit to set
- `packages/core/src/game/loop.ts:339` - A message on a seen trap re-arming; the port has no PR_ dirty-flag pipeline and the front end repaints unconditionally
- `packages/core/src/game/mon-death.ts:342` - PR_MONLIST is a redraw bit with no port equivalent (the front end repaints unconditionally); the note itself records quest_check as wired
- `packages/core/src/game/monster-turn.ts:1303` - Presentation only, no RNG; the port routes messages through the shell sink
- `packages/core/src/game/monster-turn.ts:1680` - Lore note on OF_AGGRAVATE, no RNG; monster lore is otherwise wired
- `packages/core/src/game/monster-turn.ts:1713` - Message plumbing and lore; the messages route through the shell sink
- `packages/core/src/game/player-path.ts:95` - Sound and redraw halves; no RNG, and the port has no PR_ pipeline
- `packages/core/src/game/player-turn.ts:825` - Two of the 20 are correctly never replaced: upstream's "look" is a UI function with CMD_NULL (ui-knowledge.c:4169, bound by the shell to l/x at web main.ts:8039), and 4.2.6 has no search command at all - no do_cmd_search, no CMD_SEARCH
- `packages/core/src/game/project-cast.ts:10` - Layer boundary with live suppliers: session/game.ts:1223 supplies the monster hooks and :1289 the player hooks, so the "deferred consequences" all run in play
- `packages/core/src/game/project-cast.ts:31` - basicPlayerActor is the worldless view; the live path supplies the real actor (session/game.ts:1289)
- `packages/core/src/game/project-cast.ts:152` - CastHooks is the seam, supplied at session/game.ts:1223/:1289
- `packages/core/src/game/project-cast.ts:154` - ProjectMonsterHooks supplied at session/game.ts:1223
- `packages/core/src/game/project-cast.ts:156` - ProjectPlayerHooks supplied at session/game.ts:1289, onSideEffects via makePlayerSideEffects (game/player-side.ts:139)
- `packages/core/src/game/project-monster.ts:48` - The seam's suppliers are live (session/game.ts:1223)
- `packages/core/src/game/project-player.ts:16` - Same seam discipline; supplied at session/game.ts:1289. The killer-name half is tracked separately as the MDESC_DIED_FROM gap
- `packages/core/src/game/project-player.ts:93` - Supplied at session/game.ts:1289
- `packages/core/src/game/shape-inspect.ts:108` - Re-verified 2026-08-14 (#226). A binding-layer boundary, not a divergence in play: class spell effects are held as raw pack records (ClassSpell.effectsRaw, player/types.ts:151) and game/spell-cmd.ts:239 casts and aims off those same records, so the raw chain is consumed for real casting.
- `packages/core/src/game/spoil.ts:379` - seed_randart only matters under birth_randarts and this is a dev tool; the note states the condition
- `packages/core/src/mon/project-mon.ts:45` - The seam's suppliers are live (session/game.ts:1223)
- `packages/core/src/mon/take-hit.ts:24` - The PR_HEALTH redraw, which is the ratified repaint divergence (DIVERGENCES.md B1): the renderer is immediate-mode and has no dirty-flag to raise. The state it gates, state.healthWho, IS tracked
- `packages/core/src/mon/timed.ts:223` - Health-bar / monster-list redraw; the front end repaints unconditionally
- `packages/core/src/obj/desc.ts:632` - is_unknown's placeholder path belongs to the object-list screen, which the web layer draws (game/obj-list.ts + web screens)
- `packages/core/src/player/bind.ts:15` - Layer boundary: the raw effect chain is compiled by the effects domain, which is ported (effects/effect.ts) and wired at session boot
- `packages/core/src/player/birth.ts:395` - Kind-name refs are resolved by the session (outfitPlayer + tvalFindIdx at gear.ts:1300); the binding layer holding names is the design
- `packages/core/src/player/birth.ts:443` - Same: "deferred references" names the binding boundary
- `packages/core/src/player/birth.ts:446` - Same
- `packages/core/src/player/exp.ts:17` - PU_/PR_ update flags have no port equivalent; the front end repaints unconditionally
- `packages/core/src/player/types.ts:153` - Binding boundary: the raw record is compiled by the effects domain at boot
- `packages/core/src/player/types.ts:171` - Same binding boundary
- `packages/core/src/player/types.ts:204` - Same, handed to the obj domain
- `packages/core/src/player/types.ts:206` - Same
- `packages/core/src/player/types.ts:225` - Same: tval/sval names resolved by the obj domain
- `packages/core/src/world/chunk.ts:10` - square_light_spot is a lighting refresh with no port equivalent; the front end recomputes and repaints every frame
- `packages/web/src/mapview.ts:71` - The rounding branches are dead code upstream; not porting dead code is the documented policy
- `parity/ledger/bitflag.yaml:54` - flag_has_dbg / flag_on_dbg are the C's debug-build assert wrappers around flag_has / flag_on. TypeScript's FlagSet asserts unconditionally (assertValidFlag), so the debug twin has nothing to add. Ratified N/A, not deferred.
- `parity/ledger/dice.yaml:38` - dice_free is manual deallocation. Nothing to port to a garbage-collected runtime. Ratified N/A, not deferred.
- `parity/ledger/effects-interpreter.yaml:138` - recharge_failure_chance IS in the obj domain, which is where the note says it belongs; the rest of the line is about GC and serialisation
- `parity/ledger/expression.yaml:31` - expression_free is garbage collected and the strtol saturation is documented in the helper; neither is reachable behaviour
- `parity/ledger/game-arena.yaml:16` - monster_index_move exists only to serve arena_gen's memcpy; the port's arena builder reads state.healthWho instead
- `parity/ledger/game-effect-detect.yaml:48` - What remains after the closures this row records is the DTRAP border and the item/monster list redraws, both the ratified repaint divergence. The row's third clause is FALSE: there are no detection sounds to defer - effect_handler_DETECT_* (effect-handler-general.c:1321-1874) uses msg() and never sound()
- `parity/ledger/game-effect-detect.yaml:58` - The monster recall WINDOW refresh (PR_MONSTER) is the ratified repaint divergence; an immediate-mode renderer has no window to invalidate
- `parity/ledger/game-gear.yaml:70` - Pack overflow at birth: a birth kit cannot overflow, and packOverflow itself is ported and called (obj-cmd.ts:276, session/game.ts:806)
- `parity/ledger/player-model.yaml:53` - Starting-inventory kind-name refs are resolved by the session; a binding boundary
- `parity/ledger/ui-display.yaml:155` - update_topbar / SIDEBAR_TOP, the prt_*_short handlers, hp_colour_change and every Term_* positioning call are the curses term's own layout machinery. The port draws the same values on a canvas grid (game/display.test.ts covers the value formatting); there is no subterm to position
- `parity/ledger/ui-player.yaml:68` - The resist/ability/sustain grid is ported, in the separate module the note points at (characterGrid, ui-entry.ts:1863, drawn by web charsheet.ts:270)
- `parity/ledger/wizard-debug.yaml:163` - The action is reachable by another route already ported; upstream's separate entry point adds no behaviour
- `parity/ledger/wizard-debug.yaml:170` - Process lifetime belongs to the shell, which owns it in this port

### `unreachable-in-upstream` - No path in 4.2.6 can execute it, measured in the C (the third finished state) (7)

- `packages/core/src/game/effect-general.ts:587` - Promoted from n-a 2026-08-14: the same upstream measurement as parity/ledger/game-effect-general.yaml:97. Upstream's call (effect-handler-general.c:992) returns at mon-util.c:794 before reaching its own body, so the pflag arm at mon-util.c:822-829 never runs and there is nothing to port.
- `packages/core/src/obj/object.ts:900` - Re-verified 2026-08-14 (#226). object_similar's two object_is_equipped guards (obj-pile.c:400-403) read the global player->body, and object.ts:915-925 enumerates every upstream mode: no 4.2.6 caller reaches the guard with an equipped object, because combine_pack walks player->upkeep->inven and the port's pack/quiver/floor paths (gear.ts:614, :696, pickup.ts:164) cannot contain one. PORT_TODO 2.11.
- `packages/core/src/obj/object.ts:916` - Promoted from n-a 2026-08-14: this is the TEMPLATE the third finished state is judged against, ratified by the owner 2026-08-09 (option A). Nothing in 4.2.6 ever passes OSTACK_LIST - it is declared at obj-pile.h:33, tested at obj-pile.c:409, :410 and :485 and supplied never; every OSTACK_* argument in the C tree is PACK, QUIVER, MONSTER, STORE or FLOOR and no arithmetic sets 0x04. obj/ostack-list.test.ts is the ratchet and it sits on the CALLERS, which are the thing that can change.
- `packages/core/src/obj/randart-log.ts:72` - Promoted from n-a 2026-08-14 (#228), and the sites are now named. object_value_real's pricing.log is guarded by #ifdef PRICE_DEBUG at obj-power.c:1117, :1144, :1153, :1166, :1175 and :1197 (the #else arm at :1134, block closing :1206), and PRICE_DEBUG is defined nowhere - not configure.ac, not any Makefile, not CMakeLists.txt - so it is a hand-edit-only switch and pricing.log cannot be written by any shipped 4.2.6 build. The port emits nothing on this path: obj/value.ts has no log call at all. packages/cli/src/text-census.test.ts:62-66 is the ratchet and it fails in BOTH directions.
- `packages/core/src/store/transact.ts:26` - Re-verified 2026-08-14 (#228). There is no purchase-side history call to port: do_cmd_buy runs reference/src/store.c:1646-1774 and makes no history call of any name. store.c has exactly four - :1087 and :1303 (history_lose_artifact, turnover and black-market purge), :1924 (history_find_artifact, inside do_cmd_sell at :1865), :1988 (the store refusing what it just bought) - and the sell pair is wired at session/game.ts:3621-3622 and :3666-3667. The earlier note named a call upstream does not make; the direction was backwards. transact.ts:26-39 now records the correction at the site.
- `parity/ledger/game-effect-general.yaml:97` - Promoted from n-a 2026-08-14: the mechanism is a measurement of upstream, not of this platform. effect-handler-general.c:992 is update_smart_learn(mon, player, 0, PF_NO_MANA, -1) and mon-util.c:794 returns immediately when flag is 0 and the element is out of range - exactly that argument list. It is the ONLY one of the nine 4.2.6 call sites that passes a pflag, so the pflag arm at mon-util.c:822-829 is unreachable and known_pstate.pflags is never written in any game of Angband.
- `parity/ledger/gamedata.yaml:502` - Promoted from n-a 2026-08-14 (#228), with the mechanism measured. old_class.txt is SHIPPED and never parsed: lib/gamedata/Makefile:8 installs it into every player's data directory and init.c registers no old_class_parser. The only other mentions in 4.2.6 are src/Makefile.ibm:114 (an 8.3-FAT rename for the DOS build), src/win/vs2019/Angband.vcxproj:707 and .filters:1657 (an MSVC Text item), and comments in three tileset .prf files. Shipped is not reachable.

### `ported` - Done; the note was stale and has been rewritten (25)

- `packages/core/src/game/wizard.ts:68` - spoilObjDesc / spoilArtifact / spoilMonDesc / spoilMonInfo are live at game/spoil.ts:273, :366, :480, :532; web/src/wizard.ts:373 runSpoilers reaches them through the host seam.
- `packages/core/src/gen/gen-monster.ts:350` - spreadMonsters is exported at gen-monster.ts:353 and used by the cave builders at gen/cave.ts:1721 and :1865; gen/gen.test.ts:2175 exercises room_of_chambers.
- `packages/core/src/mon/lore-describe.ts:863` - combat/melee.ts:243 chanceOfMeleeHitBase and combat/hit.ts:60 hitChance are wired as meleeHitPercent in web/src/main.ts:3786-3787; web/src/screens.test.ts:942-969 checks the live percentage.
- `packages/core/src/mon/lore-describe.ts:1316` - web/src/main.ts:3788-3790 wires monsterHitPercent from the actor defence and monster attack power; lore-describe.ts:1319 consumes that supplied seam.
- `packages/core/src/obj/knowledge.ts:1331` - obj/knowledge.ts:1134 requests PN_IGNORE, session/game.ts:609-611 names the next notice pass, and game/notice.ts:30 consumes it; game/notice.test.ts:177 covers its ordering.
- `packages/core/src/obj/object.ts:910` - The object-info seam calls ObjectInfoDeps.isEquipped at obj/object.ts:1020 and :1049; store/transact.ts:84, :410 and :652 implement and use the real player-equipment predicate.
- `parity/ledger/game-obj-list.yaml:45` - game/obj-list.ts:306 objectListEntryName sends the summed count through ODESC.ALTNUM; the row renderer uses it at :340-341 and obj-list.test.ts covers the listing behaviour.
- `parity/ledger/game-project-cast.yaml:53` - game/effect-attack.ts:433-445 implements both handleTOUCH target branches, and game/project-cast.ts:705 delegates to the handler.
- `parity/ledger/high-scores.yaml:96` - game/effect-attack.ts:703 and game/project-cast.ts:147 form MDESC_DIED_FROM killers; game/take-hit-hooks.ts:66-68 records diedFrom and web/src/main.ts:4990-5000 passes it to score construction.
- `parity/ledger/player-history.yaml:46` - web/src/screens.ts:1107 exports historyLines and web/src/charsheet.ts:581 dumpCharacterFile writes the character dump through the host seam.
- `parity/ledger/player-history.yaml:79` - session/game.ts:1113-1137 wires onArtifactFound and onArtifactLost; game/pickup.ts:305-310 invokes the find hook and game/effect-item.ts:678 invokes the loss hook. There is no distinct store-purchase entry to owe (corrected 2026-08-14): do_cmd_buy (store.c:1646-1774) makes no history call, and store.c's only find-side call is history_find_artifact at :1924 inside do_cmd_sell.
- `parity/ledger/player-history.yaml:91` - web/src/main.ts:4642 calls historyAdd with HIST.USER_INPUT from the note command (noteCmd at :4615, the ':' binding at :8201), and web/src/rest-steal-note.test.ts:60-80 verifies the binding, the "Note: " prompt and the history action. Line numbers re-measured 2026-08-14: the call had drifted from :4557 to :4642.
- `parity/ledger/store-price.yaml:21` - store/store.ts:113 exports storeChooseOwner and invokes it at :129, :133 and :716 when a store is initialized or maintained.
- `parity/ledger/ui-entry.yaml:138` - game/ui-entry.ts:2114 exports equipCmpCategories; game/equip-cmp.ts:391 consumes it and game/equip-cmp.test.ts:116 checks all categories and the combined row.
- `parity/ledger/wizard-debug.yaml:14` - obj/make.ts:754 ArtifactState records created artifacts, and session/save.ts:1069 plus :1500 serialize artifactsCreated.
- `parity/ledger/wizard-debug.yaml:87` - web/src/wizard.ts:2083 runTweakItem is reached from the play-item T branch at :1918-1920.
- `parity/ledger/wizard-debug.yaml:112` - game/dump-level.ts:109 exports dumpLevel and web/src/wizard.ts:1592 runWriteMap drives it; game/dump-level.test.ts covers its output.
- `parity/ledger/wizard-debug.yaml:139` - The spoiler generators are game/spoil.ts:273, :366, :480 and :532, reachable from web/src/wizard.ts:373 runSpoilers.
- `parity/ledger/wizard-debug.yaml:144` - web/src/wizard.ts:901, :904 and :907 invoke the three collectors runCollectObjMonStats (:1731), runCollectPitStats (:1758), and runCollectDisconnectStats (:1717).
- `parity/ledger/wizard-debug.yaml:147` - game/wizard.ts:1682 exports wizStatItem and web/src/wizard.ts:2003 runs it from the item-stat workflow.
- `parity/ledger/wizard-debug.yaml:154` - web/src/wizard.ts:2058 runChangeQuantity is selected by the play-item Q branch at :1923-1925.
- `parity/ledger/wizard-debug.yaml:164` - web/src/wizard.ts:2058 runChangeQuantity is reachable through the Q/q play-item action at :1923-1925.
- `parity/ledger/wizard-debug.yaml:166` - web/src/wizard.ts:1890 runPlayItem contains the A/K/S/R/T/C/Q dispatch at :1914-1925 and uses game/wizard.ts:1520, :1575 and :1610 snapshot/reject/accept operations.
- `parity/ledger/wizard-debug.yaml:167` - The quantity action has its live play-item shell: web/src/wizard.ts:1890 dispatches Q at :1923-1925 to runChangeQuantity (:2058).
- `parity/ledger/world-kernel.yaml:36` - Re-verified 2026-08-14 (#226). session/game.ts:900 supplies monsterLightSources() and session/monster-light-wiring.test.ts:120-130 boots a game and proves it changes the live map; the square side effects and map rendering the row also named are the ratified repaint divergence (DIVERGENCES.md B1), not owed work. PORT_TODO 7.4.

### `note-is-fix` - The wording sits inside a record of a FIX, not a gap (83)

- `packages/core/src/combat/mon-melee.ts:29` - The rewritten header: it records that all four formerly-listed items are ported and names the one that is not (mon/steal.ts:234)
- `packages/core/src/effects/handlers.ts:82` - Records that the "deferred (8.9)" note outlived its wiring: this worldless layer has no monster registry, and the GAME override names the killer through monsterDesc(MDESC_DIED_FROM) at game/effect-attack.ts and game/project-cast.ts
- `packages/core/src/game/cave-cmd.ts:23` - The sentence records that player_best_digger IS now ported; "was deferred" is history, not a deferral.
- `packages/core/src/game/cave-cmd.ts:33` - Records that count_feats is NOW PORTED and that deferring it had been wrong; easy_open does not exist in 4.2.6.
- `packages/core/src/game/context.ts:312` - Records the REMOVAL of a stand-in (noticeIgnore) that nothing read. PlayerUpkeep.notice is the real mask now, raised where upstream raises it and drained by game/notice.ts (PORT_TODO 2.5)
- `packages/core/src/game/context.ts:492` - Records why tempBrandSlay is a required peer rather than an optional seam - the note it replaces (PORT_TODO 3.20) had claimed a predicate was missing that existed
- `packages/core/src/game/context.ts:961` - "exactly as when it was deferred" records that the curse tick is now installed by the session
- `packages/core/src/game/context.ts:1262` - Records the DELETION of a wrong predicate. squareIsEmpty was not square_isempty; the faithful port squareIsEmptyLive in game/mon-place.ts is now the only one
- `packages/core/src/game/effect-general.ts:295` - Records that the gear_to_label letter IS printed: GEAR_LABELS is indexed by body slot exactly as known.ts:775 does, and the row that called it a display concern was wrong
- `packages/core/src/game/effect-general.ts:546` - Records that the monster-vs-monster disenchant branch is ported and ordered first, and that "rides monster-spell targeting (#19)" stopped being true when monsterTargetMonster landed
- `packages/core/src/game/effect-teleport.ts:43` - Records two closures: the three teleport sounds (PORT_TODO 3.26) and the MON_MSG_BRIEF_PUZZLE queue entry (PORT_TODO 3.1)
- `packages/core/src/game/effect-teleport.ts:49` - The sentence says teleportMonster IS the backing that project-monster deferred - a record of the wiring, not a gap
- `packages/core/src/game/effect-terrain.ts:253` - Records a fixed crash (arena entry, out-of-bounds) and states that deferring to the caller's refresh is what upstream's flag does
- `packages/core/src/game/mon-group.ts:28` - The sentence records a CORRECTION to an earlier wrong claim about monster_can_see, not a deferral
- `packages/core/src/game/monster-turn.ts:24` - "NOW WIRED (was deferred)" is a record of the fix
- `packages/core/src/game/monster-turn.ts:1387` - Records that the "rune of protection is broken!" message IS printed below, and that the line calling it deferred sat beside the code doing it
- `packages/core/src/game/monster-turn.ts:1411` - Records that item pickup, group behaviour and lore are all ported (PORT_TODO 7.2) and that two of the three were already ported when the note was written
- `packages/core/src/game/monster-turn.ts:1525` - Records a fixed live defect: destroyDecoy had printed the message for its five other callers all along, and this site - the commonest way a decoy dies - was one of the two that went around the function
- `packages/core/src/game/obj-cmd.ts:1796` - Records that the port routes this through combine_pack, which is what happens - a design record, not a gap
- `packages/core/src/game/player-path.ts:28` - "are wired (W2-003 navigate-up/down, explore, pathfind)" records the fix
- `packages/core/src/game/project-cast.ts:739` - Records that the decoy / target-monster branches are ported one level up in game/effect-attack.ts handleTOUCH, and that the stale note manufactured PORT_TODO 2.13
- `packages/core/src/game/ranged-cmd.ts:24` - The sentence explicitly says the item "had been listed here as deferred, which is" wrong - a correction
- `packages/core/src/game/take-hit-hooks.ts:23` - Records that the port deliberately mirrors upstream's close_game ordering, and names where it happens
- `packages/core/src/game/ui-entry.ts:26` - ui-entry.ts:26-28 is a historical correction, not an outstanding absence: liveTimedUiDeps is exported at :1417 and objectKnownShadow at obj/known-object.ts:441 supplies the view.
- `packages/core/src/game/ui-entry.ts:1408` - Records that PORT_TODO 3.8's stated cause was wrong - player_flags_timed is ported at player/calcs.ts:1097 - and that the DEFERRED comment on the seams had outlived it
- `packages/core/src/game/ui-entry.ts:1411` - Same fix record, temp_resist half: TimedEffect.tempResist exists at player/types.ts:341, so PORT_TODO 3.7's stated cause was also wrong
- `packages/core/src/gen/cave.ts:32` - Records that neither thing this header called deferred still is: the town builder places all eight stores and the persistent-level connectors are live end to end (PORT_TODO 4.3)
- `packages/core/src/gen/generate.ts:15` - Records that arena levels (PORT_TODO 4.1) and quest levels (4.2) are both built and driven, and had been for some time
- `packages/core/src/gen/generate.ts:23` - Records that getJoinInfo, getMinLevelSize and collectJoins are all present and that session/changeLevel drives them (PORT_TODO 4.3)
- `packages/core/src/mon/lore-describe.ts:1376` - Records that the tile_width/tile_height gate is unconditionally true here (a ratified divergence at web/src/mapview.ts:70) and is omitted rather than deferred
- `packages/core/src/mon/steal.ts:35` - Records that react_to_slay on the monster-thief path IS ported (PORT_TODO 2.2) and that the reason originally given for skipping it was untrue when written
- `packages/core/src/mon/steal.ts:36` - The continuation of the same fix record - the precedent it cited ("the EAT_ITEM blow already defers it") was itself false
- `packages/core/src/obj/knowledge.ts:701` - Records that the shared launcher accessor closed two DEFERRED notes whose stated obstacle was three lines of body-slot walk (PORT_TODO 3.9)
- `packages/core/src/obj/make.ts:1253` - Explains why the current behaviour matches upstream at a site that was once a stub
- `packages/core/src/obj/make.ts:1258` - Records that book rejection is live and that the stale note is what manufactured PORT_TODO 2.15; the real defect was the wiring, and it is named
- `packages/core/src/obj/object-info.ts:270` - Records why the temp brand/slay dep is required rather than optional - an optional field would have reproduced the bug it fixes (PORT_TODO 3.20)
- `packages/core/src/session/game.ts:3302` - Records the single binding of tempBrandSlay that closed PORT_TODO 3.20; the melee hooks used to build a private copy nothing else could reach
- `packages/core/src/session/game.ts:4129` - The load path's copy of the same fix record
- `packages/core/src/store/store.ts:173` - This line IS the expansion the other notes call deferred
- `packages/core/src/store/transact.ts:13` - The header's LIVE list records that both sides of the rune learn loop are now wired, and says the DEFERRED label is what made the asymmetry read as intentional
- `packages/core/src/store/transact.ts:24` - The sentence records the fix and why the stale label was harmful
- `packages/web/src/main.ts:3837` - Records that all three greyed-browser claims were wrong: everseen is modelled and wired, and shapeLoreLines is a full port of shape_lore
- `packages/web/src/main.ts:8558` - Records why the first FOV after birth/load clears only_partial, and that it is thrown rather than skipped so a missing updateFov cannot hide behind a black screen
- `parity/ledger/combat-melee.yaml:91` - The comment recording that this list was adjudicated and that ten of its eleven entries had stopped being true
- `parity/ledger/game-arena.yaml:64` - Records that monster reproduction is ported and wired (multiplyMonster supplied at session/game.ts:1855) and that the row was wrong in both halves
- `parity/ledger/game-arena.yaml:71` - Records that ALTER_REALITY is ported and that its arena guard was simply missing rather than blocked - a live defect, now closed (PORT_TODO 4.1)
- `parity/ledger/game-arena.yaml:87` - Records that EVENT_GEN_LEVEL_START("arena") has nothing to defer: its only 4.2.6 subscriber is wiz-stats.c:2635, a debug statistics collector
- `parity/ledger/game-effect-melee.yaml:44` - "Every formerly-deferred handler is now DONE"
- `parity/ledger/game-effect-melee.yaml:52` - Records the closure of all four items (2026-08-07): message_pain with its show_damage branch, the mon_msg queue grammar, MSG_TELEPORT for the JUMP_AND_BITE jump
- `parity/ledger/game-effect-monster.yaml:56` - Records that the arena guards are present at both sites upstream has them (PORT_TODO 4.1)
- `parity/ledger/game-effect-monster.yaml:64` - Records a fixed live message defect: the heal handlers now call monsterDesc with MDESC_STANDARD and MDESC_PRO_VIS|MDESC_POSS as effect-handler-attack.c:268-271 does
- `parity/ledger/game-effect-teleport.yaml:37` - Records that teleportMonster is the backing for the hook
- `parity/ledger/game-effect-teleport.yaml:115` - Records that MSG_TELEPORT / MSG_TPOTHER / MSG_TPLEVEL now go through state.sound at every site upstream calls sound() (PORT_TODO 3.26)
- `parity/ledger/game-effect-terrain.yaml:53` - Records that squareMemorize, squareKnowPile and squareSensePile are all ported and called, and that square_light_spot falls under the ratified repaint divergence
- `parity/ledger/game-mon-ranged.yaml:31` - The ledger sentence records a completed fix: summonPossible rejects arena levels at game/mon-ranged.ts:81-83 and warded grids at :90-92.
- `parity/ledger/game-monster-ai.yaml:40` - "NOW WIRED (were deferred)"
- `parity/ledger/game-project-feat.yaml:45` - Records that exposeToSun is ported and that the reason for deferring it ("no town or day-night cycle yet") expired when PORT_TODO 4.3 built town generation
- `parity/ledger/game-trap.yaml:54` - Records that the trap hooks are supplied by the live session and that equip learning fires on both upstream paths (trap.c:515-518 and 534-539)
- `parity/ledger/game-trap.yaml:58` - A continuation line of the bullet above; the census matched the quoted fragment of the claim being corrected, not a claim of its own
- `parity/ledger/game-trap.yaml:61` - Records that no_light, the monster glyph and web interactions are ported, and that trap effect coverage is classified as a whole surface with a control proving the pass is not vacuous
- `parity/ledger/game-trap.yaml:70` - Records that the trapdoor persistent-levels check and the is_quest check beside it read the live option store; the row had named the option system as unbuilt
- `parity/ledger/gamedata.yaml:482` - Records that both halves of "front-end/UI concern, not part of the core rules pack" were wrong - the pack ships the file and core parses it
- `parity/ledger/gen-cave.yaml:48` - Records that every builder the list called missing is registered and selectable, and names arena_gen as the one genuine exception
- `parity/ledger/gen-framework.yaml:57` - gen/room.ts:1472-1514 and :1561-1602 build nests/pits with setPitType then table.prep(monPitHook(pit)); this line records the closure, not an owed gap.
- `parity/ledger/gen-framework.yaml:77` - Records that the three persistent-level connector functions are all present and that the one_off lists are an AVOID list, imposing no minimum
- `parity/ledger/mon-lore-describe.yaml:107` - Records that the tile-size gate is unconditionally true and omitted rather than faked, a ratified divergence at web/src/mapview.ts:70
- `parity/ledger/mon-make.yaml:49` - Records that LEVEL RATING was listed as deferred and is not - add_to_monster_rating is wired for generation and for live summons/breeders
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
- `parity/ledger/project-path.yaml:83` - target-loop.ts:243-270 is the live target loop and PORT_TODO 7.1 closed its terrain-memory path. target-loop.ts:252 is a separate object-memory gap; this ledger line is closure prose, not that owed row.
- `parity/ledger/session-save.yaml:80` - Records that the web host keeps a character roster with per-character slots and migrates legacy single-slot saves; save slots are a host concern and the format carries them
- `parity/ledger/session-save.yaml:92` - Records that birth_levels_persist is honoured and SavedGame.levelCache serializes every StoredLevel (save.c:1001)
- `parity/ledger/store-bind.yaml:55` - Describes the bookseller's data shape, which the expansion at store.ts:173 consumes
- `parity/ledger/store-maint.yaml:37` - Records that both conjuncts of the buy check are ported and that the object_flag_is_known half landed with PORT_TODO 2.10
- `parity/ledger/ui-entry.yaml:133` - Records that PF_FAST_SHOT is live and that the launcher-slot reach the row called deferred already existed in player/calcs.ts

### `not-a-deferral` - Ordinary English, not a parity claim (32)

- `packages/core/src/game/cave-cmd.ts:956` - Describes the fallback when the traps module is absent, not a missing feature; trap.ts registers the real disarm and session/game.ts:1698 supplies trapDeps
- `packages/core/src/game/context.ts:349` - Prose about why the options store is optional, and it states the fallback is exact; no feature is claimed absent
- `packages/core/src/game/context.ts:848` - Policy prose about an optional seam, not a parity claim, and the policy is honoured: state.combinePack IS supplied by the live session at session/game.ts:899, so only a worldless harness leaves the bit owed
- `packages/core/src/game/gear.ts:1269` - A sentence ABOUT the census, not a parity claim: the docblock explains that the local is named newPile after upstream rather than "deferred", and in saying so it matched the census itself. Left as-is rather than reworded, because the clearer sentence is worth one classified row.
- `packages/core/src/game/notice.ts:16` - Ordinary English ("would defer it by a turn") in prose explaining why ignore must run before combine; no feature is claimed absent
- `packages/core/src/game/notice.ts:50` - Policy prose, and the policy is honoured: state.combinePack is supplied at session/game.ts:899, so leaving PN_COMBINE set describes only an unwired harness. notice.test.ts asserts both halves
- `packages/core/src/game/pickup.ts:16` - Describes the behaviour when the module is not installed; installPickup replaces the stub and is called in the live composition
- `packages/core/src/player/options.ts:28` - Describes how seams read the store, and states the fallback is exact
- `packages/core/src/session/game.ts:1031` - A note about JavaScript declaration order, not a parity claim
- `packages/core/src/session/game.ts:3416` - A note about the mod event flood, not a parity claim
- `packages/web/src/charselect.ts:130` - Describes the shell's own command hook, not a parity claim
- `packages/web/src/main.ts:3736` - Records that a utility is deliberately unbound; nothing upstream is missing
- `packages/web/src/main.ts:5910` - main.ts:5910 merely describes routing a multi-object pile to the floor-list UI; main.ts:5973 calls showFloorList, which is implemented at overlay.ts:304 and exercised at overlay.test.ts:1424-1525.
- `packages/web/src/main.ts:5931` - The word "defer" is ordinary UI-routing prose, not an absence: this branch sets pendingFloorPile at main.ts:5931-5932 and the live caller opens showFloorList at :5973.
- `packages/web/src/main.ts:8475` - A setTimeout, chosen because the fault surfaces inside core
- `packages/web/src/mod-browse.ts:1156` - A variable named `todo`
- `packages/web/src/mod-browse.ts:1158` - A variable named `todo`
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
- `parity/ledger/game-effect-teleport.yaml:67` - A closure record under the ledger's deferred: key - the line's own text says NOT deferred any more, and the five rows it replaces were retired by 027de3e6a
- `parity/ledger/gamedata.yaml:5` - A structural comment about the document layout

<!-- END GENERATED -->
