import { describe, expect, it } from "vitest";
import { GAME_EVENT_TYPES, GameEvents } from "./events";
import type { GameEventType } from "./events";

describe("GameEvents", () => {
  it("covers all upstream event types exactly once", () => {
    // 65 named events in the 4.2.6 enum including EVENT_END.
    expect(GAME_EVENT_TYPES).toHaveLength(65);
    expect(new Set(GAME_EVENT_TYPES).size).toBe(GAME_EVENT_TYPES.length);
    expect(GAME_EVENT_TYPES[0]).toBe("map");
    expect(GAME_EVENT_TYPES[GAME_EVENT_TYPES.length - 1]).toBe("end");
  });

  it("dispatches to handlers in registration order", () => {
    const bus = new GameEvents();
    const calls: string[] = [];
    bus.on("message", (_t, d) => calls.push(`a:${d.msg}`));
    bus.on("message", (_t, d) => calls.push(`b:${d.msg}`));
    bus.emit("message", { msg: "hi", type: 0 });
    expect(calls).toEqual(["a:hi", "b:hi"]);
  });

  it("off removes only the given handler", () => {
    const bus = new GameEvents();
    const calls: string[] = [];
    const a = () => calls.push("a");
    const b = () => calls.push("b");
    bus.on("hp", a);
    bus.on("hp", b);
    bus.off("hp", a);
    bus.signal("hp");
    expect(calls).toEqual(["b"]);
  });

  it("onSet/offSet register across multiple types", () => {
    const bus = new GameEvents();
    const seen: GameEventType[] = [];
    const fn = (t: GameEventType) => seen.push(t);
    const set: GameEventType[] = ["hp", "mana", "gold"];
    bus.onSet(set, fn);
    bus.signal("hp");
    bus.signal("mana");
    bus.signal("gold");
    bus.offSet(set, fn);
    bus.signal("hp");
    expect(seen).toEqual(["hp", "mana", "gold"]);
  });

  it("handlers unsubscribing mid-dispatch do not skip peers", () => {
    const bus = new GameEvents();
    const calls: string[] = [];
    const a = () => {
      calls.push("a");
      bus.off("refresh", a);
    };
    const b = () => calls.push("b");
    bus.on("refresh", a);
    bus.on("refresh", b);
    bus.signal("refresh");
    bus.signal("refresh");
    expect(calls).toEqual(["a", "b", "b"]);
  });

  it("removeHandlersOf and removeAllHandlers clear chains", () => {
    const bus = new GameEvents();
    let n = 0;
    bus.on("stats", () => n++);
    bus.on("ac", () => n++);
    bus.removeHandlersOf("stats");
    bus.signal("stats");
    bus.signal("ac");
    expect(n).toBe(1);
    bus.removeAllHandlers();
    bus.signal("ac");
    expect(n).toBe(1);
  });
});
