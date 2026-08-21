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
ships - Original, Adam Bolt, David Gervais, Nomad, and Shockbolt in its Dark and
Light modes - are CORE content, exactly as upstream. Every graphics mode in
`lib/tiles/list.txt` is bundled, that file is game data parsed by `grafmode.c`,
and the Graphics screen is built from that catalog (`main-win.c:2897-2905`), with
no mod enabled and none required. What this mod adds is an alternative way to
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
converts all six bundled graphics modes, builds both engines' maps, and asserts
that every entity either engine draws - features at all four lightings, traps,
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
installer fetches each one from a pinned TAG, records the SHA-256 of the bytes
that arrived, and unpacks them into the mod's own folder, which is where
`tilePackResolver` looks. The tag is what stops the download changing under you;
the recorded digest is what answers "has this pack changed since I installed it"
later. No digest ships inside the game, so it cannot tell you whether what
arrived is what the author published - a property the game does not have rather
than one it checks quietly.

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
parsed but not applied, so a family draws its base asset. The one place this
engine draws something a pack did not author is a **derived** tile a tileset MOD
asked for, on behalf of a mod's own content, which the tilesheet engine has no
room for - see
[Derived tiles for a mod's content](#derived-tiles-for-a-mods-content).

Double-height (overdraw) tiles used to be on that list. They are drawn over the
cell above now, by both engines - but the two learn about them differently, and
that difference is the whole of #243. A tilesheet reads the graphics mode's
overdraw band, which is core data. A loose pack has no rows to test and no mode
in the core catalog to read a band from: its grafID is its own. So the pack says
so itself, in `maps/tall.txt`, and until it did, every Shockbolt monster in a
neo-linoleum pack was squashed into one cell.

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

Such an asset's PNG is two cells tall and BOTTOM-ANCHORED: it is drawn over the
cell above the one it occupies. A pack that declares none - which is every pack
that says nothing - has no tiles that overdraw, and a runtime treats an absent
file as exactly that. Authoring by hand, you may declare any asset tall; nothing
requires an overdraw band or even a source tilesheet.

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

## Derived tiles for a mod's content

A tile pack has never heard of a mod's monsters, so in tile mode a creature a mod
added is a coloured letter standing in a tiled dungeon. Filling that in is a
TILESET MOD's job, not the game's, and the two halves live in different places on
purpose:

- **Who gets a tile, from whom, and in what colour** is policy, and it belongs to
  the tile set. 0.22.0 shipped that rule in core (`fillTilesFromKin`) and 0.23.0
  removed it: Angband 4.2.6 has no concept of a record a mod added, so it has no
  opinion about what one should look like, and the port adds nothing. It also
  meant the game deciding on behalf of art it does not own - an older pack has no
  picture for content added since it was drawn, and a sibling's picture there is a
  confident lie where a letter was honest. See
  `docs/modding/MOD_COMPATIBILITY.md`.
- **The mechanism** stays here, offered through `registry:tiles`
  (`packages/web/src/tile-registry.ts`, and `TileFill` in
  `packages/core/src/mod/registry-host.ts`). A filler reads what is assigned,
  writes only where nothing is, and may ask for a derived tile.

`neo-linoleum` 0.15.0 carries the rule that used to be in core, restricted to
LINOLEUM packs: an added monster is drawn from a race sharing its `base` and an
added object kind from a kind sharing its `tval`, recoloured. Under a tilesheet
pack, modded content keeps its letter.

**What this engine can do that a tilesheet cannot.** Copying a kin's tile leaves
the added ant pixel-for-pixel the base game's ant, so nobody can tell which is
which - not the player meeting both, and not the author checking their own work.
A tilesheet's tiles are cells of a fixed atlas and there is no spare cell to put a
variant in. A loose pack's tiles are individual images, so `derivedSlots`
(`packages/web/src/linoleum-pack.ts`) allocates a slot drawing an existing image
with its hue rotated. It is a third slot kind, `derived`, and the only one a pack
cannot declare:

```
{ kind: "derived", from: <donor slot>, hue: <degrees> }
```

What the ENGINE guarantees, each of which is otherwise re-derived from the code:

- **The pack's own slot table is never rewritten.** Derived slots are appended, so
  a derived slot cannot change what an existing rule draws.
- **One slot per (donor, hue).** Asking twice returns the same slot rather than
  growing the table, so a hundred added creatures on eight colours cost eight
  slots.
- **Three refusals, all answered with `null`**: a donor whose asset this pack does
  not own (a mod pref naming a raw atlas cell has nothing to recolour), a donor
  that is itself derived (the renderer will not chain recolours), and a rotation
  of nothing. The caller copies the donor plainly instead.
- **It is deterministic.** Nothing here reads the RNG, the clock or the save, so
  the same requests give the same slots every launch. A tile that changed colour
  between launches would be worse than a duplicate one.
- **A hue rotation is a no-op on grey.** A donor with no saturation comes back the
  colour it went in, so a derived tile is distinctive exactly when its donor has
  colour to turn. The saturation lift in `renderRecoloured` helps a muted donor
  and cannot invent colour in a fully grey one. The alternative, compositing a
  mark onto somebody else's art, is a bigger lie than a similar colour.

Hues themselves are the MOD's choice - it passes a number. neo-linoleum cycles
eight spread around the wheel, per donor, so the first eight added creatures
sharing one base differ from each other as well as from the base game's art.

The recolour is a canvas `filter` rather than per-pixel arithmetic, which matters
for one reason beyond speed: nothing calls `getImageData`, so an asset served
from an installed mod's blob URL recolours without a canvas taint error. Where the
filter is unavailable the copy comes out identical to its source, which is the
undistinguished tile that was there before.

**A fourth slot kind, `transformed`, is for a genuine palette swap rather than a
hue rotation** - a rotation cannot turn a grey donor any colour, and a mod
wanting a specific palette (not just the donor's own colours moved around the
wheel) needs the real remap `fill.transform` offers (see
`docs/modding/PLUGINS.md`, "Repainting a tile"). It shares `derivedSlots`'s one
allocator rather than a second table of its own, since two allocators over the
same donor would hand out different slot numbers for what is really one
picture. Unlike `derived`, this path does call `getImageData` - there is no
canvas-`filter` equivalent of an exact per-pixel palette remap - which needs
the image to be readable. It is readable in every path a pack arrives by (a
site-served pack is same-origin; a folder pick and a repository install both
resolve through a same-origin `blob:` URL), measured rather than assumed. The
try/catch stays anyway for the case that reasoning turns out wrong somewhere
unmeasured: a taint throws, this returns `null`, and the caller falls back to
a plain copy, the same as a failed recolour.

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

Nothing about this is loose-pack-specific and no first-party mod is privileged:
the `linoleum` mod's own manifest is exactly the shape above, and it arrives by
the same route yours does.

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

- **A Linoleum conversion is a modification.** It cuts the sheet into
  individual PNGs, and modification is the one thing the licence withholds. A
  pack you convert is yours to use; redistributing it needs the author's
  permission.
- **Whether this port counts as "Angband" or as "another project"** decides
  whether the unmodified sheet may ship with it, and the author answered:
  **the Shockbolt tilesheet is bundled here with his permission**, conditional
  on this project remaining non-commercial. That grant is this project's and
  does not travel: a project of your own needs its own permission.
  `packages/web/public/tiles/CREDITS.md` carries the full licence text and the
  grant.

Independently of Shockbolt: rather than shipping some converted packs and not
others, **this repository ships no converted packs at all.** The converter runs
locally against the `reference/` data, so every user derives their own packs from
the original files under the original licences, and the six pre-converted packs a
player can install come from the `neo-linoleum` mod's own repository rather than
from here. The CLI prints the relevant licence notes, including a prominent
warning for the Shockbolt packs, on every run.

## Parity

The port's fidelity to the original PowerShell converter is tracked in
`parity/ledger/linoleum-converter.yaml`. The end-to-end tests in
`packages/linoleum/src/convert.test.ts` pin manifest lines, target rules,
asset counts, PNG dimensions, and inventory counts that were cross-checked
against a ground-truth run of `build-linoleum-packs.ps1` over the same
reference data (text outputs byte-identical modulo the generated-by header;
all extracted PNGs pixel-identical).
