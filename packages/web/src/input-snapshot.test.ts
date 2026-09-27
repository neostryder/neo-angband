/**
 * ctx.snapshot()'s host half (input-snapshot.ts): one frozen view of an input
 * wait, gated part by part, that reads nothing into the game.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAgentView, startGame, tokenIsCurrent } from "@rpgm-tools/neo-angband-core";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import type { GamePack } from "@rpgm-tools/neo-angband-core";
import { buildInputSnapshot, buildKnownLevel, type InputSnapshotSource } from "./input-snapshot";
import { modPluginContext } from "./mod-context";
import type { WorldFrame } from "./world-view";


function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  obj: {
    objectBase: loadJson("object_base"),
    object: loadJson("object"),
    egoItem: loadJson("ego_item"),
    artifact: loadJson("artifact"),
    curse: loadJson("curse"),
    brand: loadJson("brand"),
    slay: loadJson("slay"),
    activation: loadJson("activation"),
    objectProperty: loadJson("object_property"),
    flavor: loadJson("flavor"),
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
};

const game = startGame(pack, { seed: 4242, depth: 1 });

function source(over: Partial<InputSnapshotSource> = {}): InputSnapshotSource {
  return {
    state: () => game.state,
    viewDeps: () => ({}),
    phase: () => "play",
    messagePending: () => false,
    frame: () => null,
    knownLevel: (granted) => createAgentView(game.state, undefined, {}, granted).knownLevel!(),
    ...over,
  };
}

function caps(...granted: string[]) {
  return { has: (c: string) => granted.includes(c) };
}

describe("buildInputSnapshot", () => {
  it("reads the bulk level only with map access", () => {
    expect(buildKnownLevel(source(), caps("state:player.read"))).toBeNull();
    expect(buildKnownLevel(source(), caps("state:map.read"))?.cells.length).toBeGreaterThan(0);
  });

  it("returns null from the mod context without map access", () => {
    const capabilities = CapabilitySet.fromManifest({
      id: "known-level-test", name: "Known level test", version: "1.0.0",
      shape: "plugin", facets: ["plugin"], modApi: 1, capabilities: [],
    });
    const ctx = modPluginContext("known-level-test", {}, game.state, {}, {
      snapshotSource: source(), capabilities,
    });
    expect(ctx.knownLevel?.()).toBeNull();
  });
  it("is null before a game exists", () => {
    expect(buildInputSnapshot(source({ state: () => undefined }), undefined)).toBeNull();
  });

  it("stamps the core capture and the host parts with the current token", () => {
    const snap = buildInputSnapshot(source({ phase: () => "more", messagePending: () => true }), undefined)!;
    expect(snap.token).toEqual(snap.core.token);
    expect(tokenIsCurrent(game.state, snap.token)).toBe(true);
    expect(snap.phase).toBe("more");
    expect(snap.messagePending).toBe(true);
    expect(snap.prompt).toBeNull();
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it("withholds the phase and pause without state:interaction.read", () => {
    const snap = buildInputSnapshot(source(), caps("state:player.read"))!;
    expect(snap.phase).toBeNull();
    expect(snap.messagePending).toBeNull();
    expect(snap.core.player).not.toBeNull();
    expect(snap.core.inventory).toBeNull();
  });

  it("reads an open prompt from the source with the interaction grant", () => {
    const open = source({ prompt: () => ({ kind: "item" }) });
    const prompt = buildInputSnapshot(open, caps("state:interaction.read"))!.prompt;
    expect(prompt).toEqual({ kind: "item" });
    expect(Object.isFrozen(prompt)).toBe(true);
    expect(buildInputSnapshot(open, caps("state:player.read"))!.prompt).toBeNull();
  });

  it("copies the frame, and withholds it without state:map.read", () => {
    const frame: WorldFrame = {
      viewport: {
        origin: { x: 0, y: 0 },
        size: { width: 1, height: 1 },
        screenOrigin: { x: 1, y: 1 },
      },
      cells: [],
    };
    const withMap = buildInputSnapshot(source({ frame: () => frame }), caps("state:map.read"));
    const without = buildInputSnapshot(source({ frame: () => frame }), caps("state:interaction.read"));
    expect(withMap!.frame).not.toBeNull();
    expect(withMap!.frame).not.toBe(frame);
    expect(without!.frame).toBeNull();
    expect(without!.phase).toBe("play");
  });

  it("changes no game state, RNG or turn when read repeatedly", () => {
    const before = JSON.stringify({ rng: game.state.rng.getState(), turn: game.state.turn });
    for (let i = 0; i < 5; i++) buildInputSnapshot(source(), undefined);
    expect(JSON.stringify({ rng: game.state.rng.getState(), turn: game.state.turn })).toBe(before);
  });
});
