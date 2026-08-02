/**
 * The mod manager's detail pane (mods.ts rowDetail).
 *
 * Two defects, both reported as "the description does not wrap":
 *
 *  1. The description WAS wrapped. Its siblings were not - the identity line, the
 *     dependency list, the two ratchet warnings and every capability blurb were
 *     pushed as raw strings, and overlay.ts's detail printer hard-slices at
 *     cols-1. So a narrow pane showed one cleanly-wrapped paragraph surrounded by
 *     lines chopped mid-word, which reads exactly like the paragraph being the
 *     broken one.
 *
 *  2. The budget that decides how much description fits was a COUNT of how many
 *     lines each part below was expected to take (rules ? 3 : 0, deps ? 1 : 0,
 *     ...). That is only right while none of them wraps. Once one does, the
 *     reservation is too small, the pane overflows its row budget, and
 *     overlay.ts's print loop breaks out - dropping the END of the pane, which
 *     is where the warnings live. The fix measures the built lines instead of
 *     predicting them, so the two cannot disagree.
 *
 * These are checked on the real return value rather than by reading the source,
 * because "every line fits" is a property of the output, and a source pin would
 * pass just as well if wrapped() were called with the wrong width.
 */

import { describe, expect, it } from "vitest";
import { rowDetail } from "./mods";
import type { CatalogMod } from "./mod-store";

const LONG_DESC =
  "Bundled, opt-in fixes for upstream Angband bugs, in the model of an unofficial " +
  "patch. The mod itself is off by default, like every mod; enable it and you get " +
  "the whole patch set, with each fix a named toggle you can switch off on its own.";

function mod(over: Partial<CatalogMod> = {}): CatalogMod {
  return {
    id: "bug-fixes",
    name: "Bug Fixes (unofficial patch set)",
    version: "1.0.0",
    shape: "content",
    kind: "content",
    enabled: false,
    capabilities: [],
    nondeterministic: false,
    affectsGameplay: false,
    consented: true,
    manifest: {
      id: "bug-fixes",
      name: "Bug Fixes (unofficial patch set)",
      version: "1.0.0",
      shape: "content",
      description: LONG_DESC,
    } as CatalogMod["manifest"],
    ...over,
  };
}

/** The widest line the pane produced, which is what would get sliced. */
function widest(lines: readonly { text: string }[]): number {
  return lines.reduce((n, l) => Math.max(n, l.text.length), 0);
}

describe("every line in the detail pane is wrapped, not just the description", () => {
  /* The widths a real terminal actually hands it, narrow end first. */
  for (const width of [40, 52, 64, 80, 120]) {
    it(`fits within ${width} columns`, () => {
      const m = mod({
        nondeterministic: true,
        affectsGameplay: true,
        manifest: {
          ...mod().manifest,
          dependencies: { core: "*", "some-other-mod-with-a-long-id": ">=2.1.0" },
          rules: [{ flag: "a.b", title: "t", description: "d", default: true }],
        } as CatalogMod["manifest"],
      });
      const lines = rowDetail(m, width);
      /* rowDetail wraps to width - 1, which is where overlay.ts slices. */
      expect(widest(lines)).toBeLessThanOrEqual(width - 1);
    });
  }

  it("wraps the lines that used to bypass it", () => {
    /* Each of these is longer than 40 columns on its own, and each was pushed as
     * one raw ScreenLine before. */
    const m = mod({ nondeterministic: true, affectsGameplay: true });
    const lines = rowDetail(m, 40);
    const text = lines.map((l) => l.text).join("\n").replace(/\n/gu, " ");
    expect(text).toContain("same seed stops giving the same game");
    expect(text).toContain("this character cannot score");
    /* Present, and none of it over the width. */
    expect(widest(lines)).toBeLessThanOrEqual(39);
  });

  it("keeps a wrapped capability bullet visibly one bullet", () => {
    const m = mod({
      kind: "trusted",
      capabilities: ["gameState.read", "commandQueue.write"],
      consented: false,
    });
    const lines = rowDetail(m, 44).map((l) => l.text);
    const first = lines.findIndex((t) => t.trimStart().startsWith("- "));
    expect(first, "no capability bullet was rendered").toBeGreaterThan(-1);
    /* A continuation of a bullet is indented past the "- ", so it cannot be
     * mistaken for body text at the same level. */
    const cont = lines[first + 1];
    if (cont && cont.trim() !== "" && !cont.trimStart().startsWith("- ")) {
      expect(cont.startsWith("    ")).toBe(true);
    }
  });
});

describe("the description budget is measured, not predicted", () => {
  it("never returns more lines than the caller's budget", () => {
    /* The pane's whole contract: overlay.ts silently stops printing at the hint
     * row, so anything over budget is content the player never sees. The old
     * belowCount guess made this fail as soon as a below-line wrapped. */
    for (const budget of [10, 14, 20, 40]) {
      const m = mod({
        nondeterministic: true,
        affectsGameplay: true,
        kind: "trusted",
        capabilities: ["gameState.read", "commandQueue.write", "storage.write"],
        consented: false,
        manifest: {
          ...mod().manifest,
          dependencies: { core: "*" },
          rules: [{ flag: "a.b", title: "t", description: "d", default: true }],
        } as CatalogMod["manifest"],
      });
      const lines = rowDetail(m, 44, budget);
      expect(lines.length, `budget ${budget} overflowed`).toBeLessThanOrEqual(budget);
    }
  });

  it("truncates the description, never the warnings below it", () => {
    /* Which end gets dropped matters: a shortened blurb is a minor loss, a
     * missing "this character cannot score" is not. Asserted on the CONSEQUENCE
     * at the end of each warning rather than on a label at the start, because
     * the way these get lost is the pane cutting the last wrapped line - which a
     * prefix match cannot see. */
    const m = mod({ nondeterministic: true, affectsGameplay: true });
    const lines = rowDetail(m, 44, 12);
    const text = lines.map((l) => l.text).join("\n").replace(/\n/gu, " ");
    expect(text).toContain("(open the mod to read the rest)");
    expect(text).toContain("stops giving the same game");
    expect(text).toContain("this character cannot score");
  });

  it("shows the whole description when there is room", () => {
    const lines = rowDetail(mod(), 80, 99);
    const text = lines.map((l) => l.text).join(" ").replace(/\s+/g, " ");
    expect(text).not.toContain("open the mod to read the rest");
    expect(text).toContain("each fix a named toggle");
  });
});
