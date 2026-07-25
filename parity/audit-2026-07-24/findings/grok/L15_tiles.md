# L15_tiles audit (tiles/graphics: lib/tiles + linoleum)
Auditor: grok. Method: re-derivation against reference C and assets (not prior ledgers).
Lane: reference/lib/tiles/** (list.txt, packs, PNG atlases, graf/flvr/xtra prefs, Makefiles).
Searched packages/ (excl. node_modules, dist, borg) for real implementors of each ref file.

Live path summary:
- Catalog METADATA from list.txt is codegen'd into packages/core/src/visuals/grafmode-data.ts
  (scripts/gen-grafmode.mjs) and consumed via packages/core/src/visuals/grafmode.ts.
- Pref grammar (feat/trap/monster/object/flavor/GF/% include) is packages/core/src/visuals/tile-prefs.ts.
- Browser atlas load + blit is packages/web/src/tiles.ts; live map wiring is packages/web/src/main.ts
  (applyTileMode, tileDrawFor, terrainGlyph/objectIndex/monsterIndex/trapIndex).
- Enabled-pack registry is packages/web/mods/linoleum/manifest.json + packages/web/src/tile-mods.ts.
- Bundled free assets (verbatim SHA256 match to reference) live under packages/web/public/tiles/{old,
  adam-bolt,gervais,nomad}/. Shockbolt is deliberately not shipped.
- packages/linoleum is an offline converter (graf -> loose linoleum packs), not the play path.

Asset identity (reference vs packages/web/public/tiles): all 16 free-pack PNG/PRF files are
byte-identical (SHA256 MATCH). Shockbolt tree has no public/ counterpart.

### L15_tiles-001  Player map cell never uses graphics tile (always ASCII @)
sev: P1
concession: n
ref: reference/src/ui-map.c:282-330 (g->is_player: a/c from monster_x_attr/char of r_info[0] aka "<player>"; hp_changes_color only when !(a & 0x80)); reference/lib/tiles/*/graf-*.prf (monster:<player>:...) + %:xtra-*.prf race/class remaps
port: packages/web/src/main.ts:4943-4954 (player put always ch:"@" + playerMapAttr, no tileDrawFor / no tileForMonster); packages/core/src/visuals/tile-prefs.ts:441-444 (tileForMonster exists but unused for player)
expected: In graphics mode the player cell blits the <player> atlas tile (race/class-selected via xtra). ASCII @ + hp color only when the attr lacks the tile high bit.
actual: With any tile pack active the whole map can be tiles while the player remains a coloured "@". The TileMap entry for ridx 0 is never consulted for the player cell.
why: Immediately visible wrong player glyph on the default graphics path; race/class player portraits never appear.
confidence: high

### L15_tiles-002  Pref ?: expressions not implemented; xtra player race/class mapping discarded / last-wins
sev: P1
concession: n
ref: reference/src/ui-prefs.c:453-600 (process_pref_file_expr + parse_prefs_expr sets d->bypass from ?: lines; $RACE/$CLASS/$SYS); reference/src/ui-prefs.c:682-690 (parse_prefs_monster respects bypass); reference/lib/tiles/old/xtra-xxx.prf (66 conditioned monster:<player> lines) and peers
port: packages/core/src/visuals/tile-prefs.ts:367-407 (switch has no "?" / expr case; ?: lines fall to default skip); packages/web/src/tiles.ts:174-207 (loadTilePrefs loads %:xtra via loadFile into the same map)
expected: Only the monster:<player> line whose preceding ?: expression matches the live race/class is applied; others are bypassed. Graf default applies until a match overwrites.
actual: All ?: lines are ignored. Every monster:<player> in xtra is applied in file order, so the last line wins unconditionally (old pack: Paladin+Kobold 0xA9:0x91). Even if L15_tiles-001 were fixed, every class/race would share one wrong portrait. (Linoleum's offline prf.ts *does* capture conditions as :when: metadata for conversion only.)
why: Player tile identity is race/class-specific in every upstream pack; the live parser cannot select it.
confidence: high

### L15_tiles-003  Object map tiles ignore flavor_x (always kind tile)
sev: P1
concession: n
ref: reference/src/ui-object.c:87-111 (use_flavor_glyph then object_kind_attr/char -> flavor_x_attr/char[fidx] else kind_x_*); reference/src/ui-map.c:218-223 (floor objects use object_kind_attr/char); reference/lib/tiles/*/flvr-*.prf (flavor:N:attr:char, included from graf via %:flvr-*.prf)
port: packages/web/src/main.ts:4407-4424 (tile = tileForObject(tileMap, o.kind) only; flavor used for ASCII ch/css only); packages/core/src/visuals/tile-prefs.ts:447-461 (tileForFlavor exists, never called from main map path)
expected: Unidentified potions/mushrooms/rings/wands/etc. blit the assigned flavor tile; identified (or scroll-aware) kinds use kind tile.
actual: Graphics mode always blits the kind atlas cell. Flavor PRFs are parsed into TileMap.flavor but never read for floor objects, so many flavoured items show the wrong/generic kind tile while ASCII colour correctly uses the flavor.
why: Core look of inventory-on-floor graphics is wrong for the entire flavoured-object set.
confidence: high

### L15_tiles-004  Visible terrain tiles always LIGHTING.LOS (map_info lighting ignored)
sev: P2
concession: n
ref: reference/src/cave-map.c:93-129 (g->lighting = LIT default; in-view CLOSE_PLAYER + view_yellow_light -> TORCH; unlit UNLIGHT cases -> DARK; else LOS/LIT); reference/src/ui-map.c:180-181 (feat_x_attr[g->lighting][fidx]); reference/lib/tiles/*/graf-*.prf (per-feat torch/los/lit/dark rows; e.g. old FLOOR lit 0xA1 vs los 0xA2)
port: packages/web/src/main.ts:4911 (terrainGlyph(..., LIGHTING.LOS) for all seen grids); packages/web/src/main.ts:4877 (remembered-only correctly uses LIGHTING.LIT)
expected: Seen grids pick the feat tile for map_info's lighting (TORCH/LOS/LIT/DARK). All four free packs differentiate lit vs los (and dark vs los) for multiple feats.
actual: Every in-view cell forces LOS tiles. Torch-yellow mode never selects TORCH rows; dark/unlit in-view cases never select DARK. Remembered out-of-view path is correct (LIT).
why: Visible torch/dark terrain variants never appear even though prefs and TileMap store them.
confidence: high

### L15_tiles-005  Trap tiles always LIGHTING.LOS
sev: P2
concession: n
ref: reference/src/ui-map.c:98-99 (trap_x_attr[g->lighting][tidx]); reference/lib/tiles/old/graf-xxx.prf trap:glyph of warding:dark/lit/los/torch distinct cells
port: packages/web/src/main.ts:4387 (tileForTrap(..., LIGHTING.LOS) only)
expected: Trap graphic follows the same lighting index as the grid.
actual: Trap lighting variants are parsed but the live path always samples LOS.
why: Trap art that changes with light level never switches.
confidence: high

### L15_tiles-006  GF bolt / missile / explosion tiles never drawn on live path
sev: P2
concession: n
ref: reference/src/ui-display.c:1524-1553 (bolt_pict uses proj_to_attr/char when use_graphics != NONE); reference/src/ui-display.c:1559-1696,2760-2763 (EVENT_BOLT / EVENT_EXPLOSION / EVENT_MISSILE handlers); reference/lib/tiles/*/graf-*.prf (GF:* and per-element GF lines)
port: packages/core/src/visuals/tile-prefs.ts:292-345,463-470 (parse + tileForProjection); packages/web/src (no tileForProjection / no EVENT_BOLT|MISSILE animation blit in main.ts)
expected: Projectiles, breath bolts, and explosions animate with the pack's GF atlas cells (direction-sensitive).
actual: GF mappings are loaded into TileMap.gf but nothing in the web shell blits them. Combat projectiles have no graphics overlay (ASCII-only or instant resolution).
why: Large visible chunk of every graf-*.prf is dead on the play path.
confidence: high

### L15_tiles-007  Tile blit stretches atlas cells into font cell size (ignores mode cellWidth/Height as term metrics)
sev: P2
concession: n
ref: reference/lib/tiles/list.txt size lines + reference/src/grafmode.c:61-68 (cell_width/cell_height from size); native front ends size the term cell to the mode's tile pixel size so 1 map grid = 1 tile at native aspect
port: packages/web/src/tiles.ts:108-130 (drawTile scales source cellWidth x cellHeight into caller dw x dh); packages/web/src/term.ts:454-465 (paintCell always passes GlyphTerm cellW/cellH from the 80x24 letterboxed font grid)
expected: A 16x16 (or 32x32/8x8) pack paints square tile pixels; a 64x64 pack likewise. Map cell aspect matches the tileset.
actual: Tiles are always non-uniformly scaled into the current bitmap-font cell (e.g. 16x24-ish). Catalog cellWidth/cellHeight only crop the atlas source rectangle; they never drive terminal metrics.
why: Every graphics mode looks stretched/squashed vs upstream; aspect is wrong even when atlas coords are correct.
confidence: high

### L15_tiles-008  Double-height overdraw (Shockbolt rows 27-31) not applied on blit
sev: P2
concession: n
ref: reference/lib/tiles/list.txt:58-68 (extra:1:27:31 for Shockbolt Dark/Light); reference/src/grafmode.c:241-258 (is_dh_tile); native term dblh_hook draws tall tiles spanning two rows
port: packages/core/src/visuals/grafmode.ts:114-123 (isDoubleHeightTile faithful); packages/web/src/tiles.ts:20-21 (comments only); packages/web/src/main.ts tileDrawFor / term paintCell (single cell blit only, never calls isDoubleHeightTile)
expected: Tiles whose attr row is in [overdrawRow, overdrawMax] overdraw the cell above (double height).
actual: Helper exists and is unit-tested but the live renderer never uses it. URL-loaded Shockbolt (graf 5/6) would clip tall monsters/terrain to one cell.
why: Catalog extra data is incomplete on the only packs that need it.
confidence: high

### L15_tiles-009  Shockbolt pack assets not shipped (license); catalog + URL path only
sev: P2
concession: y
ref: reference/lib/tiles/shockbolt/{64x64.png,graf-shb-dark.prf,graf-shb-light.prf,flvr-shb.prf,xtra-shb.prf}; reference/lib/tiles/list.txt name 5/6
port: packages/core/src/visuals/grafmode-data.ts:67-89 (metadata present); packages/web/public/tiles/ (no shockbolt/); packages/web/mods/linoleum/manifest.json:11-16 (tilePacks 1-4 only); packages/web/src/tile-mods.ts:73 (filters directory==="shockbolt"); packages/web/public/tiles/CREDITS.md:38-46
expected: Upstream ships Shockbolt Dark/Light as selectable modes with on-disk assets.
actual: Metadata and linoleum converter config still know Shockbolt, but assets are absent and the Options menu never offers graf 5/6. Documented escape: ?tiles=<url>&graf=5|6 with a user-owned copy.
why: Unavoidable redistribution/licence limit (bespoke Shockbolt licence forbids other projects). Logged so "missing shockbolt" is not treated as an accidental omission.
confidence: high

### L15_tiles-010  Linoleum converter nomad tileWidth 8 disagrees with list.txt / game catalog 16x16
sev: P3
concession: n
ref: reference/lib/tiles/list.txt:52-56 (Nomad size:16:16:8x16.png); packages/core/src/visuals/grafmode-data.ts:55-65 (cellWidth/Height 16)
port: packages/linoleum/src/packs.ts:74-84 (tileWidth: 8, tileHeight: 16, resolution: 16)
expected: Converter that claims fidelity to legacy packs should extract with the same cell size the game uses (16x16). Atlas is 512x960 = 32x60 tiles at 16px (pref tile cols use 0..31 with high bit).
actual: Offline linoleum export for nomad uses 8x16 source rectangles, splitting each game tile. Live web path is unaffected (uses grafmode 16x16).
why: Converted linoleum nomad packs would mis-slice the sheet relative to graf-nmd.prf coordinates.
confidence: high

### L15_tiles-011  Install Makefiles have no runtime port counterpart
sev: P3
concession: y
ref: reference/lib/tiles/Makefile; reference/lib/tiles/*/Makefile (buildsys DATA install lists)
port: NONE
expected: Native install copies PNG/PRF into the tiles package tree.
actual: Browser ships static files under packages/web/public/tiles/ (and Vite public copy). No Makefile consumer.
why: Host packaging only; not a play-path defect. Concession: no make install in browser deploys.
confidence: high

## MAP L15_tiles
reference/lib/tiles/list.txt -> packages/core/src/visuals/grafmode-data.ts (codegen packages/core/scripts/gen-grafmode.mjs); packages/core/src/visuals/grafmode.ts (GraphicsMode, getGraphicsMode, isDoubleHeightTile, GRAPHICS_NONE)
reference/lib/tiles/Makefile -> NONE (install packaging; web uses public/tiles static ship)
reference/lib/tiles/adam-bolt/16x16.png -> packages/web/public/tiles/adam-bolt/16x16.png (byte-identical); packages/web/src/tiles.ts (TileSet Image load)
reference/lib/tiles/adam-bolt/flvr-new.prf -> packages/web/public/tiles/adam-bolt/flvr-new.prf (byte-identical); packages/core/src/visuals/tile-prefs.ts (flavor:); loaded via %: from graf-new.prf in packages/web/src/tiles.ts loadTilePrefs
reference/lib/tiles/adam-bolt/graf-new.prf -> packages/web/public/tiles/adam-bolt/graf-new.prf (byte-identical); packages/core/src/visuals/tile-prefs.ts; packages/web/src/tiles.ts loadTilePrefs
reference/lib/tiles/adam-bolt/Makefile -> NONE
reference/lib/tiles/adam-bolt/xtra-new.prf -> packages/web/public/tiles/adam-bolt/xtra-new.prf (byte-identical); intended via %:xtra-new.prf include + ?: expr (see findings 001-002); packages/linoleum/src/prf.ts (offline condition capture only)
reference/lib/tiles/gervais/32x32.png -> packages/web/public/tiles/gervais/32x32.png (byte-identical); packages/web/src/tiles.ts
reference/lib/tiles/gervais/flvr-dvg.prf -> packages/web/public/tiles/gervais/flvr-dvg.prf (byte-identical); tile-prefs + loadTilePrefs % include
reference/lib/tiles/gervais/graf-dvg.prf -> packages/web/public/tiles/gervais/graf-dvg.prf (byte-identical); tile-prefs + loadTilePrefs
reference/lib/tiles/gervais/Makefile -> NONE
reference/lib/tiles/gervais/xtra-dvg.prf -> packages/web/public/tiles/gervais/xtra-dvg.prf (byte-identical); % include + ?: (findings 001-002)
reference/lib/tiles/nomad/8x16.png -> packages/web/public/tiles/nomad/8x16.png (byte-identical); tiles.ts (game cell size 16x16 per list.txt)
reference/lib/tiles/nomad/flvr-nmd.prf -> packages/web/public/tiles/nomad/flvr-nmd.prf (byte-identical); tile-prefs + loadTilePrefs
reference/lib/tiles/nomad/graf-nmd.prf -> packages/web/public/tiles/nomad/graf-nmd.prf (byte-identical); tile-prefs + loadTilePrefs
reference/lib/tiles/nomad/Makefile -> NONE
reference/lib/tiles/nomad/xtra-nmd.prf -> packages/web/public/tiles/nomad/xtra-nmd.prf (byte-identical); % include + ?: (findings 001-002)
reference/lib/tiles/old/8x8.png -> packages/web/public/tiles/old/8x8.png (byte-identical); tiles.ts
reference/lib/tiles/old/flvr-xxx.prf -> packages/web/public/tiles/old/flvr-xxx.prf (byte-identical); tile-prefs + loadTilePrefs
reference/lib/tiles/old/graf-xxx.prf -> packages/web/public/tiles/old/graf-xxx.prf (byte-identical); tile-prefs + loadTilePrefs
reference/lib/tiles/old/Makefile -> NONE
reference/lib/tiles/old/xtra-xxx.prf -> packages/web/public/tiles/old/xtra-xxx.prf (byte-identical); % include + ?: (findings 001-002)
reference/lib/tiles/shockbolt/64x64.png -> NONE in public (catalog only packages/core/src/visuals/grafmode-data.ts grafID 5/6; optional ?tiles= URL); packages/linoleum/src/packs.ts shockbolt-dark/light offline
reference/lib/tiles/shockbolt/flvr-shb.prf -> NONE in public (same); linoleum packs.ts prefFiles
reference/lib/tiles/shockbolt/graf-shb-dark.prf -> NONE in public; grafmode-data pref graf-shb-dark.prf; linoleum
reference/lib/tiles/shockbolt/graf-shb-light.prf -> NONE in public; grafmode-data pref graf-shb-light.prf; linoleum
reference/lib/tiles/shockbolt/Makefile -> NONE
reference/lib/tiles/shockbolt/xtra-shb.prf -> NONE in public; linoleum packs.ts prefFiles
(support) packages/web/mods/linoleum/manifest.json -> registers grafID 1-4 (old/adam-bolt/gervais/nomad) for Options
(support) packages/web/src/tile-mods.ts -> discoverEnabledTileModes / enabledTileModes
(support) packages/web/src/main.ts -> applyTileMode, tileDrawFor, map cell composition
(support) packages/linoleum/src/{packs,prf,convert,naming,targets,cli,index}.ts -> offline Linoleum loose-pack converter (not play path)
