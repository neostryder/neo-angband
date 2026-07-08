import { describe, expect, it } from "vitest";
import {
  CMD_QUEUE_SIZE,
  COMMAND_INFO,
  CommandQueue,
  cmdCopy,
  cmdGetArg,
  cmdSetArg,
  cmdVerb,
  makeCommand,
} from "./cmd";
import type { Command } from "./cmd";
import { loc } from "./loc";

describe("command metadata", () => {
  it("mirrors the upstream game_cmds table", () => {
    // 112 rows in the 4.2.6 game_cmds[] table.
    expect(COMMAND_INFO.size).toBe(112);
    expect(cmdVerb("walk")).toBe("walk");
    expect(cmdVerb("wield")).toBe("wear or wield");
    expect(cmdVerb("use-rod")).toBe("zap");
    // Codes not in the table have no verb (upstream returns NULL).
    expect(cmdVerb("browse-spell")).toBeNull();
    expect(cmdVerb("ignore")).toBeNull();
    expect(cmdVerb("null")).toBeNull();
  });

  it("keeps upstream repeat metadata", () => {
    const open = COMMAND_INFO.get("open");
    expect(open).toEqual({
      verb: "open",
      repeatAllowed: true,
      canUseEnergy: true,
      autoRepeatN: 99,
    });
    const rest = COMMAND_INFO.get("rest");
    expect(rest?.repeatAllowed).toBe(false);
    expect(rest?.canUseEnergy).toBe(true);
  });
});

describe("command args", () => {
  it("set/get round-trips with type checking", () => {
    const cmd = makeCommand("walk");
    cmdSetArg(cmd, "direction", { type: "direction", value: 6 });
    cmdSetArg(cmd, "point", { type: "point", value: loc(3, 4) });
    expect(cmdGetArg(cmd, "direction", "direction")?.value).toBe(6);
    expect(cmdGetArg(cmd, "point", "point")?.value).toEqual(loc(3, 4));
    // Wrong type -> null (CMD_ARG_WRONG_TYPE).
    expect(cmdGetArg(cmd, "direction", "number")).toBeNull();
    // Absent -> null (CMD_ARG_NOT_PRESENT).
    expect(cmdGetArg(cmd, "nope", "number")).toBeNull();
  });

  it("cmdCopy deep-copies the args map", () => {
    const cmd = makeCommand("drop");
    cmdSetArg(cmd, "quantity", { type: "number", value: 5 });
    const copy = cmdCopy(cmd);
    cmdSetArg(copy, "quantity", { type: "number", value: 9 });
    expect(cmdGetArg(cmd, "quantity", "number")?.value).toBe(5);
    expect(cmdGetArg(copy, "quantity", "number")?.value).toBe(9);
  });
});

describe("CommandQueue", () => {
  it("executes pushed commands in FIFO order", () => {
    const q = new CommandQueue();
    const seen: string[] = [];
    q.register("walk", (c) => seen.push(`walk:${c.context}`));
    q.register("pickup", () => seen.push("pickup"));
    expect(q.push("walk")).toBe(true);
    expect(q.push("pickup")).toBe(true);
    q.execute("game");
    expect(seen).toEqual(["walk:game", "pickup"]);
  });

  it("rejects codes not in the game_cmds table", () => {
    const q = new CommandQueue();
    expect(q.push("browse-spell")).toBe(false);
    expect(q.push("ignore")).toBe(false);
  });

  it("enforces the upstream capacity (CMD_QUEUE_SIZE - 1 pending)", () => {
    const q = new CommandQueue();
    for (let i = 0; i < CMD_QUEUE_SIZE - 1; i++) {
      expect(q.push("hold")).toBe(true);
    }
    expect(q.push("hold")).toBe(false);
  });

  it("repeat duplicates the last non-background command", () => {
    const q = new CommandQueue();
    const seen: string[] = [];
    q.register("tunnel", (c) => {
      seen.push("tunnel");
      // Stop auto-repeat so the test stays bounded.
      q.setRepeat(0);
    });
    q.push("tunnel");
    q.execute("game");
    expect(q.pushCopy(makeCommand("repeat"))).toBe(true);
    q.execute("game");
    expect(seen).toEqual(["tunnel", "tunnel"]);
  });

  it("repeat fails when nothing was executed or repeat is disabled", () => {
    const q = new CommandQueue();
    // Nothing executed yet: repeat_prev_allowed is still false.
    expect(q.pushCopy(makeCommand("repeat"))).toBe(false);
    const seen: string[] = [];
    q.register("inscribe", () => {
      seen.push("inscribe");
      q.disableRepeat();
    });
    q.push("inscribe");
    q.execute("game");
    expect(q.pushCopy(makeCommand("repeat"))).toBe(false);
    expect(seen).toEqual(["inscribe"]);
  });

  it("auto-repeats repeat-allowed commands until repeats run out", () => {
    const q = new CommandQueue();
    let runs = 0;
    q.register("open", () => {
      runs++;
      if (runs >= 3) q.cancelRepeat();
    });
    q.push("open");
    q.execute("game");
    // Auto-repeat n=99 keeps re-running the command until canceled.
    expect(runs).toBe(3);
  });

  it("non-repeatable commands clear nrepeats", () => {
    const q = new CommandQueue();
    let runs = 0;
    q.register("rest", () => {
      runs++;
    });
    q.pushRepeat("rest", 10);
    q.execute("game");
    expect(runs).toBe(1);
    expect(q.isRepeating()).toBe(false);
  });

  it("coercion can substitute or consume commands", () => {
    const q = new CommandQueue();
    const seen: string[] = [];
    q.register("walk", () => seen.push("walk"));
    q.register("command-monster", () => seen.push("command-monster"));
    q.setCoercion((cmd) =>
      cmd.code === "walk" ? "command-monster" : cmd.code,
    );
    q.push("walk");
    q.execute("game");
    q.setCoercion(() => "handled");
    q.push("walk");
    q.execute("game");
    expect(seen).toEqual(["command-monster"]);
  });

  it("flush drops pending commands; release also clears repeat state", () => {
    const q = new CommandQueue();
    let runs = 0;
    q.register("hold", () => runs++);
    q.push("hold");
    q.flush();
    q.execute("game");
    expect(runs).toBe(0);
    q.push("hold");
    q.execute("game");
    expect(runs).toBe(1);
    q.release();
    expect(q.pushCopy(makeCommand("repeat"))).toBe(false);
  });
});
