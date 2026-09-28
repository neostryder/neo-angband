import { describe, expect, it } from "vitest";
import { GameEvents } from "@rpgm-tools/neo-angband-core";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import type { GameState } from "@rpgm-tools/neo-angband-core";
import { playerCommandEvent } from "./player-command-event";
import { modPluginContext } from "./mod-context";

describe("the player-command event", () => {
  it("copies and freezes the command, its arguments and the token", () => {
    const args = { dest: { x: 3, y: 4 } };
    const event = playerCommandEvent({ code: "pathfind", args }, "play", null, { epoch: 2, revision: 9 });
    expect(event).toEqual({ code: "pathfind", args: { dest: { x: 3, y: 4 } }, phase: "play", token: { epoch: 2, revision: 9 } });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.args?.["dest"])).toBe(true);
    args.dest.x = 99;
    expect((event.args?.["dest"] as { x: number }).x).toBe(3);
  });

  it("carries the repeated command for repeat and drops arguments that are not data", () => {
    const event = playerCommandEvent({ code: "repeat" }, "play", { code: "walk", dir: 6 }, { epoch: 1, revision: 1 });
    expect(event.repeats).toEqual({ code: "walk", dir: 6 });
    const odd = playerCommandEvent({ code: "x", args: { fn: () => 1 } }, "store", null, { epoch: 1, revision: 1 });
    expect(odd).toEqual({ code: "x", phase: "store", token: { epoch: 1, revision: 1 } });
  });

  it("reaches a mod that declares event:player-command", () => {
    const bus = new GameEvents();
    const capabilities = CapabilitySet.fromManifest({
      id: "squire", name: "Squire", version: "1.0.0", shape: "plugin", modApi: 1, capabilities: ["event:player-command"],
    });
    const ctx = modPluginContext("squire", {}, { events: bus } as GameState, {}, { capabilities });
    const heard: string[] = [];
    ctx.events?.on("player-command", (_type, event) => heard.push(`${event.code}@${event.token.revision}`));
    bus.emit("player-command", playerCommandEvent({ code: "walk", dir: 2 }, "play", null, { epoch: 1, revision: 5 }));
    expect(heard).toEqual(["walk@5"]);
  });
});
