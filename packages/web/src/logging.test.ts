/**
 * The renderer's half of the log: which level this launch runs at, which global
 * the bridge is on, and the batching that keeps a disk out of the frame budget.
 *
 * The batching tests exist because the natural-looking implementation is wrong.
 * A debounce - restart the timer on every line - never fires for a game that
 * logs steadily, so the lines nobody has yet are exactly the ones describing
 * what it was doing when it stopped.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  chooseLevel,
  createFileSink,
  LOG_FLUSH_MS,
  logBridge,
} from "./logging";
import type { LogRecord } from "@rpgm-tools/neo-angband-core/log";

const REC: LogRecord = { at: 0, level: "info", area: "t", msg: "m" };

describe("which level this launch runs at", () => {
  it("takes the build's own answer when nothing overrides it", () => {
    expect(chooseLevel({ version: "0.16.0" })).toBe("info");
    expect(chooseLevel({ version: "1.0.0" })).toBe("warn");
  });

  it("lets a stored preference beat the build", () => {
    expect(chooseLevel({ version: "1.0.0", stored: "debug" })).toBe("debug");
    expect(chooseLevel({ version: "0.16.0", stored: "error" })).toBe("error");
  });

  it("lets the URL beat the stored preference", () => {
    /* This is the one somebody is told to do over a support conversation, so it
     * has to work on a machine whose stored preference says otherwise. */
    expect(chooseLevel({ version: "1.0.0", param: "debug", stored: "error" })).toBe("debug");
  });

  it("ignores anything that is not a level, at either layer", () => {
    expect(chooseLevel({ version: "1.0.0", param: "yes", stored: "loud" })).toBe("warn");
    expect(chooseLevel({ version: "1.0.0", param: "", stored: null })).toBe("warn");
    expect(chooseLevel({ version: "1.0.0", param: "INFO" })).toBe("warn");
  });
});

describe("finding the bridge", () => {
  it("reads neoDesktop, which is not the global the host layer is on", () => {
    /* The updater spent its first build wired to `neoHostFs` through an optional
     * property, so the call was `undefined` rather than an error and sixty tests
     * passed over the top of it. Same two globals, same trap. */
    const fn = vi.fn();
    expect(logBridge({ neoDesktop: { log: fn } })).not.toBeNull();
    expect(logBridge({ neoHostFs: { log: fn } })).toBeNull();
    expect(logBridge({ neoDesktop: { call: fn } })).toBeNull();
  });

  it("answers null for a browser, without throwing on any shape", () => {
    expect(logBridge({})).toBeNull();
    expect(logBridge(null)).toBeNull();
    expect(logBridge("neoDesktop")).toBeNull();
    expect(logBridge({ neoDesktop: null })).toBeNull();
  });
});

describe("batching lines to the main process", () => {
  function harness() {
    const sent: string[][] = [];
    const timers: (() => void)[] = [];
    const cleared: number[] = [];
    const file = createFileSink({
      bridge: {
        log: (lines) => {
          sent.push([...lines]);
        },
      },
      setTimeout: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeout: (h) => cleared.push(h as number),
    });
    return { file, sent, timers, cleared };
  }

  it("sends a burst as one message", () => {
    const { file, sent, timers } = harness();
    for (const l of ["a", "b", "c"]) file.sink(REC, l);
    expect(sent).toEqual([]);
    timers[0]?.();
    expect(sent).toEqual([["a", "b", "c"]]);
  });

  it("starts the timer on the FIRST line and does not restart it", () => {
    /* The debounce trap. A steady 200ms of logging would push the deadline
     * forever and the batch would never be sent. */
    const { file, timers } = harness();
    file.sink(REC, "a");
    file.sink(REC, "b");
    file.sink(REC, "c");
    expect(timers).toHaveLength(1);
  });

  it("arms a fresh timer for the next batch once one has gone", () => {
    const { file, sent, timers } = harness();
    file.sink(REC, "a");
    timers[0]?.();
    file.sink(REC, "b");
    expect(timers).toHaveLength(2);
    timers[1]?.();
    expect(sent).toEqual([["a"], ["b"]]);
  });

  it("flushes on demand, and cancels the pending timer when it does", () => {
    const { file, sent, cleared } = harness();
    file.sink(REC, "a");
    file.flush();
    expect(sent).toEqual([["a"]]);
    expect(cleared).toEqual([1]);
  });

  it("sends nothing at all when there is nothing held", () => {
    /* An idle game must not wake the main process every quarter second. */
    const { file, sent } = harness();
    file.flush();
    file.flush();
    expect(sent).toEqual([]);
  });

  it("does not send the same lines twice if flushed after the timer", () => {
    const { file, sent, timers } = harness();
    file.sink(REC, "a");
    timers[0]?.();
    file.flush();
    expect(sent).toEqual([["a"]]);
  });

  it("a bridge that throws costs the batch and not the game", () => {
    /* The channel closes during shutdown, which is exactly when the last lines
     * are being flushed. */
    const file = createFileSink({
      bridge: {
        log: () => {
          throw new Error("channel closed");
        },
      },
      setTimeout: (fn) => {
        fn();
        return 1;
      },
      clearTimeout: () => undefined,
    });
    expect(() => {
      file.sink(REC, "a");
    }).not.toThrow();
  });
});

describe("the interval both processes hold", () => {
  it("is 250, and the desktop package says 250 too", () => {
    /*
     * The value is asserted as well as the agreement. A test that only compared
     * the two would pass an edit that changed BOTH - which is the failure mode
     * of every "these match" assertion, and the reason this one names the
     * number. The renderer cannot import the desktop package (that dependency
     * runs the wrong way, see preload.ts), so the other copy is read as text.
     */
    expect(LOG_FLUSH_MS).toBe(250);
    const desktop = readFileSync(
      new URL("../../desktop/src/bridge-channel.ts", import.meta.url),
      "utf8",
    );
    expect(desktop).toContain("export const LOG_FLUSH_MS = 250;");
  });
});
