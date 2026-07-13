import { describe, expect, it } from "vitest";
import { resolveKey } from "./keymap";

/**
 * resolveKey is a pure function (no DOM dependency beyond reading a few
 * KeyboardEvent fields), so a plain object stands in for the event - no
 * jsdom/real KeyboardEvent needed (this repo has neither, see help.test.ts's
 * note on the same point).
 */
function key(k: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: k,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...extra,
  } as KeyboardEvent;
}

describe("resolveKey: original keyset (numpad + arrows), always active", () => {
  it("walks on numpad digits regardless of rogue_like_commands", () => {
    expect(resolveKey(key("6"), false)).toEqual({ kind: "walk", dir: 6 });
    expect(resolveKey(key("6"), true)).toEqual({ kind: "walk", dir: 6 });
    expect(resolveKey(key("8"), false)).toEqual({ kind: "walk", dir: 8 });
  });

  it("walks on arrow keys", () => {
    expect(resolveKey(key("ArrowLeft"))).toEqual({ kind: "walk", dir: 4 });
    expect(resolveKey(key("ArrowRight"))).toEqual({ kind: "walk", dir: 6 });
    expect(resolveKey(key("ArrowUp"))).toEqual({ kind: "walk", dir: 8 });
    expect(resolveKey(key("ArrowDown"))).toEqual({ kind: "walk", dir: 2 });
  });

  it("ignores any key held with a modifier (ctrl/alt/meta)", () => {
    expect(resolveKey(key("6", { ctrlKey: true }))).toBeNull();
    expect(resolveKey(key("ArrowLeft", { altKey: true }))).toBeNull();
    expect(resolveKey(key("h", { metaKey: true }), true)).toBeNull();
  });
});

describe("resolveKey: rogue_like_commands option (this gap's wiring)", () => {
  // main.ts used to hardcode `const roguelikeKeys = false`; the '=' options
  // menu now toggles the real rogue_like_commands option and main.ts reads it
  // live at the resolveKey() call site. resolveKey itself is unchanged - this
  // proves the keyset it already supports actually remaps hjkl/yubn once the
  // option is live.
  it("hjkl/yubn are NOT movement when the option is off (default)", () => {
    for (const k of ["h", "j", "k", "l", "y", "u", "b", "n"]) {
      expect(resolveKey(key(k), false)).toBeNull();
    }
  });

  it("hjkl walk orthogonally and yubn walk diagonally when the option is on", () => {
    expect(resolveKey(key("h"), true)).toEqual({ kind: "walk", dir: 4 });
    expect(resolveKey(key("j"), true)).toEqual({ kind: "walk", dir: 2 });
    expect(resolveKey(key("k"), true)).toEqual({ kind: "walk", dir: 8 });
    expect(resolveKey(key("l"), true)).toEqual({ kind: "walk", dir: 6 });
    expect(resolveKey(key("y"), true)).toEqual({ kind: "walk", dir: 7 });
    expect(resolveKey(key("u"), true)).toEqual({ kind: "walk", dir: 9 });
    expect(resolveKey(key("b"), true)).toEqual({ kind: "walk", dir: 1 });
    expect(resolveKey(key("n"), true)).toEqual({ kind: "walk", dir: 3 });
  });

  it("the shifted (uppercase) roguelike letter runs instead of walks", () => {
    expect(resolveKey(key("H", { shiftKey: true }), true)).toEqual({
      kind: "run",
      dir: 4,
    });
    expect(resolveKey(key("L", { shiftKey: true }), true)).toEqual({
      kind: "run",
      dir: 6,
    });
  });

  it("an unrelated letter stays unbound in either keyset", () => {
    expect(resolveKey(key("q"), false)).toBeNull();
    expect(resolveKey(key("q"), true)).toBeNull();
  });
});
