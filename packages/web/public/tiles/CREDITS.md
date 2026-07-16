# Bundled tile packs - credits and licences

Neo Angband bundles four of upstream Angband's freely-licensed tile packs so
the web shell can render in graphics mode out of the box. Each pack keeps its
upstream `.png` atlas and its pref files (`graf-*.prf` the attr/char -> tile
map, `flvr-*.prf` the flavour map, `xtra-*.prf` the extra/overdraw map), copied
verbatim from Angband 4.2.6 `lib/tiles/`.

ASCII is always the default; a tile pack is opt-in (Options menu, or the
`?tiles=<url>&graf=<id>` URL override).

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

## Deliberately excluded

- **Shockbolt's tiles** (64x64/128x64, by Raymond "Shockbolt" Gaustadnes,
  copyright (C) 2012) are **NOT bundled**. Their licence forbids use or
  distribution "with other games or projects" without the author's explicit
  permission, and commercial use requires a non-exclusive licence acquired
  from the author. They are therefore not commercial-safe to redistribute
  here. A user who owns the Shockbolt pack can still point the game at it via
  the `?tiles=<url>&graf=5` (Dark) or `&graf=6` (Light) URL override.

Sources: Angband 4.2.6 `docs/copying.rst` and `docs/thanks.rst`.
