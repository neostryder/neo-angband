# Architecture

## Monorepo layout

| Package | Role |
| --- | --- |
| `@rpgm-tools/neo-angband-core` | Headless engine: rules, world, entities, effects, generation, saves. Runs anywhere (browser, Node, workers). |
| `@rpgm-tools/neo-angband-content` | The core content pack: Angband 4.2.6 gamedata compiled into pack format. Pack zero. |
| `@rpgm-tools/neo-angband-mod-sdk` | Pack schemas, validation, and tooling for the mod ecosystem. |
| `@rpgm-tools/neo-angband-web` | Web + PWA front-end (v1 target): modern glyph-first renderer. |
| `@rpgm-tools/neo-angband-cli` | Terminal front-end and dev harness (golden scenarios, stats runs). |
| `@rpgm-tools/neo-angband-desktop` | Optional Electron desktop wrapper around the same web bundle. |
| `@rpgm-tools/neo-angband-linoleum` | Linoleum loose-pack tile format: the converter (Node) plus the format readers and portable md5 the web renderer uses. |
| `reference/` | The original C tree at parity baseline 4.2.6, buildable, read-only. |
| `parity/` | Machine-readable provenance ledger mapping port modules to upstream sources. |

## The two seams (inherited from upstream, kept on purpose)

Upstream Angband's core/UI boundary is unusually clean, built on two
mechanisms this port preserves as its public API:

- **Command queue** (upstream `src/cmd-core.c`): front-ends push typed
  commands; the engine consumes them. Nothing else gets input into the game.
- **Event bus** (upstream `src/game-event.c`): the engine publishes typed
  state-change events; front-ends subscribe. The engine holds no UI
  references.

Everything that talks to the engine - the web UI, the CLI, the future Borg,
scripted plugins - speaks through these two seams.

## What changes from upstream (the five chokepoints)

The C original locks behavior behind compiled code. The port dissolves each
chokepoint into data:

1. **Effects** (upstream: ~250 fixed opcodes in `list-effects.h` with C
   handlers): a schema-validated declarative effect language interpreted by
   the engine. Content packs compose conditions, triggers, and outcomes as
   data. The sandboxed script layer covers what declaration cannot.
2. **Player ability flags** (upstream: closed `PF_*` enum with scattered
   checks): abilities become registry-defined behaviors packs can add to.
3. **Name-bound generators** (upstream: `list-dun-profiles.h`, `list-rooms.h`
   binding data names to C functions): generation algorithms register in an
   extensible registry; profiles, room builders, and their parameters are
   pack content.
4. **The parser** (upstream: bespoke per-file grammars writing into fixed C
   structs, hand-ordered load): a schema-driven pack loader with namespaced
   IDs, explicit dependencies, and deterministic merge semantics.
5. **Quests and the win condition** (upstream: hardcoded kill-quest
   semantics in `player-quest.c`): a data-driven objective/trigger system;
   the classic Sauron-then-Morgoth spine is simply the core pack's content.

## Boot: nothing paints the map until there is a game

`packages/web/src/main.ts` builds a real game at module scope — it has to, because
every screen below the title reads from a live `GameState`. That made one thing
very easy to get wrong, and the port got it wrong for months: the shell painted
that game's map immediately, so the player watched a generated town belonging to
a character they had not chosen while boot finished its work behind it. Measured
on the shipped Windows build (2026-08-13) the town was on screen from 6.9s to
12.7s after launch.

Two rules keep it fixed, and both are asserted by tests that read `main.ts` as
text (it cannot be imported — importing it boots a game):

- **`gameScreenLive`** gates `renderBackground()` alongside `modalDepth`. It is
  false until the boot chain settles on a game. The two gates answer different
  questions and neither substitutes for the other: `modalDepth` is *is something
  else using the terminal right now*, `gameScreenLive` is *is there a game to
  draw at all*. An earlier attempt painted the title art first and still lost,
  because a `ResizeObserver` settle came back through `renderBackground` with
  `modalDepth` at 0 and put the map straight back.
- **The loading screen owns the gap** (`packages/web/src/loading.ts`): a dungeon
  carving itself out, everything except the paint being pure functions over a
  seeded LCG so it can be tested without a clock or a canvas. It never draws from
  the game's RNG — it runs before a character exists, and a draw there would move
  a stream position saves re-derive the world from.

Deliberate in-command `render()` calls (targeting, locate, the level map) are
untouched by all of this; only *background* repaints go through the gate.

## Engine principles

- **No globals.** Upstream's `player`/`cave`/`world` singletons become an
  instantiable game context. Multi-instance by construction.
- **Deterministic, named RNG streams.** Upstream uses one global stream with
  a seed-swap trick for flavors and randarts. The port gives each system a
  named seeded stream (generation, gameplay, flavors, randarts, ...) so
  content is reproducible and saves can serialize exact RNG state.
- **Registries everywhere.** All content - monsters, items, effects,
  generators, objectives - lives in namespaced registries populated by
  packs. The engine ships empty; `@rpgm-tools/neo-angband-content` fills it.
- **Determinism first, AI optional.** The generator seam has a deterministic
  default. Plugins may replace or augment generation; the engine never
  requires them.
