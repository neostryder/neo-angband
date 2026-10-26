import { describe, expect, it } from "vitest";
import { createLabHook, lastMessages, plainJson } from "./lab-hook";
import type { ModWizard } from "./mod-plugin";

const log = (lines: readonly { text: string; count: number }[]) => ({ all: () => lines });

describe("lab hook messages", () => {
  /* Oldest first, like the web MessageLog. */
  const lines = [{ text: "Welcome.", count: 1 }, { text: "You see a Kobold.", count: 1 }, { text: "You hit it.", count: 2 }];

  it("returns the last n lines oldest first, with repeat counts", () => {
    expect(lastMessages(log(lines), 2)).toEqual([
      { text: "You see a Kobold.", count: 1 },
      { text: "You hit it.", count: 2 },
    ]);
  });

  it("clamps to what exists and treats a bad n as none", () => {
    expect(lastMessages(log(lines), 99)).toHaveLength(3);
    expect(lastMessages(log(lines), -4)).toEqual([]);
    expect(lastMessages(log(lines), Number.NaN)).toEqual([]);
  });
});

describe("lab hook view", () => {
  it("is null without a game and plain JSON with one", () => {
    expect(plainJson(null)).toBeNull();
    const frozen = Object.freeze({ turn: 3, hp: Object.freeze({ cur: 9, max: 12 }), big: 5n });
    expect(plainJson(frozen)).toEqual({ turn: 3, hp: { cur: 9, max: 12 }, big: 5 });
  });

  it("reads the snapshot fresh on every call and carries the seed and wizard through", () => {
    let turn = 1;
    const wizard = { sandboxed: () => false } as unknown as ModWizard;
    const hook = createLabHook({
      screen: () => ["row"],
      size: () => ({ cols: 80, rows: 24 }),
      modal: () => false,
      turn: () => turn,
      seed: () => 4242,
      snapshot: () => ({ turn }),
      log: log([]),
      wizard,
    });
    expect(hook.view()).toEqual({ turn: 1 });
    turn = 2;
    expect(hook.view()).toEqual({ turn: 2 });
    expect(hook.seed()).toBe(4242);
    expect(hook.wizard).toBe(wizard);
    expect(hook.messages()).toEqual([]);
  });
});
