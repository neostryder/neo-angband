# Linoleum tile packs

Linoleum is a manifest-backed, loose-pack graphics format: instead of one
large tilesheet plus pixel coordinates, a pack is a directory of individual
PNG assets addressed through explicit, auditable target maps.

The format originated as a feature of neostryder's own Angband fork (see
`docs/hacking/linoleum.rst` there, and the converter
`scripts/build-linoleum-packs.ps1`). It is NOT part of the official Angband
4.2.6 parity tag, so it exists ONLY as a mod - never in core (PORT_PLAN.md
decisions 18 and 26). It ships as **neo-linoleum**, a STANDALONE
`tiles`-shape pack (id `linoleum`) loaded through the ordinary mod pipeline,
off on a fresh install like every mod, independent of and never combined with
the QoL or `bug-fixes` mods, and - like any mod - fully removable.
`packages/linoleum` is the build-time converter (a behaviorally faithful
TypeScript port of the fork's converter) that turns a legacy tileset into a
pack of this shape; it is tooling, not a core feature.

**It is not where the game's graphics come from.** The tile sets Angband
ships - Original, Adam Bolt, David Gervais, Nomad - are CORE content, exactly
as upstream: `lib/tiles/list.txt` is game data parsed by `grafmode.c`, and the
Graphics screen is built from that catalog (`main-win.c:2897-2905`), with no
mod enabled and none required. What this mod adds is an alternative way to
BUILD and express a tile set: a pack you can edit one PNG at a time, targets
named after game entities instead of grid coordinates, and variant pools -
several tiles for one symbol, creature or item, chosen by map position so a
seed always looks the same. A pack it contributes joins the Graphics screen
as an extra row tagged `[neo-linoleum]`; core's own rows stay untagged.

## Status: both engines work

The shell has TWO tile engines behind one seam, so the live map render does not
care which is active:

| | tilesheet (`packages/web/src/tiles.ts`) | loose pack (`packages/web/src/linoleum-pack.ts`) |
|---|---|---|
| art | one atlas PNG, addressed by (row, col) | one PNG per tile, addressed by name |
| mapping | `graf-*.prf` (upstream's own data) | `maps/targets.txt` |
| brought by | CORE - every tile set the game ships | a mod, via a `tilePacks` entry with `"engine": "linoleum"` |
| variant pools | no | yes |

A loose pack's selector is exactly the middle of the pref line it came from, so
the loose engine hands its rules back to core's ported pref parser
(`visuals/tile-prefs.ts`, the port of `ui-prefs.c parse_prefs_*`) as lines whose
two tile bytes are a synthetic slot number, and keeps a table from slot to
"which asset, or which pool". Entity lookup, lighting variants and the ASCII
fallback are therefore ONE code path for both engines; only the final blit
differs. Assets load lazily - the first cell that wants one starts its fetch and
draws its glyph until it arrives.

**Proven equivalent, not asserted.** `packages/web/src/linoleum-equivalence.test.ts`
converts all four bundled tile sets, builds both engines' maps, and asserts that
every entity either engine draws - features at all four lightings, traps,
monsters, object kinds, flavours, projections - resolves to a PIXEL-IDENTICAL
tile, with nothing the sheet covers left uncovered. Writing that test found two
real converter defects - an asset-name collision that made two different scrolls
share one file, and dropped decimal-coordinate lines - and prompted a third,
defensive change: target rules are now written in source order, because the
format is last-rule-wins and sorting discards a pack's own precedence (that one
changes no tile in the bundled packs; `convert.test.ts` pins it).

**Where the packs are.** Not here. The mod declares six, one per tile set Angband
ships, and it ships all six pre-converted in its own repository -
[neo-angband-mod-linoleum](https://github.com/neostryder/neo-angband-mod-linoleum)
- as seven committed archives (9161 files and 42 MiB of art, 24.6 MiB zipped). The
installer verifies each against a digest built into this game and unpacks them into
the mod's own folder, which is where `tilePackResolver` looks.

This repository holds the *converter* (`packages/linoleum`, a port of the upstream
fork's `build-linoleum-packs.ps1`) and the *reader*
(`packages/web/src/linoleum-pack.ts`), and no pack bytes at all. It used to
generate them into `packages/web/public/mods/` on every `pnpm dev` and serve them
from the game's own origin, which put a mod's art inside the game's build;
`packages/web/src/tile-catalog.test.ts` now asserts the absence.

With the mod installed and enabled, the Graphics screen offers its six rows beside
core's own six, which is the point: the same tiles, the other engine, no visible
difference. Packs you convert yourself are yours.

Known limits, shared by BOTH engines so they agree: conditional (`?:` /
`:when:`) rules are not evaluated; `family` effect metadata (glow/tint/pulse) is
parsed but not applied, so a family draws its base asset; double-height
(overdraw) tiles are not drawn above their cell.

Everything below describes the pack format itself.

## Pack layout

A converted pack directory looks like this:

```
<pack-key>/
  manifest.txt              pack id, format, resolution, map registrations
  maps/
    targets.txt             selector -> asset/family/pool mappings
    families.txt            family effect metadata (only when authored)
    pools.txt               variant-pool definitions (only when authored)
  images/<resolution>/      one PNG per asset, deterministic names
  graf-*.prf, xtra-*.prf,   the original legacy pref files, mirrored so the
  flvr-*.prf                mode keeps loading local legacy mapping truth
```

`manifest.txt` is a plain list of `key:value` lines:

```
pack:linoleum-original-tiles:Original Tiles (Linoleum)
format:png
resolution:8
map:targets:maps/targets.txt
map:families:maps/families.txt
map:pools:maps/pools.txt
```

`map:families:` and `map:pools:` lines are present only when the pack actually
authors that kind of metadata; a legacy-only export omits both.

## Target map and selector syntax

`maps/targets.txt` holds one rule per line:

```
target:<type>:<selector>:<kind>:<value>
```

- `type` is one of `feat`, `trap`, `GF`, `monster`, `object`, `flavor`.
- `kind` is one of:
  - `asset` - value is a PNG base name under `images/<resolution>/`;
  - `family` - value is a family id from `maps/families.txt`;
  - `pool` - value is a pool id from `maps/pools.txt` (a set of candidate
    assets resolved per grid; see "Variant pools" below).
- Selectors may contain colons (for example `GF:ELEC:0` or
  `object:light:Wooden Torch`), so lines are parsed by fixed head/tail
  fields, not by splitting freely.

**Per-object images.** Object kinds are addressed by their own selectors
(`object:<tval>:<name>`, e.g. `object:light:Wooden Torch`), so each object kind
already resolves to its own `asset`. A per-object rule may instead point at a
`pool`, giving one object kind a set of interchangeable images.

Two selector layers coexist in the same file:

- **Exact selectors** preserve full legacy fidelity:
  - stateful terrain and traps carry a variant suffix:
    `feat:FLOOR:lit`, `feat:FLOOR:dark`, `trap:pit:*`;
  - conditional remaps (from `?:` lines in `xtra-*.prf`) carry a
    `:when:<query>` suffix, for example
    `monster:<player>:when:[AND [EQU $CLASS Warrior] [EQU $RACE Human] ]`.
- **Compatibility aliases** come first in the file and give the current
  runtime one unsuffixed rule per base selector (for example `feat:FLOOR`).
  The alias points at the asset of the best exact rule: unconditioned rules
  win over conditioned ones, then variants rank `*`, `lit`, `torch`, `los`,
  `dark`, then earliest source order.

`maps/families.txt` binds glow/tint/pulse effect metadata to an asset behind
a stable family id (currently generated for the `feat:LESS`/`feat:MORE`
staircase selectors):

```
family:feat_less_lit_0_fx:selection:stable
family:feat_less_lit_0_fx:asset:feat_less_lit_0
family:feat_less_lit_0_fx:glow-alpha:72
family:feat_less_lit_0_fx:tint:180,220,255,48
family:feat_less_lit_0_fx:pulse:168,255,1400
```

Asset names are deterministic: the lowercased `type:selector` string is
slugged (`[^a-z0-9]+` runs become `_`), capped at 61 characters with an
md5-derived suffix when needed, and given a trailing `_0`.

## Variant pools

A `pool`-kind target maps one selector to a POOL of candidate assets instead of
exactly one, so a feature or object kind can vary its appearance across the map.
Pools are declared in `maps/pools.txt` (registered with `map:pools:` in the
manifest):

```
pool:floor_variants:selection:stable
pool:floor_variants:member:feat_floor_lit_0
pool:floor_variants:member:feat_floor_dark_0
pool:floor_variants:member:feat_floor_los_0
```

and bound to a selector with a `pool` target rule:

```
target:feat:FLOOR:pool:floor_variants
target:object:light:Wooden Torch:pool:torch_variants
```

Every `member` is an ordinary asset base name under `images/<resolution>/`; a
pool member must be an asset the pack already produced (the converter fails the
build otherwise). A pool declares one of two deterministic **selection rules**
(the loose engine resolves a pool to a single member at blit time with the pure
`selectPoolMember` in `packages/linoleum/src/targets.ts`, fed the cell being
drawn):

- `stable` (default) - an md5-derived index of `"<poolId>:<x>,<y>"`, so a given
  grid cell always draws the same variant (spatial variety that is stable across
  redraws and identical on every machine, so it never touches the game RNG). The
  md5 is a portable one (`packages/linoleum/src/md5.ts`, pinned to
  `crypto.createHash("md5")` by its own test) because the same hash has to be
  computed by the Node converter and by the browser at draw time, and Web Crypto
  has no md5.
- `index` - an explicit ordinal (for example an object's stack position),
  falling back to the linear `x + y` when no ordinal is supplied, taken modulo
  the member count and wrapped non-negative.

Pools and per-object pool rules are **additive**: a pack that authors none
converts byte-identically to the legacy-only export, so the parity tests are
unaffected. They are enabled per pack through the converter's `authoring`
option (`ConvertOptions.authoring[<packKey>]`, with `pools` and `targets`
arrays); a legacy tileset carries no pools of its own.

## Running the converter

```
pnpm build
node packages/linoleum/dist/cli.js [--tiles <dir>] [--out <dir>] [--packs key1,key2]
```

(The package also exposes the `neo-linoleum` bin name.) Defaults: `--tiles`
is `reference/lib/tiles`, `--out` is `build/linoleum` (gitignored). Pack
keys: `original-tiles`, `adam-bolt`, `gervais`, `nomad`, `shockbolt-dark`,
`shockbolt-light`.

The converter:

- parses each pack's `graf`/`xtra`/`flvr` pref files into selectors;
- extracts one PNG per selector from the source tilesheet (Shockbolt's
  overdraw rows 27-31 become bottom-anchored double-height 64x128 assets);
- skips and counts selectors that point outside the sheet;
- mirrors the pref files into the pack;
- writes `manifest.txt`, `maps/targets.txt`, and `maps/families.txt`;
- writes Markdown and JSON inventory reports into the output root.

## Shipping a pack in a mod

Put the converted directory inside your mod folder and name it in the manifest:

```
my-tiles/
  manifest.json
  my-set/                    <- the converted pack directory
    manifest.txt
    maps/ images/ ...
```

```json
{
  "id": "my-tiles",
  "name": "My Tile Set",
  "version": "1.0.0",
  "shape": "tiles",
  "tilePacks": [
    {
      "grafID": 101,
      "engine": "linoleum",
      "menuname": "My Set (Linoleum)",
      "path": "my-set"
    }
  ]
}
```

**`path` is relative to your MOD FOLDER, not to the site.** This is the one thing
worth getting right, because the wrong form used to be the documented one. A mod
cannot know where the host serves it from, and for two of the three ways a mod can
arrive the host serves it from nowhere at all: a folder the player picked in a
browser has no URL for its files until their bytes are wrapped in a `blob:`, and a
mod installed from a repository lives in IndexedDB. So the manifest names a
directory and the host composes it with however that mod's bytes are reached. A
`path` that still leads with `mods/` is refused by `validateManifest`.

`grafID` is the Graphics-screen row's serial number. Use **>= 100** for a set of
your own, to stay clear of upstream's `list.txt` numbering (1-6). A `linoleum` pack
may claim a new id and ADD a row; claiming one of 1-6 re-skins that row instead and
borrows its menu name. `menuname` is what the row is called - required in practice
for a new id, since there would otherwise be nothing to label it with.

The same `tilePacks` entry works for a classic tilesheet: leave `engine` out (or say
`"tilesheet"`), claim a grafID core's catalog already knows, and lay the pack out as
`<path>/<directory>/<file>` per that catalog row - the atlas and its `graf-*.prf`
are both reached through the same resolver, so they cannot come from different
places.

Nothing about this is loose-pack-specific and no bundled mod is privileged: the
`linoleum` mod's own manifest is exactly the shape above.

## Tileset licensing (why converted packs are not shipped)

The bundled legacy tilesheets under `reference/lib/tiles/` carry different
licences. None of the tileset directories contains its own licence or
readme file; the authoritative statements are in `reference/docs/copying.rst`.

| Tileset (pack keys) | Licence | Redistributable? |
| --- | --- | --- |
| Original 8x8 (`original-tiles`) | No separate exception in copying.rst; Angband dual licence (GPL v2 or Angband licence) | Yes, under those terms |
| Adam Bolt 16x16 (`adam-bolt`) | "may be redistributed and used for any purpose, with or without modification" | Yes |
| David Gervais 32x32 (`gervais`) | Creative Commons Attribution 3.0 | Yes, with attribution |
| Nomad 8x16 (`nomad`) | No separate exception in copying.rst; Angband dual licence (GPL v2 or Angband licence) | Yes, under those terms |
| Shockbolt 64x64 (`shockbolt-dark`, `shockbolt-light`) | Custom licence, copyright (C) Raymond Gaustadnes 2012 | Distribution **with Angband** is granted (no fee); **modification is not**, so a converted pack needs the author's permission |

Read that last row carefully, because it is easy to get backwards. Shockbolt's
licence is not a blanket prohibition: it *grants* use and fee-free distribution
of the tileset with in-development and released versions of Angband. What it
withholds is modification without permission, ToME-only tiles, and use or
distribution "with other games or projects" without explicit permission. Two
consequences for this converter:

- **A Linoleum conversion is a modification** — it cuts the sheet into
  individual PNGs. That needs the author's permission regardless of how the
  "is this Angband?" question below is answered. Convert your own copy for your
  own use; do not redistribute the result.
- **Whether this port counts as "Angband" or as "another project"** decides
  whether the unmodified sheet may ship with it. Only the author can answer
  that, and until he has, the port takes the conservative reading and bundles
  none of his art (`packages/web/public/tiles/CREDITS.md` has the full text and
  the reasoning).

Independently of Shockbolt: rather than shipping some converted packs and not
others, this port ships **no** converted packs. The converter runs locally
against the `reference/` data, so every user derives their own packs from the
original files under the original licences. The CLI prints the relevant licence
notes, including a prominent warning for the Shockbolt packs, on every run.

## Parity

The port's fidelity to the original PowerShell converter is tracked in
`parity/ledger/linoleum-converter.yaml`. The end-to-end tests in
`packages/linoleum/src/convert.test.ts` pin manifest lines, target rules,
asset counts, PNG dimensions, and inventory counts that were cross-checked
against a ground-truth run of `build-linoleum-packs.ps1` over the same
reference data (text outputs byte-identical modulo the generated-by header;
all extracted PNGs pixel-identical).
