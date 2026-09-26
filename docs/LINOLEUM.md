# Linoleum tile packs

Linoleum is a manifest-backed, loose-pack graphics format: instead of one
large tilesheet plus pixel coordinates, a pack is a directory of individual
PNG assets addressed through explicit, auditable target maps.

The format comes from neostryder's own Angband fork (see `docs/hacking/linoleum.rst` there, and the converter `scripts/build-linoleum-packs.ps1`). It is not part of the official Angband 4.2.6 tag that the port matches, so it exists only as a mod and never in core. It ships as **Linoleum** (id `linoleum`), a standalone `tiles`-shape pack loaded through the ordinary mod pipeline. Like every mod it is off on a fresh install and can be removed completely, and it is independent of the QoL and `bug-fixes` mods and never combined with them. `packages/linoleum` is the build-time converter, a behaviorally faithful TypeScript port of the fork's converter that turns a legacy tileset into a pack of this shape; it is tooling rather than a core feature.

The game's own graphics do not come from Linoleum. The tile sets Angband ships (Original, Adam Bolt, David Gervais, Nomad, and Shockbolt in its Dark and Light modes) are core content, as they are upstream. Every graphics mode in `lib/tiles/list.txt` is bundled, that file is game data parsed by `grafmode.c`, and the Graphics screen is built from that catalog (`main-win.c:2897-2905`) with no mod enabled and none required. Linoleum adds a different way to build and express a tile set: a pack you can edit one PNG at a time, targets named after game entities instead of grid coordinates, and variant pools, which give one symbol, creature or item several tiles chosen by map position so that a given seed always looks the same. Each pack it contributes appears on the Graphics screen as an extra row tagged `[Linoleum]`; core's own rows stay untagged.

## Status: both engines work

The shell has TWO tile engines behind one seam, so the live map render does not
care which is active:

| | tilesheet (`packages/web/src/tiles.ts`) | loose pack (`packages/web/src/linoleum-pack.ts`) |
|---|---|---|
| art | one atlas PNG, addressed by (row, col) | one PNG per tile, addressed by name |
| mapping | `graf-*.prf` (upstream's own data) | `maps/targets.txt` |
| brought by | CORE - every tile set the game ships | a mod, via a `tilePacks` entry with `"engine": "linoleum"` |
| variant pools | no | yes |

A loose pack's selector is exactly the middle of the pref line it came from, so the loose engine hands its rules back to core's ported pref parser (`visuals/tile-prefs.ts`, the port of `ui-prefs.c parse_prefs_*`) as lines whose two tile bytes are a synthetic slot number, and keeps a table from slot to "which asset, or which pool". Entity lookup, lighting variants and the ASCII fallback are therefore one code path for both engines, and only the final blit differs. Assets load lazily: the first cell that wants one starts its fetch and draws its glyph until the image arrives.

`packages/web/src/linoleum-equivalence.test.ts` checks that the two engines agree. It converts all six bundled graphics modes, builds both engines' maps, and asserts that every entity either engine draws (features at all four lightings, traps, monsters, object kinds, flavours, projections) resolves to a pixel-identical tile, and that nothing the sheet covers is left uncovered. Writing the test found two converter defects: an asset-name collision that made two different scrolls share one file, and dropped decimal-coordinate lines. It also led to a third, defensive change: target rules are now written in source order, because the format is last-rule-wins and sorting discarded a pack's own precedence. That change alters no tile in the bundled packs, and `convert.test.ts` pins it.

The packs themselves are not in this repository. The mod declares six, one per tile set Angband ships, and ships all six pre-converted in its own repository, [neo-angband-mod-linoleum](https://github.com/neostryder/neo-angband-mod-linoleum), as seven committed archives (9161 files and 42 MiB of art, 24.6 MiB zipped). The installer fetches each archive from a pinned tag, records the SHA-256 of the bytes that arrived, and unpacks them into the mod's own folder, which is where `tilePackResolver` looks. The pinned tag keeps the download from changing under you, and the recorded digest lets the game tell you later whether a pack has changed since you installed it. No digest ships inside the game, so it cannot tell you whether what arrived is what the author published.

This repository holds the *converter* (`packages/linoleum`, a port of the upstream
fork's `build-linoleum-packs.ps1`) and the *reader*
(`packages/web/src/linoleum-pack.ts`), and no pack bytes at all. It used to
generate them into `packages/web/public/mods/` on every `pnpm dev` and serve them
from the game's own origin, which put a mod's art inside the game's build;
`packages/web/src/tile-catalog.test.ts` now asserts the absence.

With the mod installed and enabled, the Graphics screen offers its six rows beside core's own six. They show the same tiles through the other engine, with no visible difference. Packs you convert yourself are yours.

Conditional (`?:` / `:when:`) rules are evaluated by core's shared pref evaluator, and loose-pack `family` effect metadata (glow/tint/pulse) is applied at render time. The only time this engine draws something a pack did not author is a derived tile that a tileset mod requests for a mod's own content, which the tilesheet engine has no room for; see [Derived tiles for a mod's content](#derived-tiles-for-a-mods-content).

Double-height (overdraw) tiles were once unsupported. Both engines now draw them over the cell above, but they learn which tiles are tall in different ways (#243). A tilesheet reads the graphics mode's overdraw band, which is core data. A loose pack has no rows to test and no mode in the core catalog to read a band from, since its grafID is its own, so the pack lists its tall assets itself in `maps/tall.txt`. Until it did, every Shockbolt monster in a Linoleum pack was squashed into one cell.

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
    tall.txt                double-height assets (only when the source mode
                            has an overdraw band)
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
map:tall:maps/tall.txt
```

`map:families:` and `map:pools:` lines are present only when the pack actually
authors that kind of metadata; a legacy-only export omits both. `map:tall:` is
present only when the source mode declares an overdraw band - of the six the
game ships, that is Shockbolt Dark and Shockbolt Light and nothing else.

`maps/tall.txt` is one `tall:<asset>` line per double-height asset:

```
tall:monster_guardian_naga_0
tall:monster_spirit_naga_0
```

Such an asset's PNG is two cells tall and bottom-anchored: it is drawn over the cell above the one it occupies. A pack without `maps/tall.txt` has no tiles that overdraw, and a runtime treats a missing file that way. When authoring by hand you may declare any asset tall; nothing requires an overdraw band or even a source tilesheet.

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

Every `member` is an ordinary asset base name under `images/<resolution>/`, and it must be an asset the pack already produced; the converter fails the build otherwise. A pool declares one of two deterministic selection rules. At blit time the loose engine resolves the pool to a single member with the pure `selectPoolMember` function in `packages/linoleum/src/targets.ts`, given the cell being drawn:

- `stable` (default): an md5-derived index of `"<poolId>:<x>,<y>"`, so a given grid cell always draws the same variant. The variety is stable across redraws, identical on every machine, and never touches the game RNG. The md5 is a portable implementation (`packages/linoleum/src/md5.ts`, pinned to `crypto.createHash("md5")` by its own test), because the Node converter and the browser at draw time must compute the same hash, and Web Crypto has no md5.
- `index`: an explicit ordinal (for example an object's stack position), falling back to the linear `x + y` when no ordinal is supplied, taken modulo the member count and wrapped non-negative.

Pools and per-object pool rules are **additive**: a pack that authors none
converts byte-identically to the legacy-only export, so the parity tests are
unaffected. They are enabled per pack through the converter's `authoring`
option (`ConvertOptions.authoring[<packKey>]`, with `pools` and `targets`
arrays); a legacy tileset carries no pools of its own.

## Derived tiles for a mod's content

A tile pack knows nothing about a mod's monsters, so in tile mode a creature a mod added shows up as a coloured letter in a tiled dungeon. Giving it a tile is a tileset mod's job rather than the game's, and the work splits into two parts that live in different places.

Which content gets a tile, borrowed from what, and in what colour is policy, and the tile set owns it. Core carried that rule (`fillTilesFromKin`) in 0.22.0 and removed it in 0.23.0. Angband 4.2.6 has no concept of a record a mod added, so it has no opinion about how one should look, and the port adds nothing. The rule also had the game deciding things for art it does not own: an older pack has no picture for content added after it was drawn, and borrowing a sibling's picture there misleads the player where a letter would not. See `docs/modding/MOD_COMPATIBILITY.md`.

The mechanism stays in the game, offered through `registry:tiles` (`packages/web/src/tile-registry.ts`, and `TileFill` in `packages/core/src/mod/registry-host.ts`). A filler reads what is assigned, writes only where nothing is, and may ask for a derived tile.

`neo-linoleum` 0.15.0 carries the rule that used to be in core, restricted to LINOLEUM packs: an added monster is drawn from a race sharing its `base` and an added object kind from a kind sharing its `tval`, recoloured. Under a tilesheet pack, modded content keeps its letter.

A plain copy of a kin's tile leaves the added ant pixel-for-pixel identical to the base game's ant, so neither the player meeting both nor the author checking their own work can tell them apart. A tilesheet cannot help, because its tiles are cells of a fixed atlas with no spare cell for a variant. A loose pack's tiles are individual images, so `derivedSlots` (`packages/web/src/linoleum-pack.ts`) can allocate a slot that draws an existing image with its hue rotated. This is a third slot kind, `derived`, and the only one a pack cannot declare:

```
{ kind: "derived", from: <donor slot>, hue: <degrees> }
```

The engine guarantees the following:

- The pack's own slot table is never rewritten. Derived slots are appended, so a derived slot cannot change what an existing rule draws.
- There is one slot per (donor, hue). Asking twice returns the same slot rather than growing the table, so a hundred added creatures on eight colours cost eight slots.
- Three requests are refused with `null`: a donor whose asset this pack does not own (a mod pref naming a raw atlas cell has nothing to recolour), a donor that is itself derived (the renderer does not chain recolours), and a rotation of nothing. The caller then copies the donor plainly.
- Allocation is deterministic. Nothing here reads the RNG, the clock or the save, so the same requests give the same slots on every launch, and a tile never changes colour between launches.
- A hue rotation does nothing to grey. A donor with no saturation comes back the colour it went in, so a derived tile stands out only when its donor has colour to rotate. The saturation lift in `renderRecoloured` helps a muted donor but cannot invent colour in a fully grey one. Compositing a mark onto somebody else's art instead would misrepresent that art more than a similar colour does.

The mod chooses the hues by passing a number. Linoleum cycles eight spread around the wheel, per donor, so the first eight added creatures sharing one base differ from each other as well as from the base game's art.

The recolour uses a canvas `filter` rather than per-pixel arithmetic. Besides being faster, this means nothing calls `getImageData`, so an asset served from an installed mod's blob URL recolours without a canvas taint error. Where the filter is unavailable, the copy comes out identical to its source, which is the undistinguished tile that was there before.

A fourth slot kind, `transformed`, handles a true palette swap. A hue rotation cannot give a grey donor any colour, and a mod that wants a specific palette, rather than the donor's own colours moved around the wheel, needs the real remap that `fill.transform` offers (see `docs/modding/PLUGINS.md`, "Repainting a tile"). It shares the one allocator in `derivedSlots` instead of keeping a second table, since two allocators over the same donor would hand out different slot numbers for one picture. Unlike `derived`, this path calls `getImageData`, because no canvas `filter` performs an exact per-pixel palette remap, so the image has to be readable. It has been checked as readable on every path a pack arrives by: a site-served pack is same-origin, and a folder pick and a repository install both resolve through a same-origin `blob:` URL. The code keeps a try/catch in case some unchecked path taints the canvas anyway: the taint throws, the call returns `null`, and the caller falls back to a plain copy, as it does for a failed recolour.

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
  overdraw rows 27-31 become bottom-anchored double-height 64x128 assets, and
  each is named in `maps/tall.txt`);
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

**`path` is relative to your mod folder, not to the site.** A mod cannot know where the host serves it from, and for two of the three ways a mod can arrive the host serves it from nowhere at all: a folder the player picked in a browser has no URL for its files until their bytes are wrapped in a `blob:`, and a mod installed from a repository lives in IndexedDB. So the manifest names a directory, and the host combines it with however that mod's bytes are reached. `validateManifest` refuses a `path` that still starts with `mods/`, the older documented form.

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

Nothing about this is loose-pack-specific and no first-party mod is privileged:
the `linoleum` mod's own manifest is exactly the shape above, and it arrives by
the same route yours does.

## Tileset licensing (why converted packs are not shipped)

The bundled legacy tilesheets under `reference/lib/tiles/` carry different
licenses. None of the tileset directories contains its own license or
readme file; the authoritative statements are in `reference/docs/copying.rst`.

| Tileset (pack keys) | License | Redistributable? |
| --- | --- | --- |
| Original 8x8 (`original-tiles`) | No separate exception in copying.rst; Angband dual license (GPL v2 or Angband license) | Yes, under those terms |
| Adam Bolt 16x16 (`adam-bolt`) | "may be redistributed and used for any purpose, with or without modification" | Yes |
| David Gervais 32x32 (`gervais`) | Creative Commons Attribution 3.0 | Yes, with attribution |
| Nomad 8x16 (`nomad`) | No separate exception in copying.rst; Angband dual license (GPL v2 or Angband license) | Yes, under those terms |
| Shockbolt 64x64 (`shockbolt-dark`, `shockbolt-light`) | Custom license, copyright (C) Raymond Gaustadnes 2012 | Distribution **with Angband** is granted (no fee); **modification is not**, so a converted pack needs the author's permission |

Read that last row carefully, because it is easy to get backwards. Shockbolt's
license is not a blanket prohibition: it *grants* use and fee-free distribution
of the tileset with in-development and released versions of Angband. What it
withholds is modification without permission, ToME-only tiles, and use or
distribution "with other games or projects" without explicit permission. Two
consequences for this converter:

- **A Linoleum conversion is a modification.** It cuts the sheet into
  individual PNGs, and modification is the one thing the license withholds. A
  pack you convert is yours to use; redistributing it needs the author's
  permission.
- **Whether this port counts as "Angband" or as "another project"** decides
  whether the unmodified sheet may ship with it, and the author answered:
  **the Shockbolt tilesheet is bundled here with his permission**, conditional
  on this project remaining non-commercial. That grant is this project's and
  does not travel: a project of your own needs its own permission.
  `packages/web/public/tiles/CREDITS.md` carries the full license text and the
  grant.

Independently of Shockbolt: rather than shipping some converted packs and not
others, **this repository ships no converted packs at all.** The converter runs
locally against the `reference/` data, so every user derives their own packs from
the original files under the original licenses, and the six pre-converted packs a
player can install come from the `linoleum` mod's own repository rather than
from here. The CLI prints the relevant license notes, including a prominent
warning for the Shockbolt packs, on every run.

## Parity

`parity/ledger/linoleum-converter.yaml` tracks how closely the port follows the original PowerShell converter. The end-to-end tests in `packages/linoleum/src/convert.test.ts` pin manifest lines, target rules, asset counts, PNG dimensions and inventory counts, all cross-checked against a run of `build-linoleum-packs.ps1` over the same reference data: the text outputs are byte-identical apart from the generated-by header, and every extracted PNG is pixel-identical.
