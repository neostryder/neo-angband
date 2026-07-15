# The Borg (bundled autoplayer mod)

The Borg is Neo Angband's built-in automatic player: a faithful TypeScript port
of Angband 4.2.6's `borg` that plays the game on its own. It ships as a bundled
mod and is the completeness proof for the whole mod framework - it drives the
real game through the same frozen perceive/act agent API any third-party or AI
agent uses, with no privileged engine access.

## What it is

The Borg is the flagship consumer of the agent seam (`AGENT_API_VERSION 1.0.0`):

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

The Borg is an in-process agent, enabled with a URL parameter (it boots straight
into play with the default character - no manual character creation):

```
https://<your-host>/?agent=borg
```

### Speed

Borgs are configurable-speed and **fast by default**. Add `?speed=`:

| Value | Interval | Use |
| --- | --- | --- |
| `fast` (default) | 40 ms/turn | watch it rip through a level |
| `normal` | 120 ms/turn | follow its decisions |
| `slow` | 400 ms/turn | study one move at a time |
| a number (10-5000) | that many ms | custom |

Example: `?agent=borg&speed=slow`.

It plays identically on every surface (browser, PWA, static self-host, desktop),
since the Borg is part of the same bundle.

## Fidelity and current limitations

The decision logic - danger evaluation, the `borg_power` fitness function, BFS
pathfinding, the think ladder, combat/defense/escape, item and store decisions -
is ported behavior-faithfully from `reference/src/borg`, each subsystem carrying
golden-value tests derived from the C.

Because the frozen `AgentView` is a deliberately minimal contract, a few engine
internals are supplied to the (trusted, in-process) Borg by the host rather than
read from the view. Where a datum is not yet wired, the Borg degrades to a
faithful conservative default rather than guessing:

- **Monster race data** (blow dice, spell frequency, spell power) - wired from
  the live monster registry via `makeCoreResolvers`, so danger sensing is exact.
- **Artifact activation identity** and the **in-shop signal** - currently on
  their conservative defaults (no artifact-activation attacks; town shopping is
  driven by flow-to-shop rather than in-shop interaction). Wiring these is a
  follow-up.
- **Hypothetical-loadout power deltas** - the wear/swap/buy/sell paths use a
  conservative "no gain unless proven" default, because scoring a hypothetical
  inventory would require re-deriving the self-model on a loadout the frozen view
  cannot represent. The Borg fights, flows, heals, and dives faithfully; only its
  gear/shopping optimization is cautious until a loadout evaluator is added.

None of these limits stop the Borg from playing a full game; they bound how
aggressively it optimizes edge decisions.

## For mod authors

The Borg is the reference implementation for building your own agent: an
`AgentController` is just `(view, act) => AgentCommand | null`. See
`packages/borg` for a large worked example and `packages/web/src/agents/demo.ts`
for a minimal one. Because the contract is frozen and capability-gated, the same
shape runs in-process (like the Borg) or sandboxed in a Web Worker.
