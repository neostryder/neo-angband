# S-3 — Root-cause the monster species-mix divergence at depths 5–8

You are working in the worktree you were given. `reference/` is the **read-only
oracle** (original Angband 4.2.6 C source). Never modify anything under
`reference/`.

## The finding

A two-sample G-test of homogeneity between the port's generated monster histogram
and one imported from the compiled C `main-stats` tool (200 levels per depth on
each side) shows the port picks **materially different monsters** from depth 5
down:

| depth | G | df | p | worst contributor |
|---|---|---|---|---|
| 1–4 | 76–100 | 47–86 | pass | — |
| 5 | 546.4 | 118 | 2.5e-56 | race 175 `warrior`: port 35, C ~0 |
| 6 | 590.1 | 126 | 4.1e-61 | race 175 `warrior`: port 36, C ~0 |
| 7 | 790.7 | 132 | 1.9e-94 | race 151 `tengu`: port 166, C 25.4 |
| 8 | 508.3 | 142 | 1.1e-42 | race 151 `tengu`: port 104, C 12.2 |

Reproduce with:

```bash
pnpm vitest run packages/cli/src/parity-c-stat.test.ts --testTimeout=300000
```

It prints the whole table. Full evidence and method:
`parity/phase3-2026-07-25/findings/W3-STATS-S2-S3.md`.

Monster **density** passes at every depth, and both **level feelings** pass at
every depth. It is specifically *which* races are chosen.

At depth 6 the two sides disagree in blocks of tens:

- C places, port does not: `homunculus ×34`, `hairy mold ×33`,
  `disenchanter mold ×27`, `quasit ×25`, `rogue ×21`, `clear mushroom patch ×16`,
  `half-orc ×16`
- port places, C does not: `ogre ×40`, `warrior ×36`,
  `killer brown beetle ×28`, `uruk ×20`, `blacklock mage ×16`, `black ogre ×15`

(counts are per 200 generated levels)

## Already ruled out — do not re-investigate these

1. **Index misalignment.** Correlating the C histogram against the port shifted
   by −2…+2 peaks sharply at shift 0 (0.99 at depth 1, 0.94 at depth 6) and the
   names line up. `<player>` is index 0 on both sides, and the committed pack's
   record order is proven to match `monster.txt` by
   `packages/content/src/data-exactness.test.ts`.
2. **Out-of-depth generation in general.** Mean placed race level matches closely
   (depth 6: C 3.99 vs port 3.97; depth 8: C 4.71 vs port 4.81), and both sides
   place a similar tail above the `get_mon_num` level cap.
3. **`get_mon_num`.** `packages/core/src/mon/make.ts:156` is faithful to
   `reference/src/mon-make.c:221` — OOD boost, town/seasonal/unique/FORCE_DEPTH
   gates, the harder-monster retries at p<60 and p<10, and the
   `(100/rarity) * (1 + level/10)` weighting.
4. **Unique recurrence.** Already fixed: the harness now mirrors
   `kill_all_monsters` (`reference/src/main-stats.c:557-560`), which zeroes
   `max_num` for every unique it kills. That cleared depths 1–4 on its own.

## Where to look, in order

Lumps of tens are the signature of **themed room population**, not of a
mis-weighted probability (which would nudge many species slightly).
`warrior`, `rogue`, `mage`, `priest` are the human-class races a "person" pit
draws from, and *both* sides place some of them — just different ones.

1. **Pit / nest theme selection.** `set_pit_type` and the pit profile weighting in
   `reference/src/gen-monster.c` + `reference/lib/gamedata/pit.txt` against the
   port's `packages/core/src/gen/gen-monster.ts`. Check the draw ORDER and count,
   the per-profile `alloc` weighting, the depth `rarity` gate, and the
   `one_in_`/retry structure — a pit that chooses a different theme moves
   hundreds of counts at once.
2. **The `mon_restrict` filter** pits install through `get_mon_num_prep`
   (`reference/src/gen-monster.c` `mon_restrict` / `mon_select`), including the
   base/flag/spell matching and the "no uniques in pits" rule.
3. **Pit and nest room FREQUENCY** — the room-profile draw in
   `reference/src/gen-cave.c` and `dungeon_profile.txt` / `room_template.txt`
   ordering. If the port builds pits at a different rate the mix shifts even with
   correct themes.
4. **Group / friends placement** (`place_friends` in `mon-make.c`, `friends:` and
   `friends-base:` lines in `monster.txt`) and **escort** generation. A wrong
   group size or a wrong friends-race lookup also moves counts in tens.

## Method

- **C is the oracle.** Every claim cites `reference/...:line`.
- **Verify by re-derivation.** Do not trust a comment or a test name; read the C
  and the port side by side and derive what each does.
- **Trace the live path**, and remember the generation path has its own placement
  helpers in `packages/core/src/gen/util.ts` distinct from the runtime ones in
  `packages/core/src/game/mon-place.ts` — check the one generation actually uses.
- **Preserve upstream bugs.** Faithful means faithful.
- **Draw-order matters.** The base game must reproduce the C's RNG stream, so a
  fix that changes how many draws happen, or in what order, is itself a
  divergence. State the draw sequence your change produces.

## Deliverable

`parity/phase3-2026-07-25/findings/S3-ROOTCAUSE.md`:

1. The root cause(s), each with the C citation, the port citation, and the
   derivation showing why the port's behaviour differs.
2. For each: the player-visible effect and a severity.
3. A proposed fix per cause, with its effect on RNG draw order stated explicitly.
4. Anything you investigated and cleared, so the next pass does not repeat it.

**Diagnosis in this task, not repair** — do not modify port source files yet. If
you need to experiment, do it in a scratch test file and delete it, and say in the
findings what you ran and what it showed. Commit nothing.
