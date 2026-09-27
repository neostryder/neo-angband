/** A mod intent must have the same game result as the host's keypress buffer. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  inputToken,
  loc,
  NOSCORE,
  runGameLoop,
  saveGame,
  squareIsKnown,
  squareIsOpenLive,
  startGame,
  targetSetLocation,
  type GamePack,
  type PlayerCommand,
  type StartedGame,
} from "@rpgm-tools/neo-angband-core";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { modPluginContext } from "./mod-context";
import { createIntentGate, type PlayerIntent } from "./intent-gate";
import type { InteractionPhase } from "./input-snapshot";
import type { PromptDescriptor } from "./prompt-view";

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8")) as T;
}
function records<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: records("terrain"),
  roomTemplates: records("room_template"),
  vaults: records("vault"),
  dungeonProfiles: records("dungeon_profile"),
  obj: {
    objectBase: loadJson("object_base"), object: loadJson("object"),
    egoItem: loadJson("ego_item"), artifact: loadJson("artifact"),
    curse: loadJson("curse"), brand: loadJson("brand"),
    slay: loadJson("slay"), activation: loadJson("activation"),
    objectProperty: loadJson("object_property"), flavor: loadJson("flavor"),
  } as GamePack["obj"],
  mon: {
    pain: records("pain"), blowMethods: records("blow_methods"),
    blowEffects: records("blow_effects"), monsterSpells: records("monster_spell"),
    monsterBases: records("monster_base"), monsters: records("monster"),
    summons: records("summon"), pits: records("pit"),
  },
  player: {
    races: records("p_race"), classes: records("class"),
    properties: records("player_property"), timed: records("player_timed"),
    shapes: records("shape"), bodies: records("body"),
    history: records("history"), realms: records("realm"),
  },
};

function newGame(): StartedGame {
  return startGame(pack, { seed: 4242, depth: 1 });
}

function fingerprint(game: StartedGame): string {
  return JSON.stringify({
    save: saveGame(game), rng: game.state.rng.getState(),
    turn: game.state.turn, cmdQueue: game.state.cmdQueue ?? [],
  });
}

function harness(game: StartedGame) {
  const buffer: PlayerCommand[] = [];
  let phase: InteractionPhase = "play";
  let prompt: PromptDescriptor | null = null;
  let advances = 0;
  game.state.nextCommand = () => buffer.shift() ?? null;
  const gate = createIntentGate({
    state: game.state,
    registry: game.registry,
    push: (command) => { buffer.push(command); },
    advance: () => { advances++; runGameLoop(game.state, game.registry); },
    snapshotSource: { phase: () => phase, prompt: () => prompt },
  });
  return {
    gate, buffer,
    setPhase: (value: InteractionPhase) => { phase = value; },
    setPrompt: (value: PromptDescriptor | null) => { prompt = value; },
    advances: () => advances,
  };
}

function knownNeighbor(game: StartedGame): { x: number; y: number; dir: number } {
  const p = game.state.actor.grid;
  for (const [dx, dy, dir] of [[-1, -1, 7], [0, -1, 8], [1, -1, 9],
    [-1, 0, 4], [1, 0, 6], [-1, 1, 1], [0, 1, 2], [1, 1, 3]]) {
    const grid = loc(p.x + dx!, p.y + dy!);
    if (game.state.chunk.inBoundsFully(grid) && squareIsKnown(game.state, grid) &&
        squareIsOpenLive(game.state, grid)) return { ...grid, dir: dir! };
  }
  throw new Error("seed has no known walkable neighbor");
}

describe("player intent gate", () => {
  it("leaves the full fingerprint unchanged for every rejection", () => {
    const game = newGame();
    const h = harness(game);
    const token = inputToken(game.state);
    const before = fingerprint(game);
    const cases: [PlayerIntent, () => void][] = [
      [{ kind: "command", command: { code: "hold" } }, () => h.setPhase("modal")],
      [{ kind: "command", command: { code: "hold" } }, () => { h.setPhase("play"); h.setPrompt({ kind: "confirm", promptId: 1, label: "Really?" }); }],
      [{ kind: "command", command: { code: "does-not-exist" } }, () => h.setPrompt(null)],
      [{ kind: "command", command: { code: "walk", dir: 42 } }, () => undefined],
      [{ kind: "command", command: { code: "pathfind", args: { dest: { x: "bad", y: 1 } } } }, () => undefined],
      [{ kind: "travel", x: -1, y: 1 }, () => undefined],
      [{ kind: "command", command: { code: "pathfind", args: { dest: { x: -1, y: 1 } } } }, () => undefined],
      [{ kind: "target", x: -1, y: 1 }, () => undefined],
      [{ kind: "target", midx: -1 }, () => undefined],
      [{ kind: "command", command: { code: "shop-buy", args: { index: 0 } } }, () => undefined],
    ];
    for (const [intent, setup] of cases) {
      setup();
      const result = h.gate.submit(token, intent);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBeTruthy();
      expect(fingerprint(game)).toBe(before);
      expect(h.buffer).toEqual([]);
      expect(h.advances()).toBe(0);
    }
  });

  it("rejects the old token after a command was taken", () => {
    const game = newGame();
    const h = harness(game);
    const token = inputToken(game.state);
    expect(h.gate.submit(token, { kind: "command", command: { code: "hold" } }).accepted).toBe(true);
    const before = fingerprint(game);
    expect(h.gate.submit(token, { kind: "command", command: { code: "hold" } })).toEqual({
      accepted: false, reason: "stale input token",
    });
    expect(fingerprint(game)).toBe(before);
  });

  it("allows store commands only during the store phase", () => {
    const game = newGame();
    const h = harness(game);
    h.setPhase("store");
    const token = inputToken(game.state);
    const before = fingerprint(game);
    expect(h.gate.submit(token, { kind: "command", command: { code: "hold" } }).accepted).toBe(false);
    expect(fingerprint(game)).toBe(before);
    expect(h.gate.submit(token, { kind: "command", command: { code: "shop-exit" } }).accepted).toBe(true);
    expect(h.advances()).toBe(1);
  });

  it("matches a keypress-buffer walk and keeps NOSCORE.BORG clear", () => {
    const direct = newGame();
    const via = newGame();
    const neighbor = knownNeighbor(direct);
    const queue: PlayerCommand[] = [{ code: "walk", dir: neighbor.dir }];
    direct.state.nextCommand = () => queue.shift() ?? null;
    runGameLoop(direct.state, direct.registry);
    const h = harness(via);
    expect(h.gate.submit(inputToken(via.state), {
      kind: "command", command: { code: "walk", dir: neighbor.dir },
    }).accepted).toBe(true);
    expect(saveGame(via)).toEqual(saveGame(direct));
    expect(via.state.actor.player.noscore & NOSCORE.BORG).toBe(0);
  });

  it("matches a keypress-buffer pathfind to a known grid", () => {
    const direct = newGame();
    const via = newGame();
    const { x, y } = knownNeighbor(direct);
    const queue: PlayerCommand[] = [{ code: "pathfind", args: { dest: { x, y } } }];
    direct.state.nextCommand = () => queue.shift() ?? null;
    runGameLoop(direct.state, direct.registry);
    const h = harness(via);
    expect(h.gate.submit(inputToken(via.state), { kind: "travel", x, y }).accepted).toBe(true);
    expect(saveGame(via)).toEqual(saveGame(direct));
    expect(via.state.actor.player.noscore & NOSCORE.BORG).toBe(0);
  });

  it("matches the existing target setter without advancing a turn", () => {
    const direct = newGame();
    const via = newGame();
    const { x, y } = knownNeighbor(direct);
    targetSetLocation(direct.state, loc(x, y));
    const h = harness(via);
    const turn = via.state.turn;
    expect(h.gate.submit(inputToken(via.state), { kind: "target", x, y }).accepted).toBe(true);
    expect(h.advances()).toBe(0);
    expect(via.state.turn).toBe(turn);
    expect(saveGame(via)).toEqual(saveGame(direct));
    expect(via.state.actor.player.noscore & NOSCORE.BORG).toBe(0);
  });

  it("offers ctx.intent only with input:intent", () => {
    const game = newGame();
    const gate = harness(game).gate;
    const manifest = (capabilities: string[]) => ({
      id: "intent-test", name: "Intent Test", version: "1.0.0", shape: "plugin" as const, capabilities,
    });
    const without = modPluginContext("intent-test", {}, game.state, {}, {
      intentGate: gate, capabilities: CapabilitySet.fromManifest(manifest([])),
    });
    const withGrant = modPluginContext("intent-test", {}, game.state, {}, {
      intentGate: gate, capabilities: CapabilitySet.fromManifest(manifest(["input:intent"])),
    });
    expect("intent" in without).toBe(false);
    expect(withGrant.intent).toBe(gate);
  });
});
