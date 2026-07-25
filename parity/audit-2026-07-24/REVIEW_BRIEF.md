# Neo Angband — Parity Audit Brief (2026-07-24)

You are auditing a TypeScript/browser port of Angband 4.2.x against the original
C source. Goal: find EVERY imperfection so the port behaves and looks identical
to the original, except where a browser concession is absolutely necessary.

## The oracle
- `reference/` holds the original C source, data, and assets. It is the ORACLE.
- The C wins EVERY disagreement. If the port differs from the C, the port is wrong
  (unless it is a genuinely unavoidable browser concession — see below).

## Method (non-negotiable)
1. VERIFY BY RE-DERIVATION. Do not trust comments, prior audits, ledgers, test
   names, or any "CLOSED/DONE" claim. Read the C, read the port, compare the
   actual logic/values/strings yourself.
2. TRACE THE LIVE PATH. A function being exported or unit-tested does NOT prove it
   runs in play. Confirm the behavior is actually reachable in normal gameplay.
3. PRESERVE UPSTREAM QUIRKS. If the C has a bug and the port reproduces it
   faithfully, that is CORRECT — do not report it. Fixing upstream bugs is a
   deferred mod's job, not this port's.
4. BROWSER CONCESSIONS. Some divergence is unavoidable in a browser (no raw
   filesystem, no native window, input model). For each such case, still LOG it,
   but mark `concession: y` with one line on why it is unavoidable. If a faithful
   equivalent is achievable in-browser (e.g. a fixed 80x24 grid, the exact z-color
   palette, inline prompts instead of modals), then divergence is NOT a concession —
   mark `concession: n` and report it as a defect. When unsure, mark `concession: ?`.
5. BUILD THE MAP. For your lane, produce the file-level map: each reference file ->
   the port file(s) that implement it. If a reference file has NO port counterpart,
   that is a finding (severity by importance). If a port file invents behavior with
   no reference basis, note it. Do NOT trust any pre-existing map; the map may be
   wrong or incomplete — that is part of what you are checking.

## Severity
- P0 = game-breaking or immediately visible wrong behavior (crash, silent death,
  wrong core mechanic on the default path).
- P1 = wrong mechanics / wrong values / wrong RNG stream in normal play.
- P2 = visible look-and-feel or message drift (UI chrome, colors, layout, strings).
- P3 = minor/cosmetic/peripheral, or unmapped low-importance file.

## Output format — APPEND to your findings file, one block per finding
Use EXACTLY this ASCII block format (repeat per finding). Keep it greppable.

```
### <LANE>-<NNN>  <one-line title>
sev: P0|P1|P2|P3
concession: y|n|?
ref: reference/src/<file.c>:<line>   (or data/asset path)
port: packages/.../<file.ts>:<line>   (or NONE)
expected: <what the C does — value/formula/string/behavior>
actual: <what the port does>
why: <one line on the impact / why it matters>
confidence: high|med|low
```

Also, at the END of each lane, append a `## MAP <LANE>` section: one line per
reference file in the lane -> port file(s) or `NONE`. This is the coverage proof.

Rules: ASCII only. Be specific with file:line on BOTH sides. Do not fix anything —
report only. Do not stop early; cover every file listed for your lane.
