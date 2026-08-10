/**
 * The boot-overlay clobber guard.
 *
 * The title screen (news.txt, `news.ts`) was invisible for anyone playing with a
 * graphics mode selected: it WAS drawn, then a BACKGROUND repaint - the tile
 * atlas finishing its fetch, the tile prefs resolving, a ResizeObserver settle,
 * the idle animation tick - called `render()` and painted the town map over it,
 * leaving the title modal silently waiting on a key. The reported symptom was
 * "I get a town map, and pressing a key starts loading or creating a character".
 *
 * `main.ts` is the shell: it boots a real game at module scope and cannot be
 * imported in a unit test. So this guard reads the source and asserts the
 * property that fixed it - every asynchronous, player-did-not-ask-for-this
 * repaint goes through `renderBackground()`, which stands down while an overlay
 * owns the terminal. Deliberate in-command `render()` calls (targeting, locate,
 * the level map) are untouched and must stay that way.
 *
 * If a refactor moves these call sites, update the extraction below - do not
 * delete the assertions; the invariant is what keeps the title screen on screen.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/** The body of a top-level `function`/`async function` declaration, by name. */
function functionBody(src: string, name: string): string {
  /* `[(<]` so a GENERIC declaration matches too (openModal<T>), not only `name(`. */
  const start = src.search(new RegExp(`function ${name}\\s*[(<]`));
  expect(start, `main.ts no longer declares ${name}()`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}

describe("background repaints stand down while an overlay owns the terminal", () => {
  it("defines renderBackground as render() gated on modalDepth", () => {
    expect(MAIN).toMatch(
      /function renderBackground\(\): void \{\s*if \(modalDepth > 0\) return;\s*render\(\);\s*\}/,
    );
  });

  it("routes the graphics-pack repaints through it (the title-screen bug)", () => {
    const body = functionBody(MAIN, "applyTileMode");
    // Every repaint in here is post-boot and possibly post-await: the atlas
    // onReady callback and the loadTilePrefs continuation both land whenever the
    // network does, which is what used to wipe the title.
    //
    // They go through repaintEverything now, one step further out, because the
    // terminal repaints only the cells that CHANGED and a new tile set changes
    // no cell DATA - same codes, same positions, different pictures. So this
    // asserts the whole chain rather than the one name it used to: nothing in
    // applyTileMode may repaint without invalidating, and repaintEverything may
    // not repaint without the modalDepth gate.
    expect(body).toContain("repaintEverything()");
    const outer = functionBody(MAIN, "repaintEverything");
    expect(outer).toContain("term.invalidate()");
    expect(outer).toContain("renderBackground()");
    for (const [name, src] of [
      ["applyTileMode", body],
      ["repaintEverything", outer],
    ] as const) {
      const bare = src.match(/(?<![A-Za-z])render\(\)/g) ?? [];
      expect(bare, `${name} must not call render() directly`).toEqual([]);
    }
  });

  it("routes the resize/reflow repaint through it", () => {
    expect(MAIN).toMatch(/term\.onSizeChanged\(\(\) => renderBackground\(\)\)/);
  });

  it("routes the idle animation tick through it", () => {
    expect(MAIN).toMatch(/animFrame = \(animFrame \+ 1\) & 0xff;[\s\S]{0,400}?renderBackground\(\)/);
  });

  it("still paints the map once when the LAST overlay closes, and not before", () => {
    /* openModal's finally block is what catches up whatever was suppressed - but
     * through renderBackground, not render(). It used to be a bare render(),
     * which meant a NESTED modal closing painted the map over the modal still
     * open underneath: exactly the title-screen failure one level in. It went
     * live with the key_confirm_command gate, whose confirmation modal wiped the
     * item picker it had just approved. renderBackground reads modalDepth AFTER
     * the decrement, so the outermost close still repaints. */
    const body = functionBody(MAIN, "openModal");
    expect(body).toMatch(/modalDepth--;[\s\S]*renderBackground\(\);/);
    const bare = body.match(/(?<![A-Za-z])render\(\)/g) ?? [];
    expect(bare, "openModal must not call render() directly").toEqual([]);
  });
});
