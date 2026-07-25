# L12_saveload audit (save/load - save.c / load.c / savefile / save-charoutput)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: reference/src/load.c, save.c, save-charoutput.c, save-charoutput.h,
savefile.c, savefile.h.
Searched packages/ (excl. node_modules, dist, borg) for real implementors.

Live path: packages/core/src/session/save.ts (JSON serializeGame/loadGame) +
packages/core/src/save/integrity.ts (stamp trailer) + packages/web/src/main.ts
(localStorage roster). Binary primitives in packages/core/src/save/buffer.ts are
unit-tested only and are NOT used by the play save path (PORT_PLAN decision 9).

### L12_saveload-001  Monster known_pstate (AI learn memory) is not persisted
sev: P1
concession: n
ref: reference/src/save.c:231-235 (wr_monster writes known_pstate.flags[OF_SIZE] and known_pstate.el_info[ELEM_MAX].res_level); reference/src/load.c:301-305 (rd_monster restores both); reference/src/list-options.h:94-95 (birth_ai_learn default true)
port: packages/core/src/session/save.ts:319-368 (SavedMonster / serializeMonster omit knownPstate); packages/core/src/session/save.ts:371-408 (deserializeMonster leaves blankMonster empty knownPstate); packages/core/src/mon/monster.ts:47-54,118-122
expected: On save/load, each live monster retains the OF flags and elemental resist levels it has learned about the player (birth_ai_learn ON by default). C does not persist known_pstate.pflags (upstream gap; port matching that omission for pflags alone is correct).
actual: serializeMonster never writes flags/elInfo; deserializeMonster rebuilds from blankMonster, so every reload wipes smart-learn memory. remove_bad_spells / mon-ranged then treats the player as fully unknown again until re-learning draws resume.
why: Default birth option; post-reload monster spell choice and "forget 1/20" stream diverge from C for every long fight that crossed a save.
confidence: high

### L12_saveload-002  SIDEBAR_MODE is a global pref, not a per-character save field
sev: P2
concession: n
ref: reference/src/save.c:322-323 (wr_options: wr_byte SIDEBAR_MODE); reference/src/load.c:442-449 (rd_options restores SIDEBAR_MODE into the term when present)
port: packages/web/src/main.ts:856-881 (SIDEBAR_MODE_KEY in localStorage, not encodeSavedGame); packages/core/src/player/options.ts:204-212 (OptionState.snapshot has hitpointWarn/delayFactor/lazymoveDelay but no sidebar)
expected: Sidebar layout (Left/Top/None) is part of the character options block and round-trips with that savefile.
actual: Sidebar mode is a host-global localStorage key shared by every roster slot. Switching characters inherits the last character's sidebar; a transferred save does not carry it.
why: Visible UI chrome diverges from C per-character option semantics; not forced by the browser (could live in SavedGame.options or roster meta).
confidence: high

### L12_saveload-003  save_charoutput / CharOutput.txt has no port
sev: P3
concession: y
ref: reference/src/save-charoutput.c:25-48 (save_charoutput writes ANGBAND_DIR_USER/CharOutput.txt with race/class/mapName/dLvl/cLvl/isDead/killedBy); reference/src/savefile.c:391-392 (savefile_save always calls save_charoutput)
port: NONE
expected: Every successful save also refreshes CharOutput.txt (angband.live synopsis).
actual: No CharOutput writer, no equivalent export on persistSave. Roster meta (web/src/roster.ts / metaFromState) carries name/race/class/level/depth/alive for the in-app picker only.
why: angband.live / external tools cannot scrape a fixed synopsis file; browser has no ANGBAND_DIR_USER filesystem. Unavoidable as a raw path write; a downloadable/exportable equivalent is not implemented.
confidence: high

### L12_saveload-004  Live save format is JSON, not C block binary (by design)
sev: P3
concession: y
ref: reference/src/savefile.c:79-155,325-379 (magic "Save" + variant "VNLA" + named blocks with 28-byte headers, additive checksum, 'x' pad); reference/src/save.c / load.c (wr_*/rd_* payload bodies)
port: packages/core/src/session/save.ts:1-18,70,985-1146,1576-1582 (SAVE_VERSION JSON + stampSavefile); packages/web/src/main.ts:3714 (encodeSavedGame into localStorage)
expected: On-disk save is the 4.2.x block binary; old Angband saves would load (parity baseline does not require import of old files per PORT_PLAN decision 2/9).
actual: Live path writes versioned JSON (entity graph + namespaced ids) stamped with an FNV-1a trailer. Binary framing in packages/core/src/save/buffer.ts is implemented and unit-tested but not wired to serializeGame/saveGame. Upstream savefiles cannot load (explicit decision 9).
why: Browser/mod-lifecycle design choice (PORT_PLAN decision 9); not a silent bug. Semantic field coverage is audited separately; this records the format divergence.
confidence: high

### L12_saveload-005  Binary writeSavefile stamp is a numeric version, not variant "VNLA"
sev: P3
concession: n
ref: reference/src/savefile.c:81-82,405-406 (savefile_name = {'V','N','L','A'}; written as the second 4 bytes after magic)
port: packages/core/src/save/buffer.ts:207-209 (writeSavefile writes writeU32LE(out, version) after magic)
expected: Bytes 4..7 of a framed save are always ASCII "VNLA" (variant id). Versioning is per-block, not in the file header.
actual: writeSavefile puts a little-endian integer version (tests use 7, 1). readSavefile accepts any u32 and does not require "VNLA". Dead for the live path, but the module claims a faithful savefile.c framing port.
why: Any future use of buffer writeSavefile/readSavefile as a C-compatible interchange will fail header checks in real Angband.
confidence: high

### L12_saveload-006  No panic-save path (savefile_get_panic_name)
sev: P3
concession: y
ref: reference/src/savefile.h:53; reference/src/savefile.c:671-679 (savefile_get_panic_name builds ANGBAND_DIR_PANIC path)
port: NONE (web uses pagehide/visibilitychange autosave to the same roster slot: packages/web/src/main.ts:3722-3733,5799-5802)
expected: Crash / panic path can write a distinct panic save under the panic directory without clobbering the main savefile name resolution.
actual: No panic directory or alternate panic filename. Tab close / hide force-autosaves into the active slot (best-effort localStorage).
why: Browser has no crash-signal panic dir; forced autosave is the practical substitute. Logged as a missing API surface.
confidence: high

### L12_saveload-007  deserializeObject activation ignores ego.activation
sev: P3
concession: n
ref: reference/src/save.c:185-188 (wr_item writes obj->activation->index or 0); reference/src/load.c:223-227 (rd_item restores &activations[tmp16u]); reference/src/obj-make.c ego path (ego activation trumps object)
port: packages/core/src/session/save.ts:239-241 (activation: (artifact ? artifact.activation : null) ?? kind.activation); packages/core/src/obj/make.ts:625-629 (egoApplyMagic sets obj.activation = ego.activation)
expected: Load restores the activation pointer that was on the object (artifact, ego, or kind), matching the saved index.
actual: Re-derive is artifact.activation ?? kind.activation only; ego.activation is never consulted. Base 4.2.6 ego_item.txt has zero act: lines (impact is latent), but any mod ego or future data with activations would lose *activate* after reload while time still round-trips.
why: Incomplete re-derive vs C; low current content impact, real for mods.
confidence: high

### L12_saveload-008  History aIdx is a raw numeric index, not an artifact name
sev: P3
concession: n
ref: reference/src/save.c:1063-1067 (wr_history: artifact name string or ""); reference/src/load.c history loader (lookup by name)
port: packages/core/src/session/save.ts:562 (hist: p.hist.map spread, aIdx as number); packages/core/src/player/history.ts:37 (aIdx: number)
expected: History artifact references survive pack reorder via stable name (C) or namespaced id (port's SAVE_VERSION 2 rule for other content).
actual: hist[].aIdx is the runtime aidx integer with no ContentIdResolver remap. Same-pack reloads match; reordered/extended artifact tables can retarget LOST/FOUND lines.
why: Diverges from both C name stability and the port's own namespaced-id save rule used for objects/artifacts elsewhere.
confidence: high

## MAP L12_saveload
reference/src/load.c -> packages/core/src/session/save.ts (deserialize* / loadGame in packages/core/src/session/game.ts); packages/core/src/save/buffer.ts (rd_* primitives only; not live path)
reference/src/save.c -> packages/core/src/session/save.ts (serialize* / saveGame in packages/core/src/session/game.ts); packages/core/src/save/buffer.ts (wr_* primitives only; not live path)
reference/src/save-charoutput.c -> NONE
reference/src/save-charoutput.h -> NONE
reference/src/savefile.c -> packages/core/src/save/buffer.ts (framing primitives); packages/core/src/save/integrity.ts (port-only stamp); packages/core/src/session/save.ts + packages/core/src/session/game.ts (savefile_save/load semantics: JSON live path); packages/web/src/main.ts + packages/web/src/roster.ts (storage, character list meta, autosave)
reference/src/savefile.h -> packages/core/src/save/buffer.ts; packages/core/src/session/save.ts; packages/core/src/session/game.ts (LoadGameOptions.wizard = cheat_death)
