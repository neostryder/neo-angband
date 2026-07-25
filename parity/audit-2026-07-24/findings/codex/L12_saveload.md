### L12_saveload-001  save-charoutput.c has no port implementation
sev: P3
concession: n
ref: reference/src/save-charoutput.c:25
port: NONE
expected: save_charoutput() writes ANGBAND_DIR_USER/CharOutput.txt as {, race, class, mapName "Angband", dLvl, cLvl, isDead, killedBy, and }, returns false on any write/open/close failure, and is invoked by savefile_save() before the binary save.
actual: No packages/ implementation defines save_charoutput(), writes the CharOutput.txt schema, or invokes an equivalent short synopsis export during saving; packages/web/src/charsheet.ts only offers a different full character-dump download.
why: The angband.live-compatible character synopsis is absent from the live save path, so consumers expecting CharOutput.txt receive no equivalent output.
confidence: high

### L12_saveload-002  save-charoutput.h has no port interface
sev: P3
concession: n
ref: reference/src/save-charoutput.h:10
port: NONE
expected: The save-charoutput interface exposes bool save_charoutput(void) so savefile_save() can generate the short CharOutput.txt synopsis.
actual: No packages/ module exposes a corresponding save_charoutput interface or callable equivalent for the C short-output contract.
why: The declaration and its callable contract are unmapped, leaving the reference save hook without a port entry point.
confidence: high

### L12_saveload-003  Live save path does not use the C block savefile
sev: P1
concession: n
ref: reference/src/savefile.c:29-39,384-447,554-584
port: packages/core/src/session/save.ts:1575-1606; packages/core/src/session/game.ts:2683-2733; packages/web/src/main.ts:3709-3718; packages/core/src/save/buffer.ts:207-230
expected: Normal save/load uses the C byte stream: Save plus VNLA header, 28-byte block headers, the named saver/loader tables, payloads, and x padding; savefile_save and savefile_load operate on that stream.
actual: The live web path JSON-stringifies SavedGame, appends an FNV trailer, base64-encodes it, and stores it in localStorage; loadGame consumes that JSON object. The binary buffer helper is exported but has no live save/load caller.
why: The normal game cannot read or write the reference savefile format, so original savefiles and block-level compatibility behavior are unavailable.
confidence: high

### L12_saveload-004  Savefile variant header is replaced by an arbitrary numeric version
sev: P1
concession: n
ref: reference/src/savefile.c:79-82,404-407
port: packages/core/src/save/buffer.ts:203-210,254-260
expected: Every file starts with bytes 83,97,118,101 followed by the exact four bytes V,N,L,A.
actual: writeSavefile writes the caller-supplied numeric version as little-endian bytes after Save, and readSavefile only checks the first four magic bytes.
why: Even the otherwise matching binary helper is not wire-compatible with an Angband savefile and accepts a different file variant.
confidence: high

### L12_saveload-005  Block header validation is weaker than the C parser
sev: P1
concession: n
ref: reference/src/savefile.c:460-500
port: packages/core/src/save/buffer.ts:254-285
expected: check_header requires all eight file-header bytes; next_blockheader requires an exact 28-byte read and savefile_head[15] == 0 before reconstructing the name, version, and size.
actual: readSavefile checks only the four-byte Save magic, does not validate the VNLA bytes, does not reject a short block header before indexed reads, and accepts a 16-byte name with no terminating zero.
why: Wrong-variant and malformed block headers can enter the port parser instead of following the C rejection path.
confidence: high

### L12_saveload-006  Port rejects checksum mismatches that the C loader ignores
sev: P1
concession: n
ref: reference/src/savefile.c:525-540
port: packages/core/src/save/buffer.ts:249-281
expected: C load_block reads exactly b->size bytes and calls the loader; although the header carries a checksum, this upstream code does not compare buffer_check with it.
actual: readSavefile recomputes the payload sum and throws when it differs from the header check value.
why: A file accepted by the reference loader because of its upstream checksum omission is rejected by the port, changing corrupted-save control flow.
confidence: high

### L12_saveload-007  C saver and loader registries are not ported
sev: P1
concession: n
ref: reference/src/savefile.c:102-155,506-519,554-576; reference/src/savefile.h:85-133
port: packages/core/src/save/buffer.ts:188-196,254-286; packages/core/src/session/save.ts:984-1015
expected: The savefile owns the ordered description/rng/options/messages/.../history block saver and loader tables, selects a loader by exact name and version, and invokes each loader while reading the file.
actual: The port exposes generic SaveBlock and BlockLoader types and only splits bytes into blocks; it supplies no C block registry, no exact named loader dispatch, and the live serializer is one JSON object.
why: The reference block ordering, version selection, and per-block load control flow have no equivalent active implementation.
confidence: high

### L12_saveload-008  String writer changes C byte and terminator behavior
sev: P2
concession: n
ref: reference/src/savefile.c:252-260
port: packages/core/src/save/buffer.ts:79-85
expected: wr_string writes bytes until the first C NUL in str, then writes one terminating zero; the bytes are the supplied char sequence.
actual: putString iterates over every JavaScript code unit, masks each to its low byte, writes embedded NULs and later characters, then adds another zero.
why: Embedded NULs and non-ASCII names or text serialize to different payload bytes.
confidence: med

### L12_saveload-009  Truncated payload sizes are not rejected before checksum parsing
sev: P1
concession: n
ref: reference/src/savefile.c:525-537
port: packages/core/src/save/buffer.ts:264-285
expected: file_read must return exactly b->size before the loader can run; a short payload makes load_block fail.
actual: readSavefile takes subarray(pos, pos + size) without checking its length, sums the shorter result, and can accept a header whose declared payload extends past the input when the resulting sum matches.
why: Malformed or truncated files can be treated as parsed blocks instead of failing at the C read-length check.
confidence: high

### L12_saveload-010  C savefile public API and save status are unmapped
sev: P1
concession: ?
ref: reference/src/savefile.h:31-53; reference/src/savefile.c:384-447,631-657
port: packages/core/src/session/game.ts:2683-2733; packages/web/src/main.ts:3709-3718; packages/web/src/roster.ts:103-112; NONE for character_saved/savefile_save/savefile_load signatures
expected: character_saved is a global status flag; savefile_save(path) and savefile_load(path, cheat_death) return bool and perform the C file operations, while load completes the character state and applies cheat death.
actual: saveGame returns a SavedGame object, persistSave returns void and swallows storage exceptions, and loadGame takes an in-memory pack plus SavedGame and throws on unsupported versions. No character_saved flag or path-based C API exists.
why: Callers cannot observe the reference save result or invoke the reference path-based save/load contract; only a browser-specific substitute is available.
confidence: high

### L12_saveload-011  Description and panic-name APIs have no port counterpart
sev: P2
concession: n
ref: reference/src/savefile.h:45-53; reference/src/savefile.c:595-624,661-680
port: packages/web/src/roster.ts:15-30,61-112; NONE for savefile_get_description/savefile_get_panic_name
expected: savefile_get_description reads the description block and returns Invalid savefile for a bad header; savefile_get_panic_name builds the panic path and clears the result when it cannot fit or validate.
actual: The roster stores separate JSON metadata and base64 save bytes but exposes neither a description-block reader nor a panic-save-name builder.
why: Character-select metadata and panic-save routing do not implement the reference APIs or their failure strings.
confidence: high

### L12_saveload-012  Savefile header constants are not mapped
sev: P3
concession: n
ref: reference/src/savefile.h:21-23
port: packages/core/src/save/buffer.ts:23-30; packages/core/src/session/save.ts:62-70; NONE for FINISHED_CODE/ITEM_VERSION/EGO_ART_KNOWN
expected: The header exports FINISHED_CODE 255, ITEM_VERSION 5, and EGO_ART_KNOWN 0xffffffff for the save/load implementation.
actual: The port defines SAVEFILE_MAGIC, SAVEFILE_HEAD_SIZE, PAD_BYTE, and an unrelated JSON SAVE_VERSION 2, but no counterparts for those three C constants.
why: C consumers of these shared savefile constants have no mapped port values.
confidence: high

### L12_saveload-013  C binary save/load format is replaced by an incompatible JSON format
sev: P1
concession: n
ref: reference/src/save.c:49-1071; reference/src/load.c:99-1761
port: packages/core/src/session/save.ts:2-7,1575-1614; packages/core/src/session/game.ts:2682-2700,2728-3009; packages/web/src/main.ts:549-565,3709-3719
expected: The save path writes the C block records and the load path reads those records, including the C item, player, dungeon, object, monster, trap, store, and history fields.
actual: The port writes JSON.stringify(SavedGame) plus an FNV trailer and stores it as base64 in localStorage; loadGame accepts only SAVE_VERSION 2 and no port reader consumes the C block stream.
why: Existing Angband savefiles are not loadable and the byte-level field widths, sentinels, versioning, and corruption behavior no longer match the oracle.
confidence: high

### L12_saveload-014  Save description string is not reproduced by the live save path
sev: P2
concession: n
ref: reference/src/save.c:49-66
port: packages/web/src/main.ts:3686-3701
expected: wr_description writes either "%s, dead (%s)" or "%s, L%d %s %s, at DL%d" using the player full name, death cause, level, race, class, and depth.
actual: The port stores separate roster metadata fields and does not construct or persist the C description string; it uses the shell playerName and has no death-cause field in CharMeta.
why: Save/roster consumers expecting the exact upstream synopsis receive different data and formatting.
confidence: high

### L12_saveload-015  RNG quick/fixed state and state-index normalization diverge
sev: P1
concession: n
ref: reference/src/save.c:286-307; reference/src/load.c:388-415
port: packages/core/src/rng.ts:61-68,387-412
expected: C saves Rand_value, state_i, the 32-word WELL state, and padding; load reduces state_i modulo RAND_DEG and forces Rand_quick=false.
actual: RngState persists quick, fixed, and fixval, restores stateI directly without modulo, and loadGame restores that state unchanged at packages/core/src/session/game.ts:2810-2811.
why: A save taken in quick or fixed mode, or with an out-of-range state index, resumes with a different RNG mode or invalid indexing and changes subsequent draws.
confidence: high

### L12_saveload-016  Monster known player-state memory is not saved
sev: P1
concession: n
ref: reference/src/save.c:204-256; reference/src/load.c:259-352
port: packages/core/src/session/save.ts:319-340,342-368,371-408
expected: wr_monster writes known_pstate.flags and known_pstate.el_info for every monster, and rd_monster restores them before the monster becomes live.
actual: SavedMonster contains mflag but no knownPstate flags or elemental memory; deserializeMonster starts from blankMonster and never restores those fields.
why: Monsters forget learned player protections and resistances after a save/load, changing later spell and attack decisions.
confidence: high

### L12_saveload-017  Object activation and effect presence are not round-tripped
sev: P1
concession: n
ref: reference/src/save.c:113-118,184-192; reference/src/load.c:153-155,223-232,247-250
port: packages/core/src/session/save.ts:76-114,116-151,202-252
expected: C persists the per-object effect-present byte and activation index, then restores activation by that saved index and sets effect only when the saved byte is nonzero.
actual: SavedObject has no effect-present or activation field; deserializeObject always takes kind.effect and chooses artifact.activation or kind.activation.
why: Runtime objects with a distinct activation or absent effect are changed when loaded, so using an item can expose the wrong action or effect.
confidence: high

### L12_saveload-018  Zero-power curse timeout data is dropped
sev: P2
concession: n
ref: reference/src/save.c:163-172; reference/src/load.c:201-211
port: packages/core/src/session/save.ts:176-189,285-298
expected: When curses exists, C writes every curse entry's power and uint16 timeout, including entries whose power is zero.
actual: serializeCurseList emits only entries with power greater than zero, and deserializeCurseList recreates omitted entries with timeout zero.
why: A nonzero timeout attached to a zero-power curse does not survive a save/load, changing the object curse state.
confidence: med

### L12_saveload-019  Known object copies are omitted from gear and store saves
sev: P1
concession: n
ref: reference/src/save.c:715-741,744-764; reference/src/load.c:1122-1189,1196-1261
port: packages/core/src/session/save.ts:685-709,1037-1044,1343-1404; packages/core/src/session/game.ts:2797-2799,2838-2842
expected: C writes real gear and a separate known gear list, and writes a known-object followed by a real-object pair for every store item; load reconnects each known object to its real object.
actual: The port serializes one SavedObject per gear handle, floor pile, held object, and store item, with no known-object counterpart or known link.
why: Unidentified per-object properties and shop/home knowledge are collapsed into the real object and do not resume with C-equivalent knowledge.
confidence: high

### L12_saveload-020  Artifact seen and everseen flags are not persisted
sev: P1
concession: n
ref: reference/src/save.c:674-688; reference/src/load.c:1036-1059
port: packages/core/src/obj/make.ts:730-765; packages/core/src/session/save.ts:805-816,972-981,1406-1418; packages/core/src/session/game.ts:2782-2793
expected: C saves and loads created, seen, and everseen for every artifact, plus the reserved byte.
actual: ArtifactState contains only created flags and SavedGame carries only an artifactsCreated id list; seen and artifact-everseen have no serialized or restored representation.
why: Artifact knowledge state is reset or unavailable after load even though the C save preserves it.
confidence: high

### L12_saveload-021  Current decoy marker is lost on load
sev: P1
concession: n
ref: reference/src/load.c:1473-1505
port: packages/core/src/session/save.ts:676-683,1308-1337; packages/core/src/session/game.ts:2838-2842
expected: rd_traps sets the active cave decoy grid when it reads a decoy trap, so cave_find_decoy and monster targeting still see the decoy after reload.
actual: deserializeTraps rebuilds only the trap map and loadGame assigns it without setting GameState.decoy; SavedGame has no current-level decoy field.
why: A decoy present at save time stops functioning after reload, changing targeting, movement, and decoy destruction behavior.
confidence: high

### L12_saveload-022  Dead saves include live dungeon state that C deliberately omits
sev: P1
concession: n
ref: reference/src/save.c:873-910,915-957,959-976,1001-1045; reference/src/load.c:1394-1427,1432-1471,1473-1505,1623-1697
port: packages/core/src/session/save.ts:1003-1057; packages/core/src/session/game.ts:2827-2842
expected: For a dead player, C skips dungeon objects, monsters, traps, and chunk-list payloads; the load functions likewise return without restoring those live collections.
actual: serializeGame always serializes chunk, floor, traps, monsters, groups, and level data, and loadGame always reconstructs them even when isDead is true.
why: Dead-character saves carry and restore gameplay state that the upstream death-save path intentionally excludes.
confidence: high

### L12_saveload-023  Persistent-level connector metadata is truncated and not remapped
sev: P1
concession: n
ref: reference/src/save.c:845-867,1027-1043; reference/src/load.c:1366-1383,1653-1678
port: packages/core/src/session/save.ts:852-856,1071-1080,1455-1458,1512-1514,1562-1565; packages/core/src/session/game.ts:2892-2900
expected: C persists each connector's x, y, feature, and every SQUARE_SIZE info byte, then restores all of those fields when birth_levels_persist is enabled.
actual: The port persists only x, y, and numeric feat for currentJoins and cached joins, drops connector info bytes, and restores feat directly without a feature-id remap.
why: Persistent-level stair/connector knowledge and terrain references can differ after reload or pack reordering.
confidence: high

### L12_saveload-024  Full monster lore is saved although C save.c persists only kills and thefts
sev: P2
concession: n
ref: reference/src/save.c:356-373; reference/src/load.c:498-544
port: packages/core/src/session/save.ts:735-740,1120-1145,1150-1183
expected: The save block contains only each race's pkills and thefts; rd_monster_memory restores those two counters and leaves the other lore fields to the normal lore source/defaults.
actual: The port serializes and restores every MonsterLore counter, blow memory, flags, spell flags, and knowledge booleans.
why: Reloading the port carries lore state that the C save/load pair does not, changing the scope and visibility of remembered monster knowledge.
confidence: high

### L12_saveload-025  History artifact references use unstable numeric indices
sev: P1
concession: n
ref: reference/src/save.c:1048-1069; reference/src/load.c:1715-1758
port: packages/core/src/player/history.ts:29-42; packages/core/src/session/save.ts:451-474,561-562
expected: C writes the artifact name for each history entry and rd_history resolves that name against the current artifact registry before storing a_idx.
actual: HistoryInfo stores aIdx as a raw number and serializePlayer copies it directly; load copies the number without resolving an artifact identity.
why: Reordered or extended artifact data can make a restored history entry refer to a different artifact than the one recorded.
confidence: high

### L12_saveload-026  Player load validation and repair rules are missing
sev: P1
concession: n
ref: reference/src/load.c:766-839
port: packages/core/src/session/save.ts:587-669; packages/core/src/session/game.ts:2734-2736
expected: C rejects player levels outside 1..PY_MAX_LEVEL, repairs max_lev/max_depth/recall_depth, resets the death cause for a nonnegative HP, bounds timed-effect counts, and skips unsupported timed entries.
actual: deserializePlayer assigns the saved values directly, copies arrays without count checks, and loadGame validates only the top-level SAVE_VERSION.
why: Malformed or older data can create invalid player state or later runtime failures instead of following the C load recovery path.
confidence: high

### L12_saveload-027  Remapped chunk data is mutated in place during load
sev: P1
concession: n
ref: reference/src/load.c:1307-1355
port: packages/core/src/session/save.ts:1426-1437
expected: C decodes each save stream into a new chunk, so reading the same source again applies the same source values and does not rewrite the saved input.
actual: deserializeChunk calls remapFeats(data.feats, featRemap) directly before restoreSquares, mutating the SavedGame payload's feature array.
why: Loading the same in-memory save twice with a nonidentity feature remap can remap already-remapped values a second time and produce a different level.
confidence: high

### L12_saveload-028  Missing artifact or ego references silently degrade instead of failing the item read
sev: P1
concession: n
ref: reference/src/load.c:137-151,238-245
port: packages/core/src/session/save.ts:210-215,217-252
expected: C treats an absent artifact or ego lookup as an item-read failure, and rejects an item whose kind cannot be found.
actual: deserializeObject maps an unknown artifact or ego id to null and continues; only an unknown kind throws.
why: A save with removed or mismatched artifact/ego definitions loads a changed item instead of following the C error path and preserving load integrity.
confidence: high

### L12_saveload-029  Port-only manifest, mod bags, and orphan blocks have no C save basis
sev: P3
concession: n
ref: reference/src/save.c:418-1070
port: packages/core/src/session/save.ts:818-842; packages/core/src/session/game.ts:2693-2700; packages/core/src/mod/save-blocks.ts:1-32
expected: The C save contains only the player/world blocks implemented by save.c and no pack manifest, opaque mod bag, or orphan quarantine record.
actual: The port adds manifest, mods, orphans, and orphan acknowledgement fields and mutates them during load reconciliation.
why: These are port-invented save semantics with no upstream reference field or control flow and they extend the persisted state beyond C parity.
confidence: high

## MAP L12_saveload
reference/src/save-charoutput.c -> NONE
reference/src/save-charoutput.h -> NONE
reference/src/load.c -> packages/core/src/session/save.ts; packages/core/src/session/game.ts; packages/web/src/main.ts
reference/src/save.c -> packages/core/src/session/save.ts; packages/core/src/session/game.ts; packages/web/src/main.ts
reference/src/savefile.c -> packages/core/src/save/buffer.ts; packages/core/src/session/save.ts; packages/core/src/session/game.ts; packages/web/src/main.ts; packages/web/src/roster.ts
reference/src/savefile.h -> packages/core/src/save/buffer.ts; packages/core/src/session/save.ts; packages/core/src/session/game.ts; packages/web/src/main.ts; packages/web/src/roster.ts
