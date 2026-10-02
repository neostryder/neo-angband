import { describe, expect, it } from "vitest";
import { decideAutoplayerKey, describeKeyPress } from "./autoplayer-keys";
import type { ControllerKeyAnswer, ControllerKeyPress } from "./mod-plugin";

function press(key: string, mods: Partial<Omit<ControllerKeyPress, "key">> = {}): ControllerKeyPress {
  return { key, ctrl: false, alt: false, shift: false, meta: false, repeat: false, ...mods };
}

const keepAll = (): ControllerKeyAnswer => ({ kind: "keep", message: "Squire is in the zone. Press Escape to take over." });

describe("a key while an autoplayer drives (#334)", () => {
  it("hands back on any key when the mod has no key handler", () => {
    expect(decideAutoplayerKey(press("q"), undefined)).toEqual({ kind: "release", source: "key q" });
  });

  it("never hands back on a modifier or lock key alone, with or without a handler", () => {
    for (const key of ["Shift", "Control", "Alt", "Meta", "OS", "AltGraph", "CapsLock"]) {
      expect(decideAutoplayerKey(press(key), undefined)).toEqual({ kind: "ignore" });
      expect(decideAutoplayerKey(press(key), () => ({ kind: "release" }))).toEqual({ kind: "ignore" });
    }
  });

  it("ignores a key typed into an input method, and window-switching shortcuts", () => {
    const release = (): ControllerKeyAnswer => ({ kind: "release" });
    expect(decideAutoplayerKey(press("a"), release, true)).toEqual({ kind: "ignore" });
    for (const key of ["Dead", "Process", "Unidentified", "KanaMode", "HangulMode"]) {
      expect(decideAutoplayerKey(press(key), undefined)).toEqual({ kind: "ignore" });
    }
    expect(decideAutoplayerKey(press("Tab", { alt: true }), undefined)).toEqual({ kind: "ignore" });
    expect(decideAutoplayerKey(press("Tab", { alt: true, shift: true }), undefined)).toEqual({ kind: "ignore" });
    expect(decideAutoplayerKey(press("d", { meta: true }), undefined)).toEqual({ kind: "ignore" });
    expect(decideAutoplayerKey(press("Tab"), undefined).kind).toBe("release");
  });

  it("hands back on Escape and Ctrl-Z whatever the mod would answer, without asking it", () => {
    let asked = 0;
    const onKey = (): ControllerKeyAnswer => { asked += 1; return { kind: "keep" }; };
    expect(decideAutoplayerKey(press("Escape"), onKey)).toEqual({ kind: "release", source: "key Escape" });
    expect(decideAutoplayerKey(press("z", { ctrl: true }), onKey)).toEqual({ kind: "release", source: "key Ctrl-z" });
    expect(decideAutoplayerKey(press("Z", { ctrl: true, shift: true }), onKey).kind).toBe("release");
    expect(asked).toBe(0);
  });

  it("keeps driving and passes the mod's message on when the mod keeps the key", () => {
    expect(decideAutoplayerKey(press("q"), keepAll)).toEqual({
      kind: "keep", message: "Squire is in the zone. Press Escape to take over.",
    });
    expect(decideAutoplayerKey(press("q"), () => ({ kind: "keep" }))).toEqual({ kind: "keep" });
  });

  it("hands back with the mod's reason when the mod releases", () => {
    expect(decideAutoplayerKey(press("x"), () => ({ kind: "release", reason: "Squire steps aside." }))).toEqual({
      kind: "release", source: "key x, released by the mod", reason: "Squire steps aside.",
    });
  });

  it("hands back and reports a fault when the handler throws or gives a bad answer", () => {
    const thrown = decideAutoplayerKey(press("q"), () => { throw new Error("boom"); });
    expect(thrown).toMatchObject({ kind: "release", source: "key q" });
    expect(thrown.kind === "release" && thrown.fault).toContain("boom");
    const promised = decideAutoplayerKey(press("q"), (() => Promise.resolve({ kind: "keep" })) as never);
    expect(promised).toMatchObject({ kind: "release", source: "key q" });
    expect(promised.kind === "release" && promised.fault).toBeTruthy();
    const badMessage = decideAutoplayerKey(press("q"), (() => ({ kind: "keep", message: 7 })) as never);
    expect(badMessage.kind).toBe("release");
  });

  it("passes the whole press to the handler", () => {
    let seen: ControllerKeyPress | null = null;
    decideAutoplayerKey(press("E", { shift: true, repeat: true }), (p) => { seen = p; return { kind: "keep" }; });
    expect(seen).toEqual(press("E", { shift: true, repeat: true }));
  });

  it("names a key for the log with its modifiers", () => {
    expect(describeKeyPress(press(" "))).toBe("Space");
    expect(describeKeyPress(press("Tab", { alt: true }))).toBe("Alt-Tab");
    expect(describeKeyPress(press("e", { ctrl: true, meta: true }))).toBe("Ctrl-Meta-e");
    expect(describeKeyPress(press("Z", { ctrl: true, shift: true }))).toBe("Ctrl-Shift-Z");
  });
});
