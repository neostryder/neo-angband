import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearInputQueue, enqueueKeys, isSynthKey } from "./input-queue";

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: Array<(ev: Event) => void> = [];
  return {
    addEventListener: (_t, fn) => void listeners.push(fn),
    removeEventListener: (_t, fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent: (ev) => {
      for (const fn of [...listeners]) fn(ev);
    },
  };
}

/** One real macrotask (the pump paces one key per setTimeout(0)). */
function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("input queue (keymap expansion feed)", () => {
  let got: string[];
  beforeEach(() => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    clearInputQueue();
    got = [];
    win.addEventListener("keydown", (ev) => {
      if (isSynthKey(ev)) got.push((ev as unknown as { key: string }).key);
    });
  });
  afterEach(() => {
    clearInputQueue();
    delete (globalThis as { window?: unknown }).window;
  });

  it("delivers queued keys to window in order, flagged synthetic, none synchronously", async () => {
    enqueueKeys([{ key: "q" }, { key: "c" }]);
    // A modal opened by the first key must get to attach before the next key
    // arrives, so nothing is delivered synchronously.
    expect(got).toEqual([]);
    await macrotask();
    await macrotask();
    await macrotask();
    expect(got).toEqual(["q", "c"]);
  });

  it("isSynthKey is false for a real event", () => {
    expect(isSynthKey(new Event("keydown"))).toBe(false);
  });

  it("clearInputQueue drops keys not yet delivered", async () => {
    enqueueKeys([{ key: "a" }, { key: "b" }, { key: "c" }]);
    await macrotask(); // 'a' delivered
    expect(got).toEqual(["a"]);
    clearInputQueue();
    await macrotask();
    await macrotask();
    await macrotask();
    expect(got).toEqual(["a"]); // b, c were cleared
  });
});
