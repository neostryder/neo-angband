# Neo Angband

A modern TypeScript port of [Angband](https://github.com/angband/angband),
the classic dungeon-crawling roguelike - holding strongly to its roots while
rebuilding the engine for the web era.

**Status: playable.** The full game runs in the browser, as an installable
offline PWA, self-hosted as a static site, or as a desktop app - see
[how to play and install](docs/INSTALL.md). The mod framework (content packs,
an in-app mod manager, sandboxed and trusted plugins, runtime vocabulary
extension) is feature-complete, and the bundled **Borg** - a faithful port of
Angband's automatic player - rides it as the completeness proof (add
`?agent=borg` to watch it play; see [docs/modding/BORG.md](docs/modding/BORG.md)).
See the [port plan](docs/PORT_PLAN.md) for the roadmap and what remains.

## What this is

- **Full feature parity** with Angband 4.2.6, statistically verified against
  the original C code (which lives buildable in [`reference/`](reference/)
  as the golden-master oracle).
- **Web-first**: play at a URL, installable as an offline PWA. The classic
  multi-terminal-window interface becomes one modern, responsive,
  fullscreen-friendly surface - same keymaps, fully remappable, no terminal
  limitations.
- **Moddable by construction**: the base game is itself a content pack.
  Declarative, schema-validated packs for content; Linoleum-style tile packs
  (individual images, exact targets, honest glyph fallback); sandboxed
  scripted plugins for the exotic. See [docs/MODS.md](docs/MODS.md).
- **Randomization, exploration, replayability**: deterministic seeded
  generation everywhere, a generator seam plugins can extend (including with
  AI backends - none ships here), and a save format built to survive
  procedurally generated and modular content.
- **Headless core**: the engine has no UI dependencies. Browser, terminal,
  desktop shells, bots, and plugins all speak the same command-queue and
  event-bus API the original pioneered.

What it is not: a redesign. V1's enhancement budget is UI-level
quality-of-life only - the game itself stays faithful.

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/core` | Headless game engine (TypeScript) |
| `packages/content` | Angband 4.2.6 gamedata compiled to the core content pack |
| `packages/mod-sdk` | Pack schemas, validation, mod tooling |
| `packages/web` | Web + PWA front-end (v1 target) |
| `packages/cli` | Terminal front-end and dev/stats harness |
| `packages/desktop` | Optional Electron desktop wrapper |
| `packages/linoleum` | Linoleum tile-pack converter (neo-linoleum) |
| `packages/borg` | The bundled Borg autoplayer mod |
| `docs/` | Port documentation (plan, architecture, parity, mods) |
| `parity/` | Provenance ledger mapping port modules to upstream sources |
| `reference/` | The original C tree at tag 4.2.6, buildable, with original docs |

## Development

```sh
pnpm install
pnpm test        # unit tests
pnpm typecheck   # strict TS across all packages
pnpm build
```

## Relationship to upstream

This repository is a fork of [angband/angband](https://github.com/angband/angband),
pinned to the 4.2.6 release as its parity baseline. The
[parity ledger](parity/README.md) maps every ported module to its upstream
source so future upstream releases can be merged deliberately. This is a
community port, not an official Angband project - all honor to the Angband
maintainers and three decades of contributors whose work this builds on.

## Author

Built and maintained by [neostryder](https://github.com/neostryder) at RPGM
Tools. The bundled mods are by the same author: the
[neo-linoleum](docs/LINOLEUM.md) tile packs, the
[qol](docs/modding/QOL.md) quality-of-life tweaks, and the
[bug-fixes](docs/modding/BUG_FIXES.md) bug-fix patch set - all ship as
standalone mods, not as part of the parity core. All honor, as above, to the
upstream Angband maintainers and contributors whose work this builds on.

## License

Dual-licensed under GPLv2 or the traditional Angband license, matching
upstream - see [LICENSE.md](LICENSE.md). Game data derives from Angband;
asset licenses vary (see `reference/docs/copying.rst`).
