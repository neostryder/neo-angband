# The Borg (first-party autoplayer mod)

The Borg is Neo Angband's automatic player: a faithful TypeScript port of
Angband 4.2.6's `borg` that plays the game on its own. It is a MOD, not part of
core, and it is the completeness proof for the whole mod framework - it drives the
real game through the same frozen perceive/act agent API any third-party or AI
agent uses, with no privileged engine access.

## What it is

It lives in its own repository,
[neo-angband-mod-borg](https://github.com/neostryder/neo-angband-mod-borg), with
its own release tags and its own test suite, and it installs through the mod
manager like any other mod. Nothing about it is compiled into the game.

The Borg is the flagship consumer of the agent seam (`AGENT_API_VERSION`, frozen
at 1.x and add-only, `packages/core/src/agent/types.ts`):

- **PERCEIVE** - it reads the world only through `AgentView` (the read-only,
  serializable view facade), folding what it can see into its own remembered
  map, monster list, and object list (a faithful fog-of-war world model, not
  omniscient state reads).
- **ACT** - it issues commands only through `AgentActions` (the semantic verb
  builders), exactly as a human's keypresses would.
- **DECIDE** - the ported `borg_think_dungeon` priority ladder runs every turn:
  avoid death, attack, gather, flow, explore, descend - the original's logic,
  transcribed with its thresholds intact.

It is **deterministic**: its dry-run combat simulations draw from a private RNG,
so it never perturbs the game's RNG and the save's determinism ratchet stays
untripped. A Borg run is replayable.

## How to run it

Three steps, and the third is separate from the second on purpose.

1. **Install it.** Escape menu -> **Mods** -> *Install a mod...*, pick **The
   Borg** from the recommended list, press Enter.
2. **Enable it**, then choose *Apply changes and reload*. The mod is now loaded
   and has done nothing to your character.
3. **Hand it the keyboard.** On the Borg's own screen, switch on **Let the Borg
   play** (`borg.autoplay`, off by default). It takes over from the next turn.

Beyond that one switch, the same screen carries eight further toggles mapped to
upstream's `borg_cfg[]` settings, covering risk tolerance and the five
gear-weighting priorities among others, each defaulting to upstream's own
value. The mod's own README lists all eight and what each one changes.

Installing a mod and giving away the keyboard are different decisions, which is
why they are different switches. Only one autoplayer can hold the keyboard at a
time: if a second mod also declares a controller, the host refuses it by name and
says which one is already playing.

Once the Borg holds the keyboard, its own Fixes & tweaks screen (Mods -> The
Borg) grows an **Autoplayer speed** row beside `borg.autoplay`: Fast, Normal
or Slow, matching the debug agent seam's own tiers below. It takes effect at
once, no reload.

It plays the same on every surface - browser, PWA, static self-host, desktop -
because it arrives by the same route on all of them.

### `?agent=` is a different thing

The URL parameter `?agent=<id>` runs an agent **compiled into the build**, and
the only one there is `demo-wanderer`, a few lines that walks in a circle. The
port ships no built-in autoplayer, so `?agent=borg` matches nothing. The
parameter is useful for exercising the controller seam without installing
anything, and `?speed=fast|normal|slow` or a raw interval in milliseconds (10 to
5000, default 120) sets its tick rate.

## Fidelity and current limitations

The decision logic - danger evaluation, the `borg_power` fitness function, BFS
pathfinding, the think ladder, combat/defense/escape, item and store decisions -
is ported behavior-faithfully from `reference/src/borg`, each subsystem carrying
golden-value tests derived from the C.

Because the frozen `AgentView` is a deliberately minimal contract, a few engine
internals are supplied to the (trusted, in-process) Borg by the host rather than
read from the view. Where a datum is not yet wired, the Borg degrades to a
faithful conservative default rather than guessing:

- **Monster race data** (blow dice, spell frequency, spell power) is wired from
  the live monster registry through `makeCoreResolvers`, so danger sensing is
  exact - and a mod's monsters are read by the same lookup as core's.
- **Artifact activation identity** and the **in-shop signal** are wired too. The
  Borg can tell whether a worn item grants a named activation and whether it is
  charged, by walking the item's artifact, ego or kind back to the `Activation`
  record that grants it - the same precedence `obj-make.c` applies. It can tell
  which shop it is standing in, which is what lets the town-flow ladder's
  shop-interaction steps fire at all.
- **Hypothetical-loadout power deltas** are wired from 0.25.0. The wear, buy and
  sell paths all decide by comparing `borg_power` now against `borg_power` with a
  candidate worn, bought or sold, and none of them had a way to compute the
  second number: the frozen view describes the gear the character HAS. It now
  asks the engine, through `view.simulateLoadout`, which re-runs `calc_bonuses`
  over a hypothetical set of worn objects; the Borg then runs the ported
  `borg_notice` and `borg_power` over the answer, which is the wield / recompute
  / revert shape upstream uses. A mod's items are scored on the same terms as
  core's, because what comes back is ordinary `ItemView`s and the scoring reads
  their properties rather than their provenance.

- **The attack-message table** is wired from `registries.monsters.blowMethods`.
  Upstream builds its `suffix_hit_by` list from the same records at start-up, and
  it is how the borg recognises that something just hit it. Without it a blow
  from a monster the Borg cannot see raises no regional fear, and regional fear is
  the only thing upstream has that stops a borg resting through a beating. A mod's
  own blow method is recognised on the same terms.

- **What an object kind is worth, and whether the character knows the flavour**,
  from `registries.objects` and `state.isAware`. Upstream prices every object it
  can see on the floor at its kind's shop value, or at 1 while the flavour is
  unidentified, and every rung that walks to an object skips anything priced at
  zero or less. A Borg without the price sees a floor of worthless things and
  collects none of them. A mod's own object is priced by the same lookup.

The mod declares an engine range rather than degrading: a Borg missing any of the
above is not a Borg with a feature switched off. Its own `PLANNED.md` is where
this list is kept current, since the mod ships on its own schedule, and it also
names what is not ported at all - the detection scheduler is the largest piece.

## The host answers blocking prompts for an autoplayer

An `AgentController` returns a `PlayerCommand`, and "dismiss this message" is not
one. Meanwhile the shell has places that block for a keypress: the `-more-` pager
between two screenfuls of messages, the forced `-more-` a level change puts in
front of the stair message, the floor-item list on a pile of two or more, the shop
screen, a yes/no confirm. Each of those raises the modal gate, and the autoplayer
clock used to skip every tick while it was up - so descending needed a human to
press a key, and the run stopped there until somebody did.

**So the host presses the key itself.** While an autoplayer holds the keyboard and
a modal is open on a live game screen, the pump feeds one ESCAPE through the same
input door every real keystroke goes through, and logs that it did. That is
upstream Angband's own mechanism in this shell's terms: its borg installs itself
as the hook `inkey()` consults for EVERY key the game reads, sees the `-more-` on
the message line before it thinks about a move at all, and answers it with a space
(`borg.c:371-388`). A blocking prompt was never something upstream's borg waited
out.

Three things follow, and an author driving a controller should know all three:

- **ESCAPE, not a per-prompt answer.** Any key satisfies the pager, and ESCAPE is
  what closes an overlay and reads as "no" at a confirm - which is what upstream's
  borg answers to "Die?" (`borg-messages-react.c:133`). A controller cannot choose
  a different answer, and does not need to: a decision the autoplayer should be
  making arrives as a command it returns, not as a prompt it dismisses.
- **Nothing is answered before there is a game.** Character creation owns the
  terminal, and a mod's 120ms clock does not get to answer for the player rolling
  a character.
- **The shop screen closes rather than opening.** An autoplayer that steps onto a
  shop door gets the screen dismissed, because that screen is a UI for a human.
  Trading is `shopBuy` / `shopSell` / `shopExit` on the act facade.

## For mod authors

The Borg is the reference implementation for building your own agent: an
`AgentController` is just `(view, act) => AgentCommand | null`, and a mod offers
one from `ModPlugin.controller` (see `PLUGINS.md`). The
`neo-angband-mod-borg` repository is the large worked example;
`packages/web/src/agents/demo.ts` is the minimal one. A controller requires the
`command:add` capability in the manifest, because a controller that cannot act is
not a controller. Because the contract is frozen and capability-gated, the same
shape runs in-process (like the Borg) or sandboxed in a Web Worker.
