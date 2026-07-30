# Bundled tile packs - credits and licences

Neo Angband bundles four of upstream Angband's freely-licensed tile packs so
the web shell can render in graphics mode out of the box. Each pack keeps its
upstream `.png` atlas and its pref files (`graf-*.prf` the attr/char -> tile
map, `flvr-*.prf` the flavour map, `xtra-*.prf` the extra/overdraw map), copied
verbatim from Angband 4.2.6 `lib/tiles/`.

These four packs are CORE content, like upstream: `lib/tiles/list.txt` is game
data parsed by `grafmode.c`, and each frontend builds its Graphics menu straight
from that catalog (`main-win.c:2897-2905`). They are offered with no mod enabled
and no mod is needed for them. A `tiles`-shape mod can add a tile set of its own
or re-skin one of these, and only those rows are tagged with the mod's name in
the Graphics screen. ASCII is always the default; a tile pack is opt-in (game
menu -> Graphics, or the `?tiles=<url>&graf=<id>` URL override).

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

## Not bundled, pending the author's answer

- **Shockbolt's tiles** (64x64/128x64, by Raymond "Shockbolt" Gaustadnes,
  copyright (C) 2012) are part of Angband 4.2.6 — `lib/tiles/shockbolt/`,
  catalogued in `lib/tiles/list.txt` as graphics modes 5 (Dark) and 6 (Light).
  They are **not bundled here**, and that is our own caution rather than
  anything his licence says about this port. His licence *grants* — quoting
  `docs/copying.rst` — permission to "use the tileset with in-development and
  released versions of Angband" and to "distribute and make copies of the
  tileset with in-development and released versions of Angband, as long as no
  fee is charged for it". It *withholds* modification without permission, tiles
  drawn for ToME, and "use or distribute the tileset with other games or
  projects" without explicit permission — non-commercial projects may be
  granted it; commercial use needs a non-exclusive licence from the author.

  So the grant already covers Angband, and the only real question is one we
  cannot answer for ourselves: **is a faithful re-implementation of Angband
  4.2.6 "Angband", or is it "another project"?** Only Raymond can say. Until he
  has, we take the conservative reading — excluded — because guessing "we count
  as Angband" would be helping ourselves to someone else's work. Two things
  follow whatever he answers: converting his sheet to a Linoleum loose pack is a
  *modification*, which needs its own permission; and anything gated behind a
  paid RPGM Tools membership is commercial use, which needs a purchased licence
  rather than permission.

  A user who owns the Shockbolt pack can point the game at their own copy with
  the `?tiles=<url>&graf=5` (Dark) or `&graf=6` (Light) URL override, and can
  convert their own copy for their own use. That is their use of art they hold,
  not redistribution by us.

Sources: Angband 4.2.6 `docs/copying.rst` and `docs/thanks.rst`.
