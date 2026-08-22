import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Gaps #3 and #4 (keyboard input). main.ts is the ground truth for keyboard
// wiring and is never imported directly by a test - it registers real DOM
// listeners and boots the game shell at module load - so, like
// rest-steal-note.test.ts and command-lookup.upstream.test.ts, this pins the
// keydown handler's source shape rather than dispatching synthetic events
// into it.
const MAIN_TS = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("#3: the caret (^) prefix fallback for control commands", () => {
  it("has a pending-caret flag, cleared unconditionally at the top of every keydown", () => {
    // Captured and cleared before any early return (modal, pumping, dead) can
    // run, so it never survives to color a later, unrelated key.
    expect(MAIN_TS).toMatch(/let caretPending = false;/);
    expect(MAIN_TS).toMatch(
      /const wasCaretPending = caretPending;\s*\n\s*caretPending = false;/,
    );
  });

  it("arms the flag on a bare, unmodified caret keypress", () => {
    expect(MAIN_TS).toMatch(
      /!ev\.ctrlKey && !ev\.altKey && !ev\.metaKey && ev\.key === "\^"\) \{\s*\n\s*ev\.preventDefault\(\);\s*\n\s*caretPending = true;/,
    );
  });

  it("resolves a pending caret through the SAME dispatch a real Ctrl chord uses", () => {
    // Both routes call dispatchControlKey with the plain letter, so #3 (the
    // fallback route) and a real modifier chord can never drift apart.
    expect(MAIN_TS).toMatch(/if \(wasCaretPending\) \{/);
    const dispatchCalls = MAIN_TS.match(/dispatchControlKey\(ev\.key, roguelike\)/gu);
    expect(dispatchCalls?.length).toBe(2); // the caret-pending branch and the real ev.ctrlKey branch
  });

  it("drops caret+something-with-no-control-meaning rather than falling through", () => {
    // command.rst: caret and a key with no useful control meaning "has no
    // useful way" to be an underlying command - so a caret followed by e.g.
    // another caret, Escape, or a held Alt/Meta key does nothing, rather than
    // being reinterpreted as a plain keypress by the code below.
    expect(MAIN_TS).toMatch(
      /if \(wasCaretPending\) \{\s*\n\s*if \(!ev\.altKey && !ev\.metaKey && ev\.key\.length === 1 && ev\.key !== "\^"\) \{\s*\n\s*if \(dispatchControlKey\(ev\.key, roguelike\)\) ev\.preventDefault\(\);\s*\n\s*\}\s*\n\s*return;/,
    );
  });
});

describe("#4: the roguelike keyset's caret+direction alter-keys (r_comm.txt)", () => {
  it("imports the shared DIRS_ROGUELIKE direction table from keymap.ts", () => {
    expect(MAIN_TS).toMatch(/import \{ resolveKey, DIRS_ROGUELIKE \} from "\.\/keymap";/);
  });

  it("routes all eight caret+direction letters to the core 'alter' action, roguelike only", () => {
    expect(MAIN_TS).toMatch(
      /if \(roguelike\) \{\s*\n\s*const dir = DIRS_ROGUELIKE\[key\.toLowerCase\(\)\];\s*\n\s*if \(dir !== undefined\) \{\s*\n\s*commandBuffer\.push\(\{ code: "alter", dir \}\);\s*\n\s*advance\(\);\s*\n\s*return true;/,
    );
  });

  it("still keeps the three previously-wired roguelike control aliases (^t, ^v, ^d)", () => {
    // #4 is additive: tunnel/repeat/ignore must not be shadowed by the new
    // eight-way alter dispatch, which is checked after them.
    expect(MAIN_TS).toMatch(/roguelike && \(key === "t" \|\| key === "T"\)/);
    expect(MAIN_TS).toMatch(/roguelike && \(key === "v" \|\| key === "V"\)/);
    expect(MAIN_TS).toMatch(/roguelike && \(key === "d" \|\| key === "D"\)/);
  });
});
