# Bundled tile packs - credits and licences

Neo Angband bundles all five of upstream Angband's tile packs - every graphics
mode in `lib/tiles/list.txt` - so the game can render in graphics mode out of the
box. Each pack keeps its upstream `.png` atlas and its pref files (`graf-*.prf`
the attr/char -> tile map, `flvr-*.prf` the flavour map, `xtra-*.prf` the
extra/overdraw map), copied verbatim from Angband 4.2.6 `lib/tiles/`.

These packs are CORE content, like upstream: `lib/tiles/list.txt` is game data
parsed by `grafmode.c`, and each frontend builds its Graphics menu straight from
that catalog (`main-win.c:2897-2905`). They are offered with no mod enabled and no
mod is needed for them. A `tiles`-shape mod can add a tile set of its own or
re-skin one of these, and only those rows are tagged with the mod's name in the
Graphics screen. ASCII is always the default; a tile pack is opt-in (game menu ->
Graphics, or the `?tiles=<url>&graf=<id>` URL override).

## Packs and their licences

- **Original Tiles** (`old/`, 8x8) - the classic original Angband tileset.
  Part of the Angband distribution, released under the GNU General Public
  License, version 2, or the Angband licence (the project's standard dual
  licence).

- **Adam Bolt's tiles** (`adam-bolt/`, 16x16) - by Adam Bolt. Per Angband's
  `docs/copying.rst`: "Adam Bolt's (16x16) graphics may be redistributed and
  used for any purpose, with or without modification."

- **David Gervais' tiles** (`gervais/`, 32x32) - by David Gervais. Per
  Angband's `docs/copying.rst`: "David Gervais' (32x32) graphics may be
  redistributed, modified, and used only under the terms of the Creative
  Commons Attribution 3.0 licence"
  (https://creativecommons.org/licenses/by/3.0/). This file is that
  attribution.

- **Nomad's tiles** (`nomad/`, 8x16) - by Nomad, contributed to Angband and
  distributed under the project's standard GNU General Public License,
  version 2, or the Angband licence.

- **Shockbolt's tiles** (`shockbolt/`, 64x64/128x64) - by Raymond "Shockbolt"
  Gaustadnes, copyright (C) 2012. Catalogued in `lib/tiles/list.txt` as graphics
  modes 5 (Dark) and 6 (Light). **The tilesheet is bundled here with the author's
  permission.** Angband's own statement of the licence, from `docs/copying.rst`:

  > The Shockbolt Angband 64x64/128x64 tileset is copyright (C) Raymond
  > Gaustadnes 2012.
  >
  > Permission is granted to:
  >
  > - use the tileset with in-development and released versions of Angband
  > - distribute and make copies of the tileset with in-development and released
  >   versions of Angband, as long as no fee is charged for it
  > - incorporate tiles designed by the author for variants of Angband and use
  >   and distribute them with Angband under the terms above
  >
  > Permission is not granted to:
  >
  > - modify the tileset without the author's permission.
  > - incorporate tiles designed for ToME that do not appear in the Angband
  >   tileset.
  > - use or distribute the tileset with other games or projects. If you want to
  >   use and distribute the tileset with other games or projects, you must
  >   obtain explicit permission from the author. Non-commercial games or
  >   projects may be granted permission to use them, and if so, use will be
  >   allowed as long as the game or project remains non-commercial. To use them
  >   in commercial games, a non-exclusive licence must be acquired from the
  >   author.

  Some tiles in `64x64.png` were resized from tiles made by David Gervais for the
  32x32 set. **If you want to use this tileset in a project of your own, contact
  the author for permission** - the permission above is this project's, not
  something this repository can pass along, and it holds only while the project
  stays non-commercial.

  This file covers `public/tiles/` - the tilesheets, which is what the game itself
  draws. Cutting a sheet into one PNG per tile is a separate use of the art and it
  belongs to the neo-linoleum mod, so it is credited with those files rather than
  here: `public/mods/neo-linoleum/CREDITS.md`, written beside each pack by
  `scripts/gen-linoleum-demo.mjs`. The author's permission covers both forms.

The five packs' terms differ from each other, so do not treat "bundled with Neo
Angband" as one licence. Sources: Angband 4.2.6 `docs/copying.rst` and
`docs/thanks.rst`, plus the author's permission for this project as noted above.
