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

Installing a mod and giving away the keyboard are different decisions, which is
why they are different switches. Only one autoplayer can hold the keyboard at a
time: if a second mod also declares a controller, the host refuses it by name and
says which one is already playing.

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
- **Hypothetical-loadout power deltas** are the one that is still on its
  conservative default. The wear/swap/buy/sell paths assume no gain unless it is
  proven, because scoring a hypothetical inventory needs the self-model
  re-derived on a loadout the frozen view cannot represent - a core capability
  that does not exist yet. The Borg fights, flows, heals, shops and dives
  faithfully; only its gear *optimization* is cautious.

The mod's own `PLANNED.md` is where this list is kept current, since the mod
ships on its own schedule. None of it stops the Borg playing a full game; it
bounds how aggressively it optimizes edge decisions.

## For mod authors

The Borg is the reference implementation for building your own agent: an
`AgentController` is just `(view, act) => AgentCommand | null`, and a mod offers
one from `ModPlugin.controller` (see `PLUGINS.md`). The
`neo-angband-mod-borg` repository is the large worked example;
`packages/web/src/agents/demo.ts` is the minimal one. A controller requires the
`command:add` capability in the manifest, because a controller that cannot act is
not a controller. Because the contract is frozen and capability-gated, the same
shape runs in-process (like the Borg) or sandboxed in a Web Worker.
