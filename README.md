# Neo Angband

A modern TypeScript port of [Angband](https://github.com/angband/angband),
the classic dungeon-crawling roguelike - holding strongly to its roots while
rebuilding the engine for the web era.

> ## Status: ALPHA - and we would like you to break it
>
> The whole game is playable start to finish: roll a character, shop the town,
> descend, die permanently. It is not finished. The port is checked against the
> original C in a lot of ways, and play sessions still turn up things the checks
> cannot see - a message the original prints that this one doesn't, a screen laid
> out a column off, a prompt that never appears.
>
> **That is exactly what we need testers for.** Play it, and when something feels
> unlike Angband, [open an issue](https://github.com/neostryder/neo-angband/issues)
> or send a pull request. See [reporting a difference](#reporting-a-difference)
> for the one detail that makes a report immediately actionable.
>
> **Run your own copy** - [Get it running](#get-it-running) takes about two
> minutes. Please test on a build you control rather than any hosted demo: a
> hosted copy changes under you mid-session, which makes a bug report impossible
> to pin to a version.

## What this is

- **A port, not a redesign.** The target is Angband 4.2.6's behaviour, down to
  the message text and the screen layout. The original C tree lives buildable in
  [`reference/`](reference/) as a read-only oracle, and ported code cites the C
  `file:line` it came from. Where behaviour and "improvement" disagree,
  faithfulness wins; quality-of-life changes ship as mods you can turn off.
- **Web-first.** Play in a browser, install it as an offline PWA, self-host it as
  static files, or run it as a desktop app - all from the same build. The classic
  multi-window terminal interface becomes one fixed 80x24 surface scaled to your
  screen, with the same keymaps, fully remappable.
- **Moddable by construction.** The base game is itself a content pack.
  Declarative, schema-validated packs for content; Linoleum-style tile packs;
  sandboxed scripted plugins for the exotic. See [docs/MODS.md](docs/MODS.md).
- **Deterministic and seeded** everywhere, with a generator seam plugins can
  extend and a save format built to survive modular content.
- **Headless core.** The engine has no UI dependencies. Browser, terminal,
  desktop, bots, and plugins all speak the same command-queue and event-bus API.

The bundled **Borg** - a faithful port of Angband's automatic player - rides the
mod API as its completeness proof (add `?agent=borg` to watch it play; see
[docs/modding/BORG.md](docs/modding/BORG.md)).

## Get it running

Full instructions for every method, including PWA install and packaged desktop
installers, are in **[docs/INSTALL.md](docs/INSTALL.md)**. The short version:

### Play it locally from source (the recommended way to test)

You need [Node](https://nodejs.org/) 22 or newer and
[pnpm](https://pnpm.io/installation) (`corepack enable` gets you pnpm).

```bash
git clone https://github.com/neostryder/neo-angband.git
```

```bash
cd neo-angband && pnpm install && pnpm --filter @neo-angband/web dev
```

Then open **http://localhost:5178** and play. The dev server hot-reloads, so this
is also the setup to use if you want to fix what you find.

### Host it for yourself or a group

The production build is a folder of static files - no server code, no database,
no network calls at runtime.

```bash
pnpm --filter @neo-angband/web bundle
```

Serve `packages/web/dist-web/` with any static file host. It uses a relative
base, so a domain root and a subpath both work with no reconfiguration. To check
it locally:

```bash
cd packages/web/dist-web && python3 -m http.server 8080
```

Serve it over https (or `localhost`) if you want the offline PWA install to
work. See [docs/INSTALL.md](docs/INSTALL.md#2-self-host-as-a-static-site) for
headers and hosting notes.

### Run it as a desktop app

```bash
pnpm --filter @neo-angband/desktop dev
```

That builds the web bundle and opens it in an Electron window. To produce real
installers (`.exe`, `.dmg`, `.AppImage`/`.deb`), see
[docs/INSTALL.md](docs/INSTALL.md#4-desktop-app-electron).

### Your character and your save

Saves live in your browser's **localStorage**, scoped to the origin you play on,
so they are **per-surface**: a character made on `localhost:5178` is not the same
character as one made in the packaged desktop app, and clearing site data deletes
them. Use the built-in **export / import** to move a character between surfaces
and to keep a backup - death is permanent and a save is overwritten in place,
faithful to the original.

Starting, resuming and deleting a character is walked step by step in
[docs/INSTALL.md](docs/INSTALL.md#starting-resuming-and-deleting-a-character).

## Reporting a difference

The most useful report says **what the original C does** and **what this does**.
If you have Angband 4.2.6 to hand, a side-by-side is ideal; if not, describing
what you expected is plenty - we can check the C ourselves, and
[`reference/`](reference/) is right there in the repo.

Worth including: what you were doing, the character (race/class/level/depth),
and whether any mods were enabled (`=` shows them). A screenshot settles layout
questions instantly.

**Especially wanted:** missing or wrong *messages*, prompts that never appear,
and screens whose layout differs from the original. Those are the class of bug
that survives code review, and they are what previous "the port is complete"
claims kept getting wrong.

Pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the setup,
the faithfulness rules, and how a fix is expected to prove itself (cite the C,
add a test, check the test fails without your fix).

## Known rough edges

Honest list, so nobody wastes a report on something already written down:

- **Some upstream messages are still missing.** The exact set is enumerated, with
  a reason for each, in `KNOWN_ABSENT` in
  [packages/cli/src/text-census.test.ts](packages/cli/src/text-census.test.ts).
  `pnpm --filter @neo-angband/cli census` prints the current list. A message that
  is absent and *not* on that list fails CI - so if you find one that isn't
  listed, that is a genuine find and a bug in the checking.
- **The terminal is a fixed 80x24**, scaled to fit your window and letterboxed.
  That is upstream's default and its minimum, but upstream also lets you resize
  the window for a bigger map, and this does not yet. See
  [docs/INSTALL.md](docs/INSTALL.md#screen-and-display-controls) for the full
  display-lever inventory.
- **No subwindows.** Upstream can put the monster list, messages, and inventory
  in separate terminal windows; the port is one surface.
- **There is no mod catalogue to browse and install from yet.** What works
  today: the bundled mods are fully manageable, and the mod manager's *Choose a
  mods folder...* row reads mods from a folder on your computer - in the browser
  build too, not just on the desktop (Chrome/Edge; Firefox and Safari cannot
  pick a directory, so those stay bundled-only). What is missing is the
  one-click "install this recommended mod" front end. Neither surface has a
  runtime *code* loader, so a scripted-plugin mod still has to be bundled; a
  folder of records is data, and composes like a bundled pack. Full matrix in
  [docs/INSTALL.md](docs/INSTALL.md).
- The save format is pre-1.0 and may still change between versions. Export
  anything you care about.

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/core` | Headless game engine (TypeScript) |
| `packages/content` | Angband 4.2.6 gamedata compiled to the core content pack |
| `packages/mod-sdk` | Pack schemas, validation, mod tooling |
| `packages/web` | Web + PWA front-end (v1 target) |
| `packages/cli` | Terminal front-end and dev/parity harness |
| `packages/desktop` | Optional Electron desktop wrapper |
| `packages/linoleum` | Linoleum tile-pack converter (neo-linoleum) |
| `packages/borg` | The bundled Borg autoplayer mod |
| `docs/` | Port documentation (plan, architecture, parity, mods) |
| `parity/` | Provenance ledger mapping port modules to upstream sources |
| `reference/` | The original C tree at tag 4.2.6, buildable, with original docs |

## Development

```bash
pnpm install && pnpm build && pnpm test
```

`pnpm build` is also the typecheck (`tsc -b`). See
[CONTRIBUTING.md](CONTRIBUTING.md) for per-package scripts, the parity harnesses,
and the rules that keep the port faithful.

## Relationship to upstream

This repository is a fork of [angband/angband](https://github.com/angband/angband),
pinned to the 4.2.6 release as its parity baseline. The
[parity ledger](parity/README.md) maps every ported module to its upstream
source so future upstream releases can be merged deliberately. This is a
community port, not an official Angband project - all honor to the Angband
maintainers and three decades of contributors whose work this builds on.

## Author

Built and maintained by [neostryder](https://github.com/neostryder) at RPGM
Tools. The first-party mods are by the same author, and each is a standalone mod
rather than part of the parity core:

| Mod | Repository | What it is |
| --- | --- | --- |
| [qol](docs/modding/QOL.md) | [neo-angband-mod-qol](https://github.com/neostryder/neo-angband-mod-qol) | Quality-of-life conveniences (bundled) |
| [bug-fixes](docs/modding/BUG_FIXES.md) | [neo-angband-mod-bug-fixes](https://github.com/neostryder/neo-angband-mod-bug-fixes) | Patches for upstream bugs core keeps on purpose (bundled) |
| [neo-linoleum](docs/LINOLEUM.md) | [neo-angband-mod-linoleum](https://github.com/neostryder/neo-angband-mod-linoleum) | A second tile engine, and all six of Angband's tile sets converted to its loose-pack format |
| [borg](docs/BORG_AS_MOD.md) | [neo-angband-mod-borg](https://github.com/neostryder/neo-angband-mod-borg) | An automatic player. Not released - the repo holds the name and the plan |

All honor, as above, to the upstream Angband maintainers and contributors whose
work this builds on.

## License

Dual-licensed under GPLv2 or the traditional Angband license, matching
upstream - see [LICENSE.md](LICENSE.md). Game data derives from Angband.

**Art is licensed separately from code, per pack.** The four tile sets this
build ships are Angband's own, by **Adam Bolt** (16x16), **David Gervais**
(32x32, CC BY 3.0), **Nomad** (8x16), and the classic 8x8 Original Tiles -
each bundled under its own terms, stated per pack in
[packages/web/public/tiles/CREDITS.md](packages/web/public/tiles/CREDITS.md).
That file also records the one pack Angband ships that this port does *not*
bundle, and why. If you are a tile artist wondering how your work would be
treated here, that file is the answer, and
[docs/LINOLEUM.md](docs/LINOLEUM.md#tileset-licensing-why-converted-packs-are-not-shipped)
covers why no converted pack is redistributed at all.
