# Neo Angband Port Plan

Status: ratified 2026-07-07; amended 2026-07-08 (decisions 13-15: total
moddability guarantee, beyond-parity systems, networking seam; decisions
16-21: saves and anti-cheese, scope discipline, everything-new-is-a-mod
plus bundled mods, mod lifecycle and uninstall recovery, AI-first SDK,
and the boot/HUD/settings UX). This is the governing plan for the port;
changes land here first.

## What this is

Neo Angband is a modern TypeScript port of [Angband](https://github.com/angband/angband),
holding strongly to its roots: full feature parity with the original, verified
statistically, plus a small set of deliberate enhancements. The focus is
randomization, exploration, and replayability.

The original C tree lives intact and buildable under `reference/` (parity
baseline: the `4.2.6` release tag). It is the golden-master oracle the port is
verified against. Original documentation stays under `reference/docs/`; port
documentation lives here under `docs/`.

## Ratified decisions

1. **Core stack**: a headless TypeScript engine (`@neo-angband/core`) that runs
   in browsers, Node, and wrapped desktop shells. No globals: the game is an
   instantiable context, multi-instance by construction.
2. **Parity bar**: feature parity with 4.2.6, statistically verified via
   distribution diffs against the C stats harness plus scripted golden
   scenarios. Not bit-exact; old savefiles do not import (an importer may come
   later).
3. **V1 target**: web + PWA. The classic multi-terminal-window interface is
   replaced by one modern, responsive, fullscreen-friendly surface. Classic
   keymaps preserved, fully remappable. Desktop (Tauri) and terminal builds
   follow from the same headless core.
4. **Enhancement budget for v1**: UI-level quality-of-life only (message log,
   searchable knowledge, item comparison, recaps). Zero rules changes.
   Refined by decision 18: these QoL enhancements ship as a BUNDLED QoL
   mod, not baked into core. Core stays pure parity; the QoL mod is on by
   default and fully removable.
5. **Behavior model**: declarative-first. Effects, abilities, and generation
   parameters are schema-validated data interpreted by the engine; a
   capability-scoped sandboxed scripting layer is the escape hatch for exotic
   behavior. This dissolves the C original's compiled-opcode chokepoints.
6. **Mod ecosystem**: everything loads as packs with namespaced IDs
   (`core:kobold`). The base game itself is pack zero. Tile packs follow the
   Linoleum model: manifest, individual images, exact named targets, honest
   glyph fallback. See `docs/MODS.md`.
7. **AI seam**: the engine defines a content-generator interface with a
   deterministic implementation. No AI provider ships in this repository;
   plugins fill the seam. Deterministic procgen is always first-class and the
   game never depends on AI.
8. **Persistence**: classic regenerate-on-stairs is the default; persistent
   levels are a first-class supported birth option. The save format treats
   both as equal citizens.
9. **Saves**: versioned, schema-validated, compressed JSON. Embeds the active
   pack manifest and per-entity content provenance, and serializes named RNG
   streams. Designed to survive modular and procedurally generated content.
10. **Dev tooling parity**: wizard/debug mode (early, it aids testing),
    spoiler generation, the stats harness (load-bearing for parity), and the
    Borg (phased last).
11. **License**: the upstream dual GPLv2-or-Angband-license statement is
    retained. See `LICENSE.md`.
12. **Upstream tracking**: the parity/provenance ledger (`parity/`) maps every
    port module to its upstream source so future upstream releases can be
    diffed, triaged, and merged with AI assistance.
13. **Total moddability guarantee** (ratified 2026-07-08): moddability is
    first-class over EVERY aspect of the game, not just the record types the
    base data happens to ship. Mods can add, patch, replace, and remove:
    terrain types, room templates, vaults, dungeon profiles, artifacts,
    objects, egos, monsters, classes, races, shops, effects, and any other
    registry the engine holds - and can introduce genuinely NEW capabilities
    that do not exist in the base resources (new effect opcodes, new commands,
    new UI panels, new record types with their own schemas). Concretely: every
    engine registry accepts runtime registration; behavior dispatch goes
    through handler registries keyed by string (never closed enums); the base
    game exercises the same surfaces it offers to mods. The moddable-surface
    matrix in `docs/MODS.md` is the checklist and each engine module is held
    to it in review.
14. **Beyond-parity systems** (ratified 2026-07-08): the engine grows three
    systems the original never had, built mod-first (the base game is just
    their smallest consumer): a world-NPC system (placeable characters with
    interactions and branching dialog, data-driven; upstream shopkeepers
    become its first users), a quest engine (declarative objectives,
    triggers, stages, and rewards; upstream's Sauron/Morgoth win condition is
    its first content), and moddable shops (inventory tables, pricing,
    services, and shopkeeper behavior as data + handlers). These are additive:
    the parity bar (decision 2) is measured with none of them active beyond
    upstream behavior. SUPERSEDED by decision 22 (2026-07-08): core does NOT
    ship NPC/dialog/quest/shop systems OR their feature-specific seams. These
    are built entirely by mods on the GENERIC extension surface (command
    queue, event bus, string-keyed registries, the sandboxed plugin API,
    per-mod save namespaces, render hooks). The upstream town, shops, and the
    Sauron/Morgoth win condition remain in core only as PARITY content, and
    are themselves implemented through the generic moddable surfaces so a mod
    can override or overhaul them. The engine's obligation is that its
    extensibility is powerful enough to build these systems - and full system
    overhauls - from mod space, not to pre-provide them.
15. **Networking is a mod, not a core seam** (ratified 2026-07-08; amended
    2026-07-08 per decision 22): the port ships NO networking, and NO
    networking-specific session interface in core. The serializable command
    queue and the event bus (the engine's public I/O API) are general-purpose
    and already enough for a mod to build networking - leaderboards, save
    sync, spectating/replays, cooperative or competitive variants - on top.
    Because those seams are generic, a networking mod is not privileged; it is
    an ordinary plugin. Local-first, offline single-player is the whole port;
    everything networked is mod space.
16. **Saves and anti-cheese** (ratified 2026-07-08; amended 2026-07-08 with
    the determinism analysis of decision 22; previously tracked as 16/16b):
    no save-scumming, faithful to the original. The anti-scum mechanism is
    what the original actually uses, ported faithfully - NOT whole-game
    determinism and NOT the hash: (a) the full RNG state is persisted in the
    savefile (upstream `wr_randomizer`: `Rand_value`, `state_i`, and the
    `STATE[]` array), so reloading resumes the exact stream and reload-retry
    of the same action gives the same outcome - you cannot reroll by
    reloading; (b) a single savefile overwritten in place, terminal death, no
    restore-points. The injectable whole-file digest (FNV-1a default) is a
    separate, weaker thing: a DETERRENT against casual hand-editing, honest
    about its ceiling (a client-side verifier ships in the bundle). The one
    hole the original also had - copying the savefile (here, the IndexedDB
    record) before a risk and restoring it - is closable only by a
    server-authoritative save, which is a networking MOD (decision 15). Mods
    may relax or replace any of this (decision 18); nondeterministic mods
    weaken reload-reroll protection within their own domain by their own
    choice (decision 22). Multiple characters are supported: the
    single-overwritten-save rule is PER CHARACTER, and many characters coexist,
    each with its own save (and its own determinism mode, decision 22) -
    exactly as the original, whose roster is many characters each with one
    savefile. Maintaining several characters is not save-scumming. See
    `docs/modding/MOD_LIFECYCLE.md`.
17. **Scope discipline: direct port first** (ratified 2026-07-08): the port
    reproduces Angband 4.2.6 faithfully before anything else. Core contains
    exactly two things - faithful parity behavior, and the mod architecture
    (registries, composition, sandbox, save namespacing, the SDK). Nothing
    else lands in core.
18. **Everything-new-is-a-mod, and bundled mods** (ratified 2026-07-08):
    except for the mod architecture itself, every new feature, behavior, or
    visual - including beyond-parity systems (decision 14) and the v1 QoL
    budget (decision 4) - ships as a mod, never baked into the port.
    Official mods are BUNDLED with the port and enabled by default, each a
    separate standalone pack and fully removable on its own: **neo-linoleum**
    (the tile packs; formerly treated as an in-core feature - see decision 26)
    and a **QoL mod** (UI-level quality-of-life); the `bug-fixes` mod (decision
    24) is a third. They are never combined into one pack. Cheaty mods are
    explicitly permitted: a mod
    may add, patch, replace, or remove anything - up to and including the
    rules that make the game Angband or even a roguelike. The engine warns
    and labels; it does not forbid.
19. **Mod lifecycle and uninstall recovery** (ratified 2026-07-08): ratifies
    the six decisions in `docs/modding/MOD_LIFECYCLE.md` - string-id (not
    index) save serialization; namespaced per-mod save blocks with
    quarantine-on-uninstall; field-level patch composition with
    last-in-load-order-wins; save-bound, shareable profiles; and a
    pre-migration snapshot as operational safety - with one change per
    decision 18: the determinism guard is a WARNING plus a
    non-reproducible/non-shareable label plus an opt-out, not a bar on
    state-affecting mods. Graceful recovery is required: a character
    stranded in mod-generated terrain when that mod is uninstalled is
    returned safely to town; mod-owned items are quarantined to the
    player's home and made inert until the mod is reinstalled; and a
    player-facing stash view shows everything quarantined by an uninstall or
    shadowed by another mod's override.
20. **AI-first SDK** (ratified 2026-07-08): the modding SDK is designed to be
    highly accessible to AI coding agents as well as humans - machine-
    readable schemas, a generated schema/registry reference, copy-pasteable
    worked examples, a single-file agent context document, and validation
    errors that point precisely at the fix. An agent should be able to
    author a valid, working mod from the documentation alone.
21. **Boot and UI shell** (ratified 2026-07-08; amended 2026-07-08):
    `bootLevel` drives the app during development now; the shipping build
    opens on a TITLE SCREEN with an option to autoload a run already in
    progress. The HUD stays faithful to the original, while the rendered play
    area fills the entire viewport at any size or aspect ratio. Menus and
    settings are recreated in each platform's NATIVE idiom (as is the nature
    of a port): the original presents them through the terminal UI, so each
    front-end rebuilds them natively - a modern, ergonomic web UI in the web
    build, native menus in a desktop shell, touch controls on mobile - rather
    than one shared cross-platform GUI. The headless core (decision 1) stays
    UI-agnostic; each shell owns its own presentation. Input, too, is
    abstract enough for alternative schemes (gamepad or touch, for example).
22. **Determinism scope: faithful, not absolute** (ratified 2026-07-08). What
    the original does, verified in the reference source: a seeded PRNG whose
    FULL state is saved with the game (`wr_randomizer`), plus fixed
    `seed_flavor`/`seed_randart` for consistent colors and randarts. It does
    NOT record a command stream and is NOT reproducible from a single
    start-seed across a playthrough. So Angband uses LOCAL determinism
    (reload resumes the exact stream), not whole-game reproducibility. The
    port matches that and no more:
    - Unmodded, and mods that stay on the engine's seeded RNG: deterministic
      in the faithful sense. As a free bonus over the original, the start
      seed is exposed so an unmodded run is reproducible and shareable.
    - Modded: determinism is PRESERVED BY DEFAULT and degraded only when
      forced. A mod that uses wall-clock, its own randomness, a network, or an
      external agent - and ANY add/remove/update of mods mid-game - breaks
      reproducibility-from-seed. When that happens the game does not simply
      shrug; a core-governed save determinism mode (below) records it,
      seamlessly and irreversibly.
    - Save determinism mode (a CORE mechanism, not a mod concern; amended
      2026-07-08). Every save carries a mode that core owns and
      enforces regardless of which mods are loaded:
        * DETERMINISTIC - the default. A character born unmodded (or with only
          deterministic mods) is deterministic in the faithful sense, and its
          start seed is exposed as a reproducible/shareable bonus.
        * NONDETERMINISTIC - the seamless alternative. The first time a
          determinism-affecting mod is enabled on a save, core flips it to
          this mode IRREVERSIBLY. Removing the mod later never restores
          deterministic mode (a one-way ratchet), so a save cannot be tainted
          and then "cleansed" to reclaim guarantees it lost. The transition is
          seamless: a one-time notice, then normal play.
      This lives in core so it governs save behavior no matter what mods do:
      mods can TRIGGER the flip but can never reverse or prevent it. It is
      distinct from the save-scum GAMEPLAY policy (decision 16), which a mod
      may relax; the determinism mode is integrity metadata, not a rule.
    - Anti-scum (decision 16) holds in BOTH modes for core mechanics, which
      always draw from the saved seeded stream. A nondeterministic mod only
      re-opens reload-reroll within its own mechanics, by its own choice.
    - Conclusion: determinism is the retained default, not a casualty of
      modding. The only thing a nondeterministic mod costs is the optional
      shareable-seed reproducibility, and that cost is recorded honestly and
      permanently on the save.
23. **Release certification** (ratified 2026-07-08): the definition of done is
    CERTIFIED FULL FEATURE PARITY with Angband 4.2.6 (decision 2). The ONLY
    permitted differences from the original are: (a) unavoidable port
    artifacts (the web/TypeScript platform, the single responsive surface, the
    save format); (b) the mod system itself; and (c) minor variations the
    maintainer has explicitly approved, each logged as a decision here. Anything not on
    that approved-variation list must match the original. At release the two
    bundled mods (neo-linoleum, QoL) are complete and default to active.
    Certification is measured by the parity harness (decision 2, docs/
    PARITY.md) plus a checklist of the approved variations.
24. **Upstream tracking and the bug-fix mod** (ratified 2026-07-08): the port
    tracks upstream by TAGGED RELEASE, not tip-of-tree. The baseline is the
    4.2.6 tag and core stays faithful to it; we do NOT cherry-pick post-tag
    commits, merged PRs, or issue fixes into core, because that makes core
    diverge from the tag and turns every future upstream re-sync into a rebase
    over local patches. Instead, all such fixes ship in a single BUNDLED "bug
    fixes" mod (the model players know from the Skyrim/Bethesda unofficial
    patches): crash, data-corruption, save/load, determinism, and clear
    logic-error fixes drawn from post-tag commits, PRs, and issues. The mod's
    documentation MUST cite, directly and explicitly, every upstream commit
    SHA, PR number, and issue number it patches. Any bug our own port code has
    already "fixed" relative to the tag is likewise moved OUT of core and INTO
    the bug-fix mod, so core remains a faithful reproduction of the tag (bugs
    included) and the fixes stay opt-in. Balance and subjective changes are
    NOT bug fixes; they belong in the QoL mod (decision 18) or their own mod.
    This is decision 18 applied to upstream drift: everything-new-is-a-mod,
    including upstream's own later fixes. The mod's design of record and
    referenced changelog live in docs/modding/BUG_FIXES.md.
25. **No unapproved simplifications; upstream-faithful configuration**
    (ratified 2026-07-08): reinforcing decisions 2 and 23, any place the port
    took a modeling shortcut that changes configured behavior from the 4.2.6
    tag is a defect to close, not an accepted variation. Concretely, the
    earlier "everything known" convention (treating the object-knowledge rune
    mask as all-ones so item modifiers applied immediately) is REVOKED: runes
    are UNKNOWN by default exactly as upstream, and an item's pval modifiers
    stay inert until their rune is learned. The faithful counterpart is that
    wearing an item learns its modifier runes at once (obj-knowledge.c
    object_learn_on_wield, ported in obj/knowledge.ts), so a worn +N modifier
    applies immediately and its rune is discovered in the same step; resists
    and combat bonuses apply to the real state regardless of knowledge and are
    learned by use. Every default and initial-state value the port ships must
    match the original's; deviations require an explicit approved-variation
    decision here.
26. **Linoleum is a standalone tiles mod** (ratified 2026-07-08): Linoleum is
    not part of the upstream 4.2.6 tag, so it exists ONLY as a mod, never in
    the parity core. It ships as its own standalone `tiles`-shape pack (id
    `linoleum`), independent of and never combined with the QoL or `bug-fixes`
    mods. Each bundled mod (decisions 18, 24) is a separate pack, installable
    and removable on its own; `packages/linoleum` is the build-time converter
    that produces the Linoleum tile pack, not an in-core feature.

## Phases

Each phase ends in something verifiable. Vertical slices over horizontal
completeness where possible.

- **P0 - Bootstrap** (this phase): fork, `reference/` restructure, monorepo
  scaffold, CI, parity ledger scaffolding, this plan.
- **P1 - Foundation**: RNG (named streams, seeded), dice/expression language,
  flags, the gamedata compiler (`reference/lib/gamedata/*.txt` to core pack),
  pack schemas.
- **P2 - World kernel**: grid/chunk model, FOV, the full level generation
  pipeline (profiles, rooms, vaults, tunnels), stats harness with
  generation-parity distribution checks.
- **P3 - Entities**: objects, monsters, player systems, the effect
  interpreter, combat, character birth. Wizard mode arrives here.
- **P4 - Game loop**: turn/energy engine, command queue, event bus, saves,
  town and stores, quests and the win condition (data-driven objective
  system).
- **P5 - Web UI**: glyph renderer, responsive single-surface layout, keymaps,
  PWA packaging, IndexedDB saves with export/import. The presentation logic
  behind every classic panel (sidebar, character sheet, monster/object lists,
  monster lore, map, knowledge, options) is ported as engine-computed data;
  only the terminal draw layer is what the web surface replaces. Sound
  (`sound-core.c` event-to-sound mapping, played by the web audio backend that
  replaces `snd-sdl.c`) and tile graphics (`grafmode.c` + `ui-visuals.c`, with
  ASCII the default exactly as upstream) are in scope and essential, not
  optional extras. Per decision 23 the only permitted differences from 4.2.6
  are the platform/surface, the save format, and the mod system; every other
  subsystem - sound, graphics, wizard/debug, the Borg - is ported.
- **P6 - Parity closure**: full statistical verification against the C
  baseline, golden scenario suite, UI QoL features, documentation.
- **P7 - Mod ecosystem hardening**: sandboxed scripting, pack tooling,
  Linoleum tile-pack support, AI-seam documentation, sample mods, the
  moddable-surface matrix audit (decision 13), and the modding SDK
  documentation set (`docs/modding/`).
- **P8 - Borg**: a faithful port of the automatic player, packaged as a
  BUNDLED MOD on the mod framework's perceive/act agent API rather than as
  in-core code. It is the reference implementation and acceptance test of that
  API - the most demanding "read the whole game, drive every command" consumer,
  so a Borg that plays faithfully proves the agent surface is complete. The
  same API hosts any third-party or AI-driven agent mod. Depends on the P7 mod
  substrate. Full scope and plan: `docs/BORG_AS_MOD.md`.
- **P9 - Beyond parity**: the NPC/dialog system, quest engine, moddable
  shops (decision 14), and the networking session seam (decision 15).
  Design docs and registry stubs may land earlier wherever they cheaply
  shape architecture (for example shops in P4 built on the shop registry),
  but parity closure (P6) never depends on P9 features.

## Working conventions

- The two seams the original got right survive as the engine's public API:
  the typed command queue (input) and the event bus (output).
- Every ported module records its upstream provenance in `parity/`
  (see `docs/PARITY.md`).
- `reference/` is read-only except for build artifacts; upstream fixes are
  cherry-picked deliberately, never ad hoc.
