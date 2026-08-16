# Parity Methodology

The port targets **behavioral / distributional parity with Angband 4.2.6**
(decision D1 = B). This document defines exactly what that claim covers, what it
does not, and how it is enforced.

## The claim (D1 = B)

With no mod loaded, every rule, formula, table, message, screen layout, key, and
content record behaves as it does in Angband 4.2.6, including upstream quirks and
bugs. Odds and per-level distributions match.

### The standard is GAMEPLAY parity, not code parity (ruled 2026-08-09)

The bar is what a player can observe in play. It is not the shape of the C, and
it never was `bit-for-bit` - that was already false in this document before the
ruling, but the working practice had drifted stricter than the claim. Written
down so it stops drifting back:

- **Refactoring is allowed.** A ported routine may be restructured, simplified,
  merged, split, or made faster, provided the observable behaviour is the same.
  A cited `file:line` provenance is still required; identical control flow is
  not.
- **A different RNG stream is not a defect.** The port already keeps its own
  draw order by design (see below). A change that moves *which* specific values
  a seed produces, while leaving the rules and the distributions alone, is
  accepted. Random is random; the player cannot tell that an extra tick moved
  their seed. What still fails is a change to the *odds* or the *rules*, and
  lane 2 is what measures that.
- **Orphaned upstream code and data may be left out.** Something that no path in
  upstream's own C can reach, and that therefore no player can ever observe, is
  **not part of the port**. That is a finished state, not a deferral - see
  DEFERRALS.md. It must be recorded with the evidence that it is unreachable,
  never merely assumed.
- **The port adds NOTHING.** No content, no features, no conveniences, no
  fixes - those are mods, and that rule is unchanged and absolute. Relaxing code
  parity relaxes *how* the same game is built, never *what* game it is.

#### The two seams a stream change is NOT free on

An RNG change is invisible to a new character and destructive to an existing
one wherever the save stores a **seed** and the game re-derives the world from
it at load. There are exactly two, both verified in `session/game.ts`:

| Seed | Re-derived at load | What a stream change does to a saved character |
| --- | --- | --- |
| `randartSeed` | `doRandart` (`game.ts:3892`) | every random artifact in the game becomes a different item - including ones the character has already found, identified and equipped |
| `seedFlavor` | `flavorInit` (`game.ts:4210`) | every flavour reassigns; the potion the character learned was Cure Light Wounds is now something else |

So: changes to the randart generator and to flavour assignment are stream-locked
across released versions, not because upstream says so but because a player's
character is on the other side of them. Everything else is free. The 834
`randart-vectors.json` rows and the effect-info vectors exist to catch an
*accidental* change on those paths; under this ruling they are a change
detector, not a prohibition, and a deliberate change updates the vectors in the
same commit that makes it.

#### The one place a SEPARATE stream is mandatory

Upstream draws random numbers at *render* time in exactly one place:
`grid_data_as_text`'s hallucination arms, plus the `one_in_(128)` placeholder
block in `map_info` (`cave-map.c:179`, `ui-map.c:41-80`). Those come off the main
RNG, which is safe in a C program whose only repaint trigger is a game event.

It is not safe here. This port repaints on a window resize, on returning from a
menu, on the animation timer and on the level-overview screen — none of which are
game events. Wiring those draws to `state.rng` would make the dungeon a function
of how many times the player resized their window while hallucinating, which is
a change to the *rules*, not merely to the stream.

So `packages/core/src/visuals/hallucination.ts` takes its randomness as an
injected parameter, and the web shell backs it with a display-only `Rng` seeded
from wall-clock entropy and never saved (`main.ts hallucinationRng`). Same
1/128, same rejection loops, same distribution over races and kinds — a
different stream, which the ruling above allows. Hallucination is therefore not
reproducible from a savefile, and nothing in the game depends on it being so.

Anything else that wants randomness at draw time belongs here too, for the same
reason. The rule is: **a draw that a repaint can trigger must not touch
`state.rng`.**

### What that is worth today, measured

Last run 2026-08-01, engine `0.14.0`, at full power:

```bash
NEO_PARITY_RUNS=1000 npx vitest run packages/cli/src/parity-c-stat.test.ts
```

1000 levels per depth from the port against 1000 from the real compiled C
(`main-stats`), depths 1 to 20. **Passes**, at α = 0.01 Bonferroni-corrected
across the family:

| Metric | Shape | Result |
| --- | --- | --- |
| Monster density | mean test per depth (20) | pass; pooled Stouffer Z = 0.59, p = 0.55 |
| Object count | mean test per depth (20) | pass; no depth over \|z\| = 1.6 |
| Ego count | mean test per depth (20) | pass |
| Artifact count | mean test per depth (20) | pass |
| Object level feeling | pooled G, vs a measured C-vs-C null | G/df = **1.29** against a null of mean 1.94, max 2.49 |
| Monster level feeling | pooled G, vs a measured C-vs-C null | G/df = **1.21** against a null of mean 1.82, max 2.21 |
| Gold per level | mean test per depth | pass |
| **Monster species mix** | **printed, never gated** | see below |

The two feeling rows are the ones worth reading twice. The null is not a
chi-square tail - it is fifteen pairs of six independent 1000-run C databases
run through this same instrument, so it says what the statistic does when the
answer is known to be "no difference". The port's 1.29 and 1.21 are **below the
null's mean**: on these metrics the port is closer to the C than two runs of the
C are to each other.

**Species is measured and deliberately not gated**, and that is the honest part
of this table. Pits and nests drop 20-60 monsters of one theme into a level, so
the per-monster counts are 2.5-5x overdispersed and the effective sample size is
the number of levels, not of monsters. Run against ITSELF at a second base seed
the port reaches p = 2e-97, and at depth 13 it is further from itself than from
the C. No threshold on that number means anything. Answering the species
question properly needs a different instrument (one vector per level, a
permutation test over levels) and is open work.

Two more caveats, both structural rather than provisional:

- **The pooled feeling gates only decide at matched sample size.** G grows with
  n for a fixed distributional difference, so the ratio computed at the default
  400 port runs cannot be compared with a null measured between two 1000-run
  samples. Below 1000 those two rows print and do not gate - which is why the
  command above sets `NEO_PARITY_RUNS`.
- **This measures generation.** Messages, screens and keys are lane 4 below;
  formulas are lane 1. A green stats run is not a claim about any of those.

The port is **not** bit-exact against a reference C binary and does not try to
be. It keeps its **own** consistent RNG draw order and named-stream design, so a
given seed produces a different specific dungeon than a stock GCC/MinGW build of
4.2.6 would. A player cannot tell the difference in normal play; only a
side-by-side same-seed replay against the C binary would diverge. What is
guaranteed is the *behavior and the distribution*, not the exact stream.

### Accepted: sibling argument-evaluation order (02 G01/G02)

Upstream C leaves the evaluation order of sibling function-argument draws
unspecified. A stock GCC/MinGW build (which official Windows Angband uses) tends
to evaluate them right-to-left; the port evaluates left-to-right. Under D1 = B
this is **accepted, not a defect**: it shifts which specific values a seed
produces but changes neither the rules nor the distribution of outcomes. We do
not flip argument order to chase a particular compiler's stream.

### Accepted: where the custom-options reader's three `msg()` lines go

`options_restore_custom` reports a bad line in `customized_birth_options.txt` or
`customized_interface_options.txt` with `msg()` (option.c:302, :320, :328).
The port emits all three, and where they land depends on whether there is a game:

- the **in-game** interface options page (`=` → User interface options, `r`)
  routes them to `state.msg`, which is upstream's message line and history
  screen. Same place, same text.
- **at birth**, and inside `options_init_defaults` itself, there is no character
  and no message line drawn yet, so they go to the log only
  (`customPageDefaults`, `packages/web/src/options.ts`). Upstream's `msg()` at
  that moment queues into a buffer nothing has displayed either, so nothing is
  lost that a player was going to read - but the sink is genuinely not the same
  one, which is why it is written here rather than left implicit.

The messages themselves are checked against the C's own format strings, argument
order included, in `packages/core/src/player/options-file.test.ts`.

### RNG neutrality (the hard rule)

The port owns its seed lineage, but that lineage must be **stable and
mod-neutral**:

- With **no RNG-altering mod loaded**, no hook, seam, or guard may add, drop, or
  reorder a single draw versus the base path. A fixed seed run with the mod
  system present-but-empty draws exactly as it does with the mod system absent.
- **Mods may perturb the stream when enabled.** That is their job, and it is
  entirely opt-in: the default install enables zero mods (the faithful no-mod
  base game), and a disabled mod's patches do not exist - its entry point is
  never called, so it contributes no hook, `GameState.modHooks` stays absent, and
  there is no code for them to perturb the stream with.
- **Two hooks are RNG-FREE by contract**, because they run inside the generation
  and object pipelines where one extra draw desynchronises every draw after it:
  `levelGenerated` and `artifactCommit` are handed no `rng`
  (`packages/core/src/mod/hooks.ts`). `walkBlockedByDiggable` is RNG-free on its
  DECLINE path for the same reason. The suite pins this by running generation with
  an all-neutral `ModHooks` installed and asserting the RNG state and the level
  are bit-identical to no hooks at all
  (`packages/core/src/session/qol-defaults.test.ts`).

## Verification lanes

1. **Formula / algorithm provenance (primary, live today).** Every ported
   routine cites its upstream `file:line` and its unit tests assert values
   derived by hand from the C source. This is meaningful parity evidence at the
   algorithm level, bounded by the porter's reading of the C.
2. **Real upstream distribution diff (the parity gate).** Upstream ships a
   Monte-Carlo stats front-end (`reference/src/main-stats.c`, `USE_STATS`,
   SQLite output). The parity gate compiles that C, runs it headless, exports
   its aggregate per-level distributions into the harness `StatsReport` shape
   (`meta.generatedBy = "c-main-stats"`), and diffs the port against **those**
   within a statistical tolerance (distributions/rates, not integers, because
   the streams differ by design). See `packages/cli/README` and the parity
   harness.
3. **RNG-neutrality regression.** A fixed-seed draw-sequence test asserts that
   the no-mod path and the mod-system-absent path are identical (see the hard
   rule above).
4. **Appearance / UI parity (deterministic screen + table diff).** Statistics
   alone cannot catch a wrong glyph, colour, column, or label, so appearance has
   its own deterministic lane, built the same way as lane 2 (a committed
   upstream-captured baseline the port is diffed against):
   - **Static appearance tables** need no runtime and are exact: the colour
     table (`core/color.ts` `COLOR_TABLE` vs `reference/src/z-color.c`
     `angband_color_table` + the `color_translate` matrix), the default keymaps
     (`web/src/keymap.ts` vs `reference/lib/customize/pref.prf`), and the
     user-facing message / format strings.
   - **Screen-grid diff.** The port is bit-exact for a fixed seed (lane 2), so
     its rendered 80x24 grid is fully reproducible. `GlyphTerm.snapshotColored()`
     serializes glyph + CSS colour per cell in the SAME `#rrggbb` form the C
     oracle's `html_screenshot` (`do_cmd_save_screen`, `ui-command.c`) emits, and
     both sides derive from the byte-identical palette, so a cell-by-cell (glyph,
     fg, bg) diff is exact. Canonical screens (birth, character sheet, store,
     inventory, message log, death / tombstone, and a fixed-seed dungeon view)
     are captured once from the C oracle as golden dumps, committed like
     `c-stats-baseline.json`, and the port's fixed-seed render is diffed against
     them. `window.__neo.screenColored()` exposes the live grid for the driver.
   - Oracle-capture caveat: the C screen dump needs a buffer-keeping front end
     (GCU), not `main-test.c` (which drives scripted input but keeps no screen
     buffer).

### Honest status of the harness

Historically the committed statistical baseline was captured **from the port
itself** and compared to fresh port output with zero tolerance. That is a
*self-regression guard* - it catches drift from the port's own last-accepted
behavior - and it is **not** proof of parity with Angband 4.2.6 (a bug shared by
the port and its own baseline passes green). Any port-captured baseline or
golden is labeled as such and must never be cited as upstream-verified parity
evidence. The lane-2 C-vs-TS diff is the only artifact that proves distributional
parity; until a given metric is covered by it, that metric is verified only at
the algorithm level (lane 1).

## The parity ledger (`parity/`)

A machine-readable map from port artifacts to upstream sources:

- every port module records which upstream files/functions it ports, pinned to
  the baseline tag;
- every core-pack record traces to its `lib/gamedata` origin;
- coverage is auditable: unported upstream modules are visible by absence.

The ledger serves two masters:

1. **Parity audit now** - "what does this port and where did it come from."
2. **AI-assisted rebasing later** - when upstream cuts a new release, diff
   upstream, map changed files/functions through the ledger to affected port
   modules, and generate a migration worklist.

## Tolerances

Distribution comparisons (lane 2) use fixed-seed batches large enough that
agreed per-metric tolerances (documented per check in the harness) distinguish
real behavioral drift from sampling noise. Any check that fails blocks merge.

## Behaviour that reads as a bug and is not

Some of 4.2.6's behaviour looks broken to a player. Core keeps it. This list is
short on purpose - each row is here because it was reported from play and closed
against the C, so the next report can be answered in one line instead of
re-investigated. A row here is a candidate for the `qol` mod, never for core.

| Reported as | Actually | Evidence |
|---|---|---|
| Town floors are **black** at night, not faded | `cave_illuminate(c, false)` calls `square_forget` on every non-bright floor grid, so a town floor at night is *unknown*, not dim. Walls and shop doorways stay memorized, which is why the outline survives. | `cave-map.c` `cave_illuminate`; `map_info` draws `FEAT_NONE` for `!square_isknown` |
| The **target survives** the monster leaving sight | Upstream keeps the target set and re-acquires it when the monster returns to view. Nothing fires at an unseen monster: every aim path re-checks `target_okay`, which needs `monster_is_obvious` and `projectable`. | `target.c:110` `target_able`, `:124` `target_okay` |
| **Birth options are not remembered** | They are, but only after an explicit save. 4.2.6 writes `customized_birth_options.txt` from the `s` key on the options page; nothing writes it automatically. The next character's birth screen opens on that file. A file that was hand-edited and no longer parses now says so, in 4.2.6's own words. | `ui-options.c:170` (`s` → `options_save_custom`), `option.c:171`, `:225-333` |
| A **cutpurse never steals** | `EAT_GOLD` has `power: 0` in `blow_effects.txt`, so its `check_hit` chance is `0 + level*3` - a depth-2 cutpurse lands the theft touch about **12%** of rounds against AC 16, and the victim then saves on `adj_dex_safe[DEX] + level`. At 18/20 DEX and level 8 that is a 23% save, so ~9% of rounds actually cost gold. | `mon-blows.c` `melee_effect_handler_EAT_GOLD`, `player-attack.c` `hit_chance`, `player-calcs.c:640` `adj_dex_safe` |
| A **stunned monster still attacks on the same turn** | Stun is not a stunlock in 4.2.6. A stunned monster misses its turn only `one_in_(STUN_MISS_CHANCE)` = 1 time in 10; otherwise it acts with its to-hit cut by `STUN_HIT_REDUCTION` (25%) and its blow damage by `STUN_DAM_REDUCTION` (25%). All three are ported: `combat/hit.ts:25,:28`, applied at `combat/mon-melee.ts:219` and `:1290`, `game/mon-cmd.ts:370`, and the turn-miss roll at `game/monster-turn.ts:194,:1759`. Landing a stun and then being hit is the common case, not a failure. | `mon-move.c:1826-1836` `monster_turn_should_stagger`, `mon-attack.c:354`, `:622` |
| **Wormtongue cackles and no traps appear** | `TRAPS` is `effect:TOUCH:MAKE_TRAP:3` with no dice - a radius-3 ball on the player, and each grid is `one_in_(4)` *and* must be an empty, trapless floor. The player's own grid never qualifies. Zero traps from one cast is ordinary. | `project-feat.c` `project_feature_handler_MAKE_TRAP` |

## Definition of "done"

There is no single "100% done" flag for parity - it is a standing property. A
finding is closed only with three things: the upstream C `file:line`, a
live-path trace proving the code runs in play (exported-and-unit-tested is not
proof it is wired), and a regression test that would fail if the fix were
reverted.
