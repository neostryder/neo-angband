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
  modes 5 (Dark) and 6 (Light). Angband's own statement, from
  `docs/copying.rst`, grants permission to use and distribute the tileset with
  in-development and released versions of Angband as long as no fee is charged
  for it, and withholds permission to modify it, to incorporate tiles drawn for
  ToME, or to use or distribute it with other games or projects without the
  author's explicit permission - non-commercial projects may be granted that;
  commercial use needs a non-exclusive licence from the author.

  **This project has that permission.** Raymond granted it directly, in
  correspondence dated 2026-07-30: free use of the tiles both as the tilesheet
  made for Angband and as separate individual tiles (which is what the Linoleum
  loose-pack conversion produces, and is a *modification* of the tileset, so it
  needed saying explicitly). The condition he set is that the project must not
  plan to profit from sales or other income; using the tiles in a game that aims
  for profit is a one-time USD 250 licence from him instead.

  **If you want to use this tileset in a project of your own, contact Raymond
  Gaustadnes for permission.** He asked that this be stated here, and the request
  is reasonable on its face: our permission is ours, not something this
  repository can pass along to you. Fork this project and the tiles do not come
  with a licence - only the art's own terms above apply, and the grant above was
  given to this project on the strength of its being free.

## Conditions that ride along with this art

These are not formalities, and they are the reason this section is longer than
the others:

- **Neo Angband must stay free of sales and other income to keep using
  Shockbolt's tiles for free.** Anything gated behind a paid RPGM Tools
  membership, or any release that charges for the game, is commercial use and
  needs a purchased licence from Raymond first.
- **A converted Linoleum pack is derived from his art** and carries the same
  terms as the sheet it came from. The converter prints those terms when it
  builds a Shockbolt pack.
- **The other packs' terms differ from each other** - Adam Bolt's are usable for
  any purpose, David Gervais' require CC-BY attribution (this file is that
  attribution), and the Original and Nomad sets are under Angband's dual licence.
  Do not treat "bundled with Neo Angband" as one licence.

Sources: Angband 4.2.6 `docs/copying.rst` and `docs/thanks.rst`, plus the
author's own grant to this project as described above.
