# COLOR parity RE-REVIEW R2 (Grok, independent / adversarial)

Worktree: `C:\Repositories\na-wt-color` (branch `parity/p2-color`)
Prior review: `COLOR_REVIEW_grok.md` (CONDITIONAL FAIL; items 1-5,7 APPROVE; item 6 ISSUE)
New diff: `COLOR_FIX_R2.diff` (26 files; supercedes COLOR_FIX + adds item-6 wiring)
Oracle: `reference/` (z-color.c/h, message.c, message.prf, player-util.c, player-attack.c)
Reviewer stance: maximally skeptical on item 6 (prior catch was unit-test-only). Focus = delta since R1.
Reviewer did NOT author the patch (Codex did).

R2 delta files (beyond R1 COLOR_FIX):
- packages/core/src/effects/interpreter.ts
- packages/core/src/game/context.ts
- packages/core/src/game/effect-attack.ts
- packages/core/src/game/effect-env.ts
- packages/core/src/game/mon-cast.ts
- packages/core/src/game/mon-side.ts
- packages/core/src/game/monster-turn.ts
- packages/core/src/game/player-turn.ts
- packages/core/src/game/ranged-cmd.ts
- packages/core/src/game/take-hit-hooks.ts
- packages/core/src/session/game.ts
- packages/web/src/main.ts
- packages/web/src/messages.ts
- packages/web/src/messages.test.ts
(plus the original color/msg/visuals/ui-colors/cleanup files)

---

## 1. ITEM 6 LIVENESS (message.prf colours on the live play path)

### 1a. What R2 actually built

Core defaults (unchanged intent from R1, still correct):
- `packages/core/src/msg.ts:32-36,50` -- MessageLog starts with DEFAULT_MESSAGE_COLORS for
  MSG.BELL / MSG.HITPOINT_WARN / MSG.AFRAID = colorCharToAttr("o") = COLOUR_ORANGE.
- Matches message.prf:103,115,196; message.c:269-285 white fallback for the rest.

Type plumbing (NEW in R2 -- the real fix attempt):
- `GameState.msg?: (text, type?: MessageType) => void` -- `context.ts`
- `state.messages ??= new MessageLog()` still installed in `session/game.ts:524` for every
  wired game (new + load).
- Web sink (`main.ts:920-929`):
  - `messageTypeCode(type)` resolves string or number
  - `state.messages?.add(text, code)` preserves type (was hard-coded 0 in R1)
  - `events.emit("message", { msg, type: code })` preserves type (was 0)
  - `say(text, type)` -> `pushTypedMessage(..., typeColor, colorToCss)`
- Row 0 paint (`main.ts:4990`): `term.print(..., messageColor)` -- was unconditional UI_TEXT
- History (`screens.ts:1024-1028`): `messageHistoryLines` uses `m.color ?? FG`

### 1b. End-to-end chains that WORK (traced on workspace sources)

**HITPOINT_WARN (player-util.c:273 msgt(MSG_HITPOINT_WARN, ...))**

| Step | File:line | What happens |
|------|-----------|--------------|
| 1 | `player/take-hit.ts:167` | `onMessage("*** LOW HITPOINT WARNING! ***", "HITPOINT_WARN")` |
| 2 | `game/take-hit-hooks.ts:44-45` | `state.msg?.(text, msgt)` (was text-only in R1) |
| 3 | `web/main.ts:920-924` | `code = messageTypeCode("HITPOINT_WARN")` -> MSG.HITPOINT_WARN; `state.messages.add(text, code)` |
| 4 | `web/main.ts:902-916` | `pushTypedMessage` -> `colorToCss(state.messages.typeColor(code))` = orange CSS |
| 5 | `web/main.ts:916` | `messageColor = msglog.latestEntry()?.color` |
| 6 | `web/main.ts:4990` | `term.print(0, 0, message..., messageColor)` |

Verdict for HITPOINT_WARN: LIVE. A real engine emit reaches GlyphTerm row 0 with orange.

**AFRAID -- obvious walk refuse (player-attack.c:754 / do_cmd_walk_test path)**

| Step | File:line |
|------|-----------|
| 1 | `game/player-turn.ts:421-424` | `state.msg?(..., "AFRAID")` |
| 2-6 | same web sink/render chain as above |

**AFRAID -- timed effect on-begin / grade messages**

| Step | File:line |
|------|-----------|
| 1 | content `player_timed.json` AFRAID `msgt: "AFRAID"` |
| 2 | `player/timed.ts:336-337` | `hooks.onMessage?(text, msgt)` |
| 3 | `session/game.ts:1518` / `1101` / mon-side `217` | forward `msgt` to `state.msg` |
| 4-6 | web sink/render |

**BELL type colour table**
- message.prf BELL:o is in DEFAULT_MESSAGE_COLORS.
- C `bell()` (`message.c:383`) is EVENT_BELL / sound, not a text line. Port
  `take-hit-hooks.ts:56` rings sound only -- matches C (no displayed BELL-typed line).
- If any site ever logs with type BELL, typeColor resolves orange. OK for the default table.

### 1c. Residual type-loss site (ISSUE -- same class of bug as R1, narrower)

C `player-attack.c:752-755`:
```
if (player_of_has(p, OF_AFRAID)) {
  equip_learn_flag(p, OF_AFRAID);
  msgt(MSG_AFRAID, "You are too afraid to attack %s!", m_name);
  return false;
}
```

Port splits this:
- Obvious monster: core `player-turn.ts:421-424` emits typed `state.msg(..., "AFRAID")`. LIVE.
- Invisible / tunnel-into-monster / open-into-monster: core returns blows with `verb: "afraid"`;
  the **web shell** reconstructs the C text in `state.onMelee`:

```
// packages/web/src/main.ts:966-969
if (blow.verb === "afraid") {
  say(`You are too afraid to attack ${name}!`);  // NO type arg
  state.sound?.(MSG.AFRAID);
  continue;
}
```

`say(text)` with no type -> `messageTypeCode(undefined)` -> MSG.GENERIC -> white CSS.
This is a real play path (tests in `player-turn.test.ts` explicitly cover invisible AFRAID
falling through to py_attack). C uses msgt(MSG_AFRAID); the shell still paints white.

Minimum fix: `say(\`You are too afraid...\`, MSG.AFRAID)` or `"AFRAID"`.

No other orange-default msgt sites found still dropping type for HITPOINT_WARN.
Several non-orange combat/generic messages still go untyped through `say()` in onMelee;
that matches GENERIC/white and is not an item-6 regression.

### 1d. Do the new tests exercise render/display?

**packages/core/src/msg.test.ts** ("loads the message.prf orange defaults"):
- Constructs core MessageLog, `add` with MSG.*, asserts `log.color(0) === COLOUR_ORANGE`.
- Unit-only typeColor math. Does NOT touch web sink, state.msg, or GlyphTerm.
- Same overclaim risk as R1 for this file alone.

**packages/web/src/messages.test.ts** ("typed live message display") -- NEW:
```
pushTypedMessage(shell, type, type, (code) => core.typeColor(code), colorToCss);
expect(shell colors orange);
expect(messageHistoryLines(shell) colors orange);
```
- Exercises: messageTypeCode, pushTypedMessage, shell MessageLog storage, history line
  colour extraction.
- Does NOT exercise: `main.ts` state.msg sink, take-hit-hooks, term.print / GlyphTerm,
  messageColor variable, or the onMelee AFRAID hole.
- Better than R1 (presentation-boundary helpers, not just core log) but still not a play-path
  integration test. False confidence remains for the residual AFRAID shell site.

### Item 6 verdict: **ISSUE (narrow residual)**

Primary HITPOINT_WARN path and the obvious-walk AFRAID path are now truly live through
typeColor + colorToCss + messageColor + term.print. That closes the R1 "always UI_TEXT +
always type 0" miss for those sites.

Still open:
1. **main.ts:967** invisible/melee-block AFRAID message remains untyped (C msgt loses type).
2. Tests still do not drive the real main.ts / GlyphTerm play path.

Not APPROVE for complete item-6 closure.

---

## 2. CLEANUP (dead attr < 0 guards / throws)

| Site (R1 flag) | R2 status | C alignment |
|----------------|-----------|-------------|
| `visuals/engine.ts` flicker selection (was :297) | `if (selection < 0) continue` REMOVED | empty -> colorCharToAttr("") = COLOUR_DARK; unknown char -> WHITE. C never returns -1. Applying DARK/WHITE is correct, not a silent wrong token. |
| `visuals/engine.ts` flicker step (was :302) | REMOVED | same |
| `visuals/engine.ts` cycle step (was :336) | REMOVED | same |
| `player/bind.ts:486` throw | REMOVED; colorToAttr now pure converter | malformed -> WHITE/DARK per C |
| `gen/gen-monster.ts:128` throw | REMOVED | same |

Empty colour token concern from R1:
- `colorCharToAttr("")` / `"\0"` / `" "` -> COLOUR_DARK (z-color.c:174-175).
- Removing `attr < 0` continue cannot invent a new wrong colour: empty is DARK in C too.
- Unknown tokens that previously skipped now apply WHITE (C unknown path). Correct.

Residual dead code (not in R1 punchlist, note only):
- `mon/lore-describe.ts:472,479` still `return attr < 0 ? COLOUR_WHITE : attr` after
  colorTextToAttr can no longer return -1. Harmless dead branch; lore empty-name helpers
  elsewhere correctly special-case "" to DARK/WHITE vs SHADE.

**Verdict: APPROVE** -- flagged dead guards/throws correctly removed; no silent empty->DARK
divergence from C.

---

## 3. REGRESSION CHECK (items 1-5, 7 previously APPROVE)

| # | Item | R2 impact | Verdict |
|---|------|-----------|---------|
| 1 | MAX_COLORS 32 / BASIC_COLORS 29 SSoT | Unchanged; engine re-exports BASIC_COLORS, VISUALS_MAX_COLORS = MAX_COLORS | still APPROVE |
| 2 | color_char_to_attr NUL/space/unknown | Unchanged; cleanup removes callers that pretended -1 existed | still APPROVE |
| 3 | color_text_to_attr; mon/bind no throw | Unchanged; mon/bind throw still gone | still APPROVE |
| 4 | Shade row no char/name; RGB in angbandColorTable only | Unchanged | still APPROVE |
| 5 | core attrToText + cli spoilers reuse | Unchanged | still APPROVE |
| 7 | ui-colors from palette | Comment-only citation polish in R2; values still colorToCss(COLOUR_*) | still APPROVE |

No evidence R2 reopened 1-5 or 7.

**Verdict: APPROVE -- no regression on previously approved items.**

---

## 4. SEAM + RNG + parallel-branch files

### Glyph cell-grid seam
- `packages/core/**` still has zero imports of GlyphTerm / web term.ts (grep clean).
- Glyph remains `{ ch, fg, bg?, tile? }` consumer-side data.
- Colour still resolves through color.ts / typeColor / colorToCss, not GlyphTerm.
- **APPROVE -- seam intact.**

### RNG
- COLOR_FIX_R2.diff contains no new randint/rng draws.
- mon/make ATTR_RAND still `randint1(BASIC_COLORS - 1)` with shared BASIC_COLORS=29.
- Message type plumbing is pure presentation; no deterministic stream change.
- **APPROVE -- no RNG order/count change.**

### Parallel-branch files (game.ts, main.ts)

**session/game.ts** -- only type-forwarding for this stream:
- mon death/pain message: pass monMessageSoundType into state.msg (was untyped)
- effect onMessage / monBlow msg / world timedHooks onMessage: forward optional msgt
- No unrelated combat/save/world edits visible in the diff hunks.

**web/main.ts** -- only message colour plumbing for this stream:
- messageColor state, say/type, state.msg typed add, term.print messageColor,
  pumpMessages messageColor refresh
- Did NOT fix onMelee AFRAID typing (pre-existing hole left open; see 1c)
- No borg/save/input stream changes in the R2 hunks

**Verdict: APPROVE for seam/RNG; parallel files look colour-scoped (flag residual AFRAID as 1c, not foreign stream contamination).**

---

## 5. Tests that RELAX expectations

Rule: tests may change only if C justifies; never relax to pass a bad patch.

| File | Change | Judgment |
|------|--------|----------|
| color.test.ts | MAX 32 / BASIC 29; shade empty meta; char/text fallbacks WHITE/DARK; attrToText | NEW/C-aligned (same as R1). No relax. |
| msg.test.ts | +orange defaults for BELL/HITPOINT_WARN/AFRAID | NEW assert. Prior white/dark tests intact. No relax. |
| messages.test.ts | +typed live message display via pushTypedMessage + history colours | NEW assert (orange CSS). No prior expectation weakened. Caveat: does not prove main.ts/term path (see 1d). |

**No test was found that relaxes an expectation rather than asserting the C.**

**Verdict: APPROVE (no illegitimate relaxation).**

---

## Per-point summary

| # | Point | Verdict |
|---|-------|---------|
| 1 | Item 6 liveness (play path + tests) | **ISSUE** -- HITPOINT_WARN + obvious AFRAID live; main.ts:967 AFRAID still untyped; tests not full render E2E |
| 2 | Dead attr<0 cleanup | APPROVE |
| 3 | Regression on items 1-5, 7 | APPROVE (no break) |
| 4 | Glyph seam + RNG + parallel files | APPROVE (seam/RNG clean; game.ts/main.ts colour-scoped) |
| 5 | Tests relax vs strengthen | APPROVE (no relax) |

---

## OVERALL VERDICT

**CONDITIONAL FAIL / NOT APPROVED as a complete 7/7 colour closure.**

R2 is a real repair of the R1 item-6 miss, not another unit-test-only facade:
- Types now flow `engine msgt -> state.msg(type) -> MessageLog.add(type) -> typeColor ->
  colorToCss -> shell log color -> messageColor -> term.print`.
- HITPOINT_WARN and the primary AFRAID walk path paint orange in play.

Remaining bar for item 6 / 7-of-7:
1. Type the shell reconstruction of C's py_attack AFRAID line:
   `packages/web/src/main.ts:967` must pass MSG.AFRAID (or "AFRAID") into `say`.
2. Prefer a test that fails if that site regresses (e.g. assert onMelee-afraid path stores
   orange, or a thin integration through pushTypedMessage with MSG.AFRAID from the shell
   call pattern). Optional but closes the false-confidence gap.

Items 1-5 and 7 remain APPROVE. Cleanup, seam, RNG, and test-relaxation checks pass.

Until the residual AFRAID shell site is typed, do not mark COLOR DONE 7/7.

ASCII only. Reviewer: Grok. Date: 2026-07-25. Round: R2.
