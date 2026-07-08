# Architecture

## Monorepo layout

| Package | Role |
| --- | --- |
| `@neo-angband/core` | Headless engine: rules, world, entities, effects, generation, saves. Runs anywhere (browser, Node, workers). |
| `@neo-angband/content` | The core content pack: Angband 4.2.6 gamedata compiled into pack format. Pack zero. |
| `@neo-angband/mod-sdk` | Pack schemas, validation, and tooling for the mod ecosystem. |
| `@neo-angband/web` | Web + PWA front-end (v1 target): modern glyph-first renderer. |
| `@neo-angband/cli` | Terminal front-end and dev harness (golden scenarios, stats runs). |
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

## Engine principles

- **No globals.** Upstream's `player`/`cave`/`world` singletons become an
  instantiable game context. Multi-instance by construction.
- **Deterministic, named RNG streams.** Upstream uses one global stream with
  a seed-swap trick for flavors and randarts. The port gives each system a
  named seeded stream (generation, gameplay, flavors, randarts, ...) so
  content is reproducible and saves can serialize exact RNG state.
- **Registries everywhere.** All content - monsters, items, effects,
  generators, objectives - lives in namespaced registries populated by
  packs. The engine ships empty; `@neo-angband/content` fills it.
- **Determinism first, AI optional.** The generator seam has a deterministic
  default. Plugins may replace or augment generation; the engine never
  requires them.
