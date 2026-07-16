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
enabled by default, independent of and never combined with the QoL or
`bug-fixes` mods, and - like any mod - fully removable. `packages/linoleum`
is the build-time converter (a behaviorally faithful TypeScript port of the
fork's converter) that produces this pack; it is tooling, not a core feature.
It is the reference tile pack - proof the tile-pack seam is real. Everything
below describes the pack format that mod uses.

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
(the runtime resolves a pool to a single member with the pure `selectPoolMember`
in `packages/linoleum/src/targets.ts`):

- `stable` (default) - an md5-derived index of `"<poolId>:<x>,<y>"`, so a given
  grid cell always draws the same variant (spatial variety that is stable across
  redraws and identical on every machine, so it never touches the game RNG).
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
| Shockbolt 64x64 (`shockbolt-dark`, `shockbolt-light`) | Custom licence, copyright (C) Raymond Gaustadnes 2012 | **No.** Modification and use or distribution outside Angband are not permitted |

Because the Shockbolt licence forbids modification and any distribution
outside Angband, converted Shockbolt packs are strictly for personal use and
must never be redistributed. Rather than shipping some converted packs and
not others, this port ships none: the converter runs locally against the
`reference/` data so every user derives their own packs from the original
files under the original licences. The CLI prints the relevant licence
notes, including a prominent warning for the Shockbolt packs, on every run.

## Parity

The port's fidelity to the original PowerShell converter is tracked in
`parity/ledger/linoleum-converter.yaml`. The end-to-end tests in
`packages/linoleum/src/convert.test.ts` pin manifest lines, target rules,
asset counts, PNG dimensions, and inventory counts that were cross-checked
against a ground-truth run of `build-linoleum-packs.ps1` over the same
reference data (text outputs byte-identical modulo the generated-by header;
all extracted PNGs pixel-identical).
