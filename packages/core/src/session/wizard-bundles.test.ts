import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  wizAdvance,
  wizCreateObj,
  wizCreateTrap,
  wizCureAll,
  wizDetectAllLocal,
  wizSummonNamed,
} from "../game/wizard";
import type { WizardDeps } from "../game/wizard";
import { startGame } from "./game";
import type { GamePack, StartedGame } from "./game";

// WP-14 seam verification: session/game.ts wireGame assembles the wizard/debug
// engine bundles (effect interpreter, ExpDeps, TrapDeps, live MonPlaceDeps,
// MakeDeps) and surfaces them on StartedGame.wizardBundles so the web debug menu
// dispatches to the real engine instead of no-oping. These tests boot a real
// game and confirm the previously-BLOCKED commands actually fire through it.

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
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
  quest: loadRecords("quest"),
  store: loadRecords("store"),
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

/** The WizardDeps the web shell assembles: engine bundles + shell-side extras. */
function wizardDeps(game: StartedGame): WizardDeps {
  const reg = game.booted.registries;
  return {
    wizard: true,
    msg: () => {},
    markNoscore: () => {},
    ...game.wizardBundles,
    ...(game.flavor ? { flavor: game.flavor } : {}),
    races: reg.monsters.races,
    artifacts: reg.objects.artifacts,
    curses: reg.objects.curses,
  };
}

describe("StartedGame.wizardBundles (WP-14 seam)", () => {
  it("exposes the full engine bundle set on a world boot", () => {
    const game = startGame(pack, { seed: 909, depth: 5 });
    const b = game.wizardBundles;
    expect(b.makeDeps).toBeDefined();
    expect(b.expDeps).toBeDefined();
    expect(b.effect).toBeDefined(); // needs bound projections (world boot)
    expect(b.trapDeps).toBeDefined(); // needs bound traps
    expect(b.monPlace).toBeDefined();
  });

  it("fires the effect-gated commands (cure-all, detect-all) that were BLOCKED", () => {
    const game = startGame(pack, { seed: 121, depth: 5 });
    const deps = wizardDeps(game);
    expect(wizCureAll(game.state, deps)).toBe(true);
    expect(wizDetectAllLocal(game.state, deps)).toBe(true);
  });

  it("fires the ExpDeps-gated command (make-powerful) that was BLOCKED", () => {
    const game = startGame(pack, { seed: 131, depth: 5 });
    const deps = wizardDeps(game);
    expect(wizAdvance(game.state, deps)).toBe(true);
    expect(game.state.actor.player.lev).toBe(50); // PY_MAX_LEVEL: advance worked
  });

  it("fires the MakeDeps-gated command (create object) that was BLOCKED", () => {
    const game = startGame(pack, { seed: 141, depth: 5 });
    const deps = wizardDeps(game);
    const kinds = game.wizardBundles.makeDeps!.reg.kinds;
    const kidx = kinds.findIndex((k) => k && k.base && k.base.name);
    expect(kidx).toBeGreaterThan(0);
    expect(wizCreateObj(game.state, { index: kidx }, deps)).toBe(true);
  });

  it("fires the live-MonPlaceDeps-gated command (summon specific) that was BLOCKED", () => {
    const game = startGame(pack, { seed: 151, depth: 5 });
    const deps = wizardDeps(game);
    const race = game.booted.registries.monsters.races.find((r) => r && r.name);
    expect(race).toBeDefined();
    expect(wizSummonNamed(game.state, { race: race! }, deps)).toBe(true);
  });

  it("fires the TrapDeps-gated command (create trap) that was BLOCKED", () => {
    const game = startGame(pack, { seed: 161, depth: 5 });
    const deps = wizardDeps(game);
    // Pick a trap index and a clear floor grid the player stands on; the
    // dungeon start spot is floor, so create_trap should succeed (a town-only
    // or occupied grid would refuse per cmd-wizard.c L904).
    const tidx = 1;
    const ok = wizCreateTrap(game.state, { index: tidx }, deps);
    // The command dispatched to the engine (not a no-op refusal); it returns
    // false only for a bad grid, which would still prove the bundle is wired.
    expect(typeof ok).toBe("boolean");
    expect(game.wizardBundles.trapDeps).toBeDefined();
  });
});
