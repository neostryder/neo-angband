# Save/Load Field-Parity Brief (worktree: C:\Repositories\na-wt-save, branch parity/p1-saveload)

`reference/` is the ORACLE (Angband 4.2.x). Fix WHAT IS SAVED/RESTORED, not the container.

## OUT OF SCOPE — do NOT attempt (awaiting neostryder's decision)
The port stores a JSON `SavedGame` (base64 + FNV trailer) in localStorage instead of the C
block-binary savefile (`Save` + `VNLA` header, 28-byte block headers, named saver/loader
tables). Findings L12-003, L12-004, L12-005, L12-006, L12-007, L12-009, L12-010, L12-013 are
all facets of that one architectural choice. DO NOT convert the save format, do not add the
C block registry, do not change the magic/header, and do not touch
`packages/core/src/save/buffer.ts` checksum/header semantics. Leave the format alone.

## IN SCOPE — field coverage defects (wrong regardless of container)
Each item: match the C exactly, cite the C file:line you matched in a code comment.

1. **Monster known_pstate not persisted** (L12-001 / L12-016, grok+codex agree).
   C `save.c:204-256` wr_monster writes `known_pstate.flags[OF_SIZE]` and
   `known_pstate.el_info[ELEM_MAX].res_level`; `load.c:259-352` rd_monster restores both
   BEFORE the monster goes live. C does NOT persist known_pstate.pflags.
   Port: `session/save.ts:319-368` SavedMonster/serializeMonster omit knownPstate;
   `:371-408` deserializeMonster starts from blankMonster -> every reload WIPES smart-learn
   memory, so remove_bad_spells / mon-ranged mis-decide. FIX: round-trip those two fields.
2. **Object activation + effect-presence not round-tripped** (L12-017).
   C `save.c:113-118,184-192` persists a per-object effect-present byte and the activation
   index; `load.c:153-155,223-232,247-250` restores activation BY THAT SAVED INDEX and sets
   effect only when the byte is nonzero. Port `session/save.ts:76-151,202-252` always takes
   `kind.effect` and picks `artifact.activation ?? kind.activation`. FIX: persist + restore.
3. **Artifact seen / everseen not persisted** (L12-020).
   C `save.c:674-688` + `load.c:1036-1059` save/load `created`, `seen`, `everseen` (plus the
   reserved byte). Port carries only an `artifactsCreated` id list. FIX: persist seen +
   everseen too.
4. **Current decoy marker lost on load** (L12-021).
   C `load.c:1473-1505` rd_traps sets the active cave decoy grid when it reads a decoy trap,
   so cave_find_decoy + monster targeting still see it. Port `deserializeTraps` rebuilds the
   trap map but never sets `GameState.decoy`. FIX: restore the decoy grid.
5. **Dead saves must OMIT live dungeon state** (L12-022).
   C `save.c:873-1045` skips dungeon objects/monsters/traps/chunk-list for a dead player and
   `load.c:1394-1697` likewise does not restore them. Port always serializes + rebuilds them.
   FIX: match the C skip on both sides.
6. **Player load validation / repair missing** (L12-026).
   C `load.c:766-839` rejects levels outside 1..PY_MAX_LEVEL, repairs max_lev / max_depth /
   recall_depth, resets the death cause when HP >= 0, bounds timed-effect counts, and skips
   unsupported entries. Port `deserializePlayer` assigns saved values directly. FIX: port the
   validation/repair rules faithfully.
7. **History artifact refs must be by NAME** (L12-025).
   C `save.c:1048-1069` writes the artifact NAME per history entry; `load.c:1715-1758`
   resolves it against the current artifact registry before storing a_idx. Port stores a raw
   numeric `aIdx` (unstable across content changes). FIX: persist name, resolve on load.
8. **Persistent-level connector metadata truncated / not remapped** (L12-023).
   C `save.c:845-867,1027-1043` + `load.c:1366-1383,1653-1678` persist each connector's x, y,
   feature AND every SQUARE_SIZE info byte, and remap the feature id on load. Port keeps only
   x,y,numeric feat and restores feat directly. FIX: persist info bytes + remap feature ids.
9. **Chunk data mutated in place during load** (L12-027). C `load.c:1307-1355` remaps into
   fresh data. Port mutates the saved structure in place (`session/save.ts:1426-1437`). FIX:
   do not mutate the source; build remapped output.
10. **O-1: killed uniques resurrect on reload.** C re-derives a unique's availability from
    saved lore: a unique whose lore records it dead must not respawn. Port
    `mon/bind.ts:783` sets `maxNum: unique ? 1 : 100` at bind and NOTHING in
    `packages/core/src/save/**` or the load path re-derives it from the saved lore pkills, so
    killed uniques come back after a reload. Verify against the C (save.c/load.c lore +
    `mon-make.c` max_num handling) and fix so a dead unique stays dead across save/load.

## Rules
- ONLY edit files under `packages/`. Do NOT touch `packages/borg/**` or
  `packages/linoleum/**` (out of scope: extensions). Do NOT touch
  `packages/cli/baseline/stats-baseline.json`.
- Do NOT change RNG draw order or count anywhere (another stream owns RNG determinism;
  base-game determinism must reproduce the C stream exactly).
- Preserve faithful upstream bugs. Do not "improve" the C.
- A test may only change if the C justifies it -- say why. Never relax a test to pass.
- Bump the save version / handle old saves ONLY if unavoidable, and say so explicitly.

## Verify (chunked, with timeouts; NEVER a monolithic `pnpm test`)
`packages/borg` think/foundation tests HANG (pre-existing) -- always exclude borg.
```
pnpm typecheck
timeout 600 pnpm vitest run packages/core/src/save packages/core/src/session --testTimeout=20000
timeout 600 pnpm vitest run packages/core/src/mon packages/core/src/obj --testTimeout=20000
timeout 600 pnpm vitest run packages/core/src/game packages/core/src/player --testTimeout=20000
timeout 600 pnpm vitest run packages/web --testTimeout=20000
```
Check each exit status (124 = hang: STOP and report which file).

## Report (stdout)
Per item: files changed, one-line summary, C citation matched. Then test + typecheck results.
Flag anything you could NOT do rather than forcing it.
End with: `SAVELOAD DONE <n>/10 tests <pass|fail>`. Do NOT commit or push. ASCII only.
