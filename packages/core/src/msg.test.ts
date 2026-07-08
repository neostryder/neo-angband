import { describe, expect, it } from "vitest";
import { GameEvents } from "./events";
import {
  COLOUR_DARK,
  COLOUR_WHITE,
  MSG_GENERIC,
  MessageLog,
  Messages,
} from "./msg";

describe("MessageLog", () => {
  it("stores newest-first with age access", () => {
    const log = new MessageLog();
    log.add("first", 0);
    log.add("second", 0);
    expect(log.num()).toBe(2);
    expect(log.str(0)).toBe("second");
    expect(log.str(1)).toBe("first");
    expect(log.str(2)).toBe("");
    expect(log.count(2)).toBe(0);
  });

  it("squashes consecutive duplicates into counts", () => {
    const log = new MessageLog();
    for (let i = 0; i < 5; i++) {
      log.add("The orc sets your hair on fire.", 3);
    }
    expect(log.num()).toBe(1);
    expect(log.count(0)).toBe(5);
    expect(log.type(0)).toBe(3);
    // A different type breaks the squash.
    log.add("The orc sets your hair on fire.", 4);
    expect(log.num()).toBe(2);
  });

  it("count saturates at 0xFFFF like upstream's uint16 check", () => {
    const log = new MessageLog();
    log.add("x", 0);
    for (let i = 0; i < 0x10005; i++) log.add("x", 0);
    // Saturated: further duplicates start a new entry.
    expect(log.count(1)).toBe(0xffff);
    expect(log.num()).toBe(2);
  });

  it("trims the oldest entry beyond capacity", () => {
    const log = new MessageLog(3);
    log.add("a", 0);
    log.add("b", 0);
    log.add("c", 0);
    log.add("d", 0);
    expect(log.num()).toBe(3);
    expect(log.str(2)).toBe("b");
  });

  it("colors default to white; dark means unset", () => {
    const log = new MessageLog();
    log.add("hit", 7);
    expect(log.color(0)).toBe(COLOUR_WHITE);
    log.colorDefine(7, 5);
    expect(log.color(0)).toBe(5);
    log.colorDefine(7, COLOUR_DARK);
    expect(log.color(0)).toBe(COLOUR_WHITE);
    expect(log.color(99)).toBe(COLOUR_WHITE);
  });
});

describe("Messages facade", () => {
  it("msg logs and emits; msgt sounds only when enabled", () => {
    const events = new GameEvents();
    const log = new MessageLog();
    let soundOn = false;
    const m = new Messages(log, events, () => soundOn);
    const emitted: Array<{ kind: string; type: number; msg: string }> = [];
    events.on("message", (_t, d) =>
      emitted.push({ kind: "message", type: d.type, msg: d.msg }),
    );
    events.on("sound", (_t, d) =>
      emitted.push({ kind: "sound", type: d.type, msg: d.msg }),
    );

    m.msg("Hello.");
    expect(log.str(0)).toBe("Hello.");
    expect(log.type(0)).toBe(MSG_GENERIC);

    m.msgt(12, "You feel brave.");
    expect(log.type(0)).toBe(12);
    // Sound disabled: only the two message events.
    expect(emitted.map((e) => e.kind)).toEqual(["message", "message"]);

    soundOn = true;
    m.msgt(12, "You feel braver.");
    expect(emitted.map((e) => e.kind)).toEqual([
      "message",
      "message",
      "sound",
      "message",
    ]);
  });

  it("bell emits the bell event", () => {
    const events = new GameEvents();
    const m = new Messages(new MessageLog(), events);
    let rang = 0;
    events.on("bell", () => rang++);
    m.bell();
    expect(rang).toBe(1);
  });
});
