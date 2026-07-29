# Palette / Colour Parity Brief (worktree: C:\Repositories\na-wt-color, branch parity/p2-color)

`reference/` is the ORACLE (Angband 4.2.x). Decision 6.1 (neostryder): the port keeps a FAITHFUL
glyph terminal as core; the exact z-color palette is required, not invented colours. This
stream fixes the palette layer ONLY.

## HARD CONSTRAINT — keep the render seam intact
The game emits abstract cells (`Glyph { ch, fg, tile? }`) and `GlyphTerm` is ONE consumer.
neostryder will later add a canvas/PIXI visual-overhaul MOD that renders the same cell stream.
Do NOT couple game logic to `GlyphTerm`, and do NOT collapse the cell-grid seam. Colour must
resolve through data (the z-color table), not hard-coded per-call-site literals.

## IN SCOPE
Each item: match the C exactly and cite the C file:line in a comment.

1. **MAX_COLORS must be 32, BASIC_COLORS 29** (3-model confirmed: grok+codex+terra).
   C `z-color.h:77-78`: arrays are sized 32 with three zero-initialised trailing rows.
   Port `core/src/color.ts:40` exports MAX_COLORS = 29, and a separate
   VISUALS_MAX_COLORS = 32 lives only in `visuals/engine.ts`. Codex also notes the live web
   colour editor cycles only 0..28. FIX: one source of truth, MAX_COLORS 32 /
   BASIC_COLORS 29, trailing rows zero-initialised.
2. **color_char_to_attr fallbacks** (3-model confirmed).
   C `z-color.c:165-184`: NUL and space -> COLOUR_DARK (0); ANY unknown char -> COLOUR_WHITE (1).
   Port `color.ts:139-146` returns COLOUR_SHADE (28) for space and -1 for empty/unknown.
   FIX to the C fallbacks.
3. **color_text_to_attr fallback** (3-model confirmed).
   C `z-color.c:191-201`: unknown colour NAME -> COLOUR_WHITE (1); an empty name matches the
   zero-initialised trailing entry. Port `color.ts:148-156` returns -1, and `mon/bind.ts`
   THROWS when dAttr < 0 instead of accepting white. FIX both the fallback and the caller.
4. **Shade row must not invent metadata**.
   C `z-color.c:154-155`: color_table entry 28 is zero-filled (no index_char, no name); the
   shade RGB lives only in `angband_color_table`. Port `color.ts:135-136` invents
   `char " "`, `name "Shade"`. FIX: RGB only; clear the invented char/name (this is also the
   root cause of item 2).
5. **attr_to_text belongs in core**.
   C `z-color.c:208-214`: `attr_to_text(a)` returns `color_table[a].name` for a < BASIC_COLORS,
   else "Icky". Port has no core export; only `packages/cli/src/spoilers.ts:453-457`
   reimplements it locally. FIX: add the C-faithful helper to core and use it.
6. **message.prf default message colours are never applied**.
   Finding L17-007: BELL / HITPOINT_WARN / AFRAID (and the rest of the message.prf colour
   defaults) stay white in the port. Oracle: `reference/lib/customize/message.prf` +
   the C message-colour lookup. FIX: load and apply those defaults so message types render
   in their C colours.
7. **UI chrome must use the z-color palette, not invented pastel hex**.
   `packages/web/src/ui-colors.ts` defines invented pastel hex values (UI_TEXT, UI_DIM,
   UI_GOLD, UI_BG, UI_MORE, UI_CURSOR ...). The original draws all chrome from the z-color
   table. FIX: derive these from the z-color palette entries the C uses, keeping them as
   named constants so call sites do not change shape. Where no single C colour maps, pick the
   z-color entry the C actually uses at that call site and say which in a comment.

## OUT OF SCOPE (do not attempt)
- Gamma table / build_gamma_table and MULT_BG / BG_* background packing: these serve native
  front ends; leave them (they are logged as concessions).
- Terminal geometry, prompts vs modals, tiles, fonts. Other streams / later work.
- Do NOT touch `packages/borg/**`, `packages/linoleum/**`, or
  `packages/cli/baseline/stats-baseline.json`.

## Rules
- ONLY edit files under `packages/`. Preserve faithful upstream quirks.
- Do NOT change any RNG draw order or count (another stream owns RNG determinism).
- A test may only change if the C justifies it -- say why. Never relax a test to pass.
- Colours are DATA: no per-call-site literals; resolve through the table.

## Verify (chunked, with timeouts; NEVER a monolithic `pnpm test`)
`packages/borg` think/foundation tests HANG (pre-existing) -- always exclude borg.
```
pnpm typecheck
timeout 600 pnpm vitest run packages/core/src/color.test.ts packages/core/src/visuals --testTimeout=20000
timeout 600 pnpm vitest run packages/web --testTimeout=20000
timeout 600 pnpm vitest run packages/core/src/mon packages/core/src/obj --testTimeout=20000
timeout 600 pnpm vitest run packages/cli --testTimeout=20000
```
Check each exit status (124 = hang: STOP and report which file).

## Report (stdout)
Per item: files changed, one-line summary, C citation matched. Then test + typecheck results.
Confirm explicitly that the cell-grid render seam is intact and no game logic depends on
GlyphTerm. End with: `COLOR DONE <n>/7 tests <pass|fail>`. Do NOT commit or push. ASCII only.
