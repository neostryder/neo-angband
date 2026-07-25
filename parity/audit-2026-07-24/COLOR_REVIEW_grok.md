# COLOR parity review (Grok, independent / adversarial)

Worktree: `C:\Repositories\na-wt-color` (branch `parity/p2-color`)
Diff: `parity/audit-2026-07-24/COLOR_FIX.diff`
Spec: worktree `COLOR_BRIEF.md`
Oracle: `reference/src/z-color.c`, `z-color.h`, `message.c`, `lib/customize/message.prf`
Reviewer stance: skeptical; flag if uncertain. Reviewer did NOT author the patch (Codex did).

Files changed by the patch (git status):
- packages/cli/src/spoilers.ts
- packages/core/src/color.test.ts
- packages/core/src/color.ts
- packages/core/src/mon/bind.ts
- packages/core/src/mon/lore-describe.ts
- packages/core/src/mon/make.ts
- packages/core/src/msg.test.ts
- packages/core/src/msg.ts
- packages/core/src/visuals/engine.ts
- packages/web/src/ui-colors.ts

---

## 1. MAX_COLORS=32 / BASIC_COLORS=29 single source of truth

Oracle: `z-color.h:77-78` defines `MAX_COLORS 32`, `BASIC_COLORS 29`.
`angband_color_table[MAX_COLORS][4]` has rows 0..28 explicit; 29..31 zero.
`color_table[MAX_COLORS]` has rows 0..27 named; 28..31 zero-filled ("Rest to be filled in").

Port check:
- `packages/core/src/color.ts:40-42` -- `MAX_COLORS = 32`, `BASIC_COLORS = 29`. APPROVE.
- `COLOR_TABLE` length 32 with four trailing zero rows (`color.ts:137-146`). APPROVE.
- `packages/core/src/visuals/engine.ts` re-exports `BASIC_COLORS` from color and sets `VISUALS_MAX_COLORS = MAX_COLORS` (no second private 29/32). APPROVE.
- `packages/core/src/mon/make.ts` drops local `const BASIC_COLORS = 29` and imports shared. APPROVE.
- Live web colour editor (`packages/web/src/colors.ts:121-122`): `a = (a +/- 1) % MAX_COLORS` -- cycles 0..31. APPROVE.

No remaining array sized as "29 colours only" for the palette. Literal `29` elsewhere is BASIC_COLORS itself or unrelated (tval MUSHROOM, layout coords, etc.).

**Verdict: APPROVE**

---

## 2. color_char_to_attr: NUL/space -> DARK; unknown -> WHITE; no -1

Oracle `z-color.c:165-184`:
- `c == '\0' || c == ' '` -> COLOUR_DARK
- search `a < BASIC_COLORS` for `index_char`
- else COLOUR_WHITE

Port `color.ts:149-157`:
- `"" | "\0" | " "` -> COLOUR_DARK (empty string is the JS stand-in for no char)
- loop `i < BASIC_COLORS`
- return COLOUR_WHITE
- no -1 path remains

Residual (not a failure of the helper itself): several call sites still guard `attr < 0` as if -1 were possible:
- `packages/core/src/visuals/engine.ts:297,302,336` -- `if (attr < 0) continue` is now dead.
  Consequence: empty color token `""` resolves to COLOUR_DARK and is applied, whereas the old -1 path skipped. Shipped flicker/cycle data is valid so this is likely unreachable; still incomplete cleanup.
- `packages/core/src/player/bind.ts:486` and `packages/core/src/gen/gen-monster.ts:128` still throw on `attr < 0` -- dead throws, harmless.

**Verdict: APPROVE** (helper matches C; dead -1 guards are cleanup debt, not wrong fallbacks)

---

## 3. color_text_to_attr: unknown -> WHITE; empty matches zero row; mon/bind throw

Oracle `z-color.c:191-201`:
- loop `a < MAX_COLORS`, case-insensitive name match
- empty name matches first zero-initialised `color_table[a].name` -> index 28 (COLOUR_SHADE)
- unknown -> COLOUR_WHITE

Port `color.ts:159-167`: matches (empty -> 28 / COLOUR_SHADE, unknown -> WHITE). APPROVE.

`mon/bind.ts:644-648`: removed `if (dAttr < 0) throw ...`. Since neither converter returns negative, the throw was dead after item 2/3. C never throws; it whites out. Malformed monster colour strings silently become white -- that can "mask" content typos, but it is the C contract, not a port invention. Content still has other hard errors (unknown blows, etc.).

`lore-describe.ts` special-cases empty name to DARK/WHITE rather than SHADE. Re-derived: mon-lore.c treats unset `lore_attr_resist/immune` as zero/false (`!level->lore_attr_resist`), i.e. COLOUR_DARK sentinel, not "call color_text_to_attr("")". Empty-name special case is correct; unknown names now go WHITE via the fixed converter (old port mapped unknown to DARK via -1, which was wrong vs C).

**Verdict: APPROVE**

---

## 4. Shade row: no index_char, no name; RGB only in angband_color_table

Oracle `z-color.c:154-155` + static zero-init: entry 28 has no `index_char`/`name` in `color_table`.
RGB `0x28,0x28,0x28` lives only in `angband_color_table[28]` (`z-color.c:60`).

Port:
- `COLOR_TABLE[28..31]`: `char: ""`, `name: ""`, `rgb: [0,0,0]`, zero translate (`color.ts:137-146`)
- `angbandColorTable` special-cases shade to `[0,0x28,0x28,0x28]` on init and reset (`color.ts:179-183,224-227`)
- repo search: no `"Shade"` string remains under packages/

Nothing resolves the invented name "Shade" anymore. `colorTextToAttr("Shade")` -> WHITE (unknown). `attrToText(COLOUR_SHADE)` -> `""` (name of basic row 28).

**Verdict: APPROVE**

---

## 5. attr_to_text in core; spoilers reuse it

Oracle `z-color.c:208-214`:
```
if (a < BASIC_COLORS) return color_table[a].name;
else return "Icky";
```
So a=28 (shade) returns empty name; a>=29 returns "Icky".

Port `color.ts:230-235`:
```
attr >= 0 && attr < BASIC_COLORS ? COLOR_TABLE[attr].name : "Icky"
```
Matches (extra `attr >= 0` is fine; C uses uint8_t).

CLI `packages/cli/src/spoilers.ts`: dropped local reimplementation; imports `attrToText` from core. Output for in-range attrs is identical to C; for shade, correctly empty (old local used invented "Shade" when the table still lied).

**Verdict: APPROVE**

---

## 6. message.prf defaults reach rendering (BELL / HITPOINT_WARN / AFRAID)

Oracle:
- `message.prf:103,115,196` -- BELL, HITPOINT_WARN, AFRAID use `o` (orange); all other listed defaults are `w`.
- `message.c:269-285` -- `message_type_color`: start WHITE; if a type has a stored color != COLOUR_DARK, use it.
- Live C path: `msgt(MSG_HITPOINT_WARN, "*** LOW HITPOINT WARNING! ***")` (`player-util.c:273`), `msgt(MSG_AFRAID, ...)` (`player-attack.c:754`), etc., then UI draws via `message_color(age)`.

Port patch:
- `packages/core/src/msg.ts:24-33,47` hardcodes the three orange defaults into every new `MessageLog`. Effective table matches message.prf for the non-white rows (white fallback covers the rest). Unit-level typeColor math is fine.
- `packages/core/src/msg.test.ts` asserts those three types return COLOUR_ORANGE.

Live play path -- FAILS the brief requirement ("verify the load path is live in play, not just unit-tested"):

1. Web shell does NOT use core `MessageLog` for display. It uses a separate `packages/web/src/messages.ts` `MessageLog` with optional CSS `color?: string` and no MSG-type table (`web/src/main.ts:899`, import from `./messages`).

2. Central sink drops types:
   - `state.msg = (text) => { state.messages?.add(text, 0); ... say(text); }` (`main.ts:907-916`) -- always type 0.
   - `say` / `msglog.push(text)` never passes a colour.

3. Engine side also loses type before the sink:
   - `take-hit.ts:167` passes `"HITPOINT_WARN"` into hooks.
   - `take-hit-hooks.ts:44-51` only uses the type string for `state.sound?.(code)`; text goes through `state.msg?.(text)` untyped.

4. Render paints the message line always as white chrome:
   - `main.ts:4977`: `term.print(0, 0, message.slice(0, cols - 1), UI_TEXT);`
   - History / prev-message paths use text only; no `log.color(age)`.

So: BELL / HITPOINT_WARN / AFRAID orange defaults exist on core MessageLog and pass unit tests, but never colour a cell the player sees. Finding L17-007 is NOT closed for play.

**Verdict: ISSUE: message.prf orange defaults are unit-test-only; live web path is untyped + always UI_TEXT**
- `packages/core/src/msg.ts:29-33,47` (defaults present but unused by UI)
- `packages/web/src/main.ts:907-916` (always `add(text, 0)`; no colour on push)
- `packages/web/src/main.ts:4977` (message line forced UI_TEXT)
- `packages/core/src/game/take-hit-hooks.ts:44-51` (msgt type reduced to sound only)
- `packages/web/src/messages.ts` (shell log has no type->attr map)

---

## 7. web ui-colors.ts chrome from z-color; no invented pastels

`packages/web/src/ui-colors.ts` now derives all UI_* constants via `colorToCss(COLOUR_*)` with C citations (ui-menu curs_attrs, ui-birth yellow, ui-input -more-, ui-display good/bad). No invented pastel hex in that module.

Remaining non-palette `#rrggbb` / off-palette rgb in web production sources (lint-exempt or non-chrome):

| Site | Value | Notes |
|------|--------|--------|
| `web/src/main.ts:4437` | `#3a3a44` | palette-exempt defensive fallback for map lighting helper |
| `web/src/main.ts:4439` | `rgb(...)` | deliberate off-palette torch/light tint (commented) |
| `web/src/main.ts:4816` | `#3a4a6a` | palette-exempt map cursor highlight background |
| `web/src/main.ts:5775` | `#3a3a44` | palette-exempt DOM touch-button border |

These are annotated palette-exempt and are not the UI chrome constants the brief targeted. Comment-only `#00ffff` in ui-colors.ts is in-palette (L_BLUE).

**Verdict: APPROVE** (chrome constants clean; remaining literals listed above)

---

## Test edits audit (color.test.ts +24, msg.test.ts +13)

Rule: tests may change only if C justifies it; never relax to make a bad patch pass.

### packages/core/src/color.test.ts

| Changed assertion | Old | New | Judgment |
|-------------------|-----|-----|----------|
| Table sizing | length MAX_COLORS only (when MAX was 29) | length 32; BASIC_COLORS 29 | NEW C-justified (z-color.h:77-78). Not a relax. |
| Shade metadata | `COLOR_TABLE[SHADE].rgb == [0x28,0x28,0x28]` | char `""`, name `""`, `colorChannel(SHADE,1)==0x28` | RE-TARGETED to C split (RGB in angband_color_table only). Correct; stronger. |
| `colorCharToAttr("q")` | `-1` | `COLOUR_WHITE` | Was encoding WRONG port behavior. New matches z-color.c:183-184. C-justified rewrite, not a silent soften of a correct gate. |
| (added) empty / NUL / space | -- | COLOUR_DARK | NEW C assertions (z-color.c:174-175). |
| `colorTextToAttr("nope")` | `-1` | `COLOUR_WHITE` | Same as char: re-aligned to C (z-color.c:200-201). |
| (added) `colorTextToAttr("")` | -- | COLOUR_SHADE | NEW C assertion (empty matches zero row 28). |
| (added) attrToText suite | -- | White / "" / Icky | NEW C assertions (z-color.c:208-214). |

**color.test.ts overall: NEW/C-aligned assertions. No illegitimate relaxation.**

### packages/core/src/msg.test.ts

| Change | Judgment |
|--------|----------|
| New test `"loads the message.prf orange defaults"` for BELL / HITPOINT_WARN / AFRAID -> COLOUR_ORANGE | NEW assertions of intended C defaults. Does not edit/weaken prior tests (`colors default to white; dark means unset` still intact for type 7). |
| Imports MSG, COLOUR_ORANGE | Support for the new test only. |

**Caveat (does not make the assertions false, but they overclaim "live"):** the new test only exercises core `MessageLog` construction. It does not prove message.prf colours reach GlyphTerm rendering (see item 6 ISSUE). The test is not a relax; it is a narrow unit proof that can give false confidence for the brief's "in play" bar.

**msg.test.ts overall: NEW C-aligned unit assertions; no relaxation of existing expectations.**

---

## Glyph cell-grid seam and GlyphTerm coupling

- `packages/web/src/term.ts:38-44` -- `Glyph { ch, fg, bg?, tile? }` unchanged.
- `GlyphTerm` is a web consumer class only.
- `packages/core/**` has zero imports of GlyphTerm / term.ts (grep clean).
- Game logic continues to emit attrs / abstract cells; colour resolution goes through `color.ts` tables, not GlyphTerm.

**Verdict: APPROVE -- cell-grid seam intact; no game logic depends on GlyphTerm.**

---

## RNG draw order / count

- ATTR_RAND still uses `rng.randint1(BASIC_COLORS - 1)` with BASIC_COLORS still 29 (`mon/make.ts:300`). Same count, shared constant only.
- No new RNG calls introduced in the diff.
- Visuals/color/message edits are non-RNG.

**Verdict: APPROVE -- no RNG draw order/count change.**

---

## Per-item summary

| # | Item | Verdict |
|---|------|---------|
| 1 | MAX_COLORS 32 / BASIC_COLORS 29 SSoT; editor cycles full range | APPROVE |
| 2 | color_char_to_attr NUL/space/unknown; no -1 | APPROVE |
| 3 | color_text_to_attr; mon/bind no throw | APPROVE |
| 4 | Shade row no char/name; RGB in live table only | APPROVE |
| 5 | core attrToText + cli reuse | APPROVE |
| 6 | message.prf colours reach live rendering | **ISSUE** (unit-only; play path untyped + UI_TEXT) |
| 7 | ui-colors from palette; list residual literals | APPROVE |
| T | Test edits relax vs new C asserts | NEW/C-aligned (msg test overclaims "live") |
| G | Glyph seam / no GlyphTerm in core | APPROVE |
| R | RNG order/count | APPROVE |

---

## OVERALL VERDICT

**CONDITIONAL FAIL / NOT APPROVED as a complete 7/7 parity closure.**

Items 1-5, 7, Glyph seam, and RNG are solid and re-derive cleanly from the Oracle. Test edits strengthen toward C rather than paper over wrongness.

**Item 6 is a real miss against the brief:** Codex implemented message.prf orange defaults on core `MessageLog` and unit-tested them, but the live web play path never assigns MSG types to displayed lines and always paints the message row as `UI_TEXT` (white). L17-007 (BELL / HITPOINT_WARN / AFRAID stay white in play) remains open.

Minimum fix direction (not implemented by this review):
1. Preserve MSG type from engine msgt sites through `state.msg` / hooks (or dual-write typed add).
2. Either drive the shell log from core MessageLog colours, or apply `typeColor` when pushing to the web log.
3. Paint `term.print` message line / history with `colorToCss(typeColor)` instead of unconditional UI_TEXT.

Until item 6 is end-to-end, do not mark COLOR DONE 7/7.

ASCII only. Reviewer: Grok. Date: 2026-07-25.
