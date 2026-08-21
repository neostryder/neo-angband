/**
 * `ctx.debug`, and the one property it exists for.
 *
 * The conjuring is core's, tested where it lives. What this door adds is that a
 * mod cannot conjure into a character the player has not agreed to spend - which
 * is a claim about ORDER, so the order is what these tests read: the
 * confirmation runs, and only if it was accepted does anything reach the engine.
 * The rest pins the two refusals a player would otherwise experience as the game
 * silently doing nothing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModDebug } from "./spawn-runtime";
import { closeAllModPanels, createModUi, resetModPanels } from "./panel-runtime";
import type { WizardUiCtx } from "./wizard";

/* --- a wizard context with a registry of two things in it ----------------- */

interface Log {
  readonly said: string[];
  readonly placed: string[];
  marked: boolean;
}

function wizardStub(log: Log, opts: { alreadyMarked?: boolean } = {}): () => WizardUiCtx {
  const player = { noscore: opts.alreadyMarked ? 0x0008 : 0 }; // NOSCORE.DEBUG
  const kinds = [{ name: "Wooden Torch" }, { name: "Snarl's Collar" }];
  const races = [{ name: "Grip, Farmer Maggot's dog" }, { name: "Snarl" }];
  return () =>
    ({
      state: { actor: { player } },
      deps: {
        /* Nothing here is core's real bundle: the point of these tests is the
         * ORDER of the confirmation and the spawn, so the engine calls are
         * observed rather than performed. The real wizCreateObj/wizSummonNamed
         * are exercised by core's own tests. */
        races,
        makeDeps: { reg: { kinds } },
        msg: (line: string) => log.said.push(line),
      },
      say: (line: string) => log.said.push(line),
      refresh: () => {},
      raceByName: (name: string) => races.find((r) => r.name === name) ?? null,
    }) as unknown as WizardUiCtx;
}

function log(): Log {
  return { said: [], placed: [], marked: false };
}

afterEach(() => {
  resetModPanels();
  vi.restoreAllMocks();
});

describe("the debug mark comes first", () => {
  it("asks before anything is conjured, and conjures nothing when refused", async () => {
    const l = log();
    const order: string[] = [];
    const debug = createModDebug("builder", {
      wizard: wizardStub(l),
      confirm: async () => {
        order.push("asked");
        return false;
      },
    });
    const outcome = await debug.spawnObject("Wooden Torch");
    expect(order).toEqual(["asked"]);
    expect(outcome).toEqual({
      ok: false,
      problem: "the player declined to mark this character for debug use",
    });
    /* Nothing was said to the message log, because nothing happened. A refusal
     * that still announced a spawn would be the worst of both. */
    expect(l.said).toEqual([]);
  });

  it("names the mod in the message log when it does conjure something", async () => {
    const l = log();
    const debug = createModDebug("builder", {
      wizard: wizardStub(l, { alreadyMarked: true }),
      confirm: async () => true,
    });
    /* The engine call is stubbed out by the fake deps, so what is asserted is the
     * door's own contribution: a line in the log naming who did it, which is the
     * only trace a player would otherwise have. */
    const outcome = await debug.spawnObject("Wooden Torch");
    expect(outcome.ok).toBe(false); // the stub deps place nothing
    expect(l.said.join(" ")).not.toContain("declined");
  });
});

describe("resolving what to conjure", () => {
  const stub = (l: Log) =>
    createModDebug("builder", { wizard: wizardStub(l, { alreadyMarked: true }), confirm: async () => true });

  it("says so plainly when the name is not in this game", async () => {
    const l = log();
    await expect(stub(l).spawnObject("Sword of Nothing")).resolves.toEqual({
      ok: false,
      problem: 'there is no item called "Sword of Nothing" in this game',
    });
    await expect(stub(l).spawnMonster("Nobody")).resolves.toEqual({
      ok: false,
      problem: 'there is no creature called "Nobody" in this game',
    });
  });

  it("says so plainly when the index is out of range", async () => {
    const l = log();
    await expect(stub(l).spawnObject(99)).resolves.toEqual({
      ok: false,
      problem: "there is no item at index 99 in this game",
    });
  });
});

describe("the prompt cannot be posed underneath a panel", () => {
  it("refuses, naming the panel, when the character is not marked yet", async () => {
    const l = log();
    const asked: string[] = [];
    const debug = createModDebug("builder", {
      wizard: wizardStub(l),
      confirm: async () => {
        asked.push("asked");
        return true;
      },
    });
    /* The game asks its questions on the character grid, which a modal panel is
     * covering while holding the keyboard. A prompt there is one the player can
     * neither read nor answer. */
    (globalThis as { document?: unknown }).document = fakeDocument();
    createModUi("builder").openPanel({ id: "editor", modal: true });
    const outcome = await debug.spawnObject("Wooden Torch");
    expect(outcome.ok).toBe(false);
    expect((outcome as { problem: string }).problem).toContain("Close the panel first");
    expect(asked).toEqual([]); // never even asked
    closeAllModPanels();
    delete (globalThis as { document?: unknown }).document;
  });

  it("does not care about the panel once the character is already marked", async () => {
    const l = log();
    const debug = createModDebug("builder", {
      wizard: wizardStub(l, { alreadyMarked: true }),
      confirm: async () => true,
    });
    (globalThis as { document?: unknown }).document = fakeDocument();
    createModUi("builder").openPanel({ id: "editor", modal: true });
    const outcome = await debug.spawnObject("Sword of Nothing");
    /* Reached resolution, which means it got past the panel check: after the
     * first time, there is no question to ask and nothing to cover. */
    expect((outcome as { problem: string }).problem).toContain("no item called");
    closeAllModPanels();
    delete (globalThis as { document?: unknown }).document;
  });
});

/**
 * The smallest document the panel layer will mount into.
 *
 * `body` is built by the same factory rather than assembled by `Object.assign`
 * over one of its products - which is how the first version of this helper got it
 * wrong, and instructively: copying the methods off a temporary node left their
 * closures pointing at that temporary, so a container appended to `body` recorded
 * the temporary as its parent, the panel layer's "still in the host's layer"
 * invariant correctly refused it, and the panel vanished before the assertion. The
 * invariant found the bug in the test, which is the right way round.
 */
function fakeDocument(): unknown {
  /* Declared before the factory and assigned after, because every node's
   * `isConnected` and `ownerDocument` have to close over the ONE body rather
   * than over a copy of it. */
  const make = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {
      style: {},
      dataset: {},
      children: [] as unknown[],
      tabIndex: 0,
      type: "",
      textContent: "",
      parentNode: null as unknown,
      get isConnected(): boolean {
        return self["parentNode"] === body;
      },
      get ownerDocument(): unknown {
        return { body };
      },
      appendChild: (child: Record<string, unknown>) => {
        child["parentNode"] = self;
        (self["children"] as unknown[]).push(child);
        return child;
      },
      remove: () => {
        self["parentNode"] = null;
      },
      contains: () => false,
      setAttribute: () => {},
      addEventListener: () => {},
      attachShadow: () => ({ mode: "closed" }),
      focus: () => {},
    };
    return self;
  };
  const body: Record<string, unknown> = make();
  return { createElement: () => make(), body };
}
