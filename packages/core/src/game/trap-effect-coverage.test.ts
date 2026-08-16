/**
 * "Trap-created terrain effects that need unported effect handlers fizzle
 * silently" (parity/ledger/game-trap.yaml).
 *
 * That claim was written when the effect stack was mostly stubs, and nothing
 * could answer whether it still held: `EffectRegistry.coverage()` returns
 * counts, and the counts taken from `registerCoreHandlers` alone say "stub"
 * about handlers that `wireGame` re-registers for real. So the question was
 * unanswerable by construction, and the note survived on nobody being able to
 * disprove it.
 *
 * This classifies the WHOLE surface instead of sampling it: every effect any
 * trap in trap.txt can run, resolved against the registry a LIVE game builds.
 * A future trap kind that reaches for a stubbed effect fails here rather than
 * fizzling in play.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "../session/game.js";
import type { GamePack } from "../session/game.js";
import { EFFECT_ENTRIES } from "../generated/index.js";
import { EffectRegistry } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
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

/** Every `eff` name anywhere in trap.json, effect and effect-xtra chains alike. */
function trapEffectNames(): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (typeof rec["eff"] === "string") found.add(rec["eff"]);
    Object.values(rec).forEach(walk);
  };
  walk(pack.trap);
  return [...found].sort();
}

const CODE_BY_NAME = new Map<string, number>(
  EFFECT_ENTRIES.map((e, i) => [e.name as string, i + 1] as const),
);

describe("every effect a trap can run is live in a real game", () => {
  it("classifies the whole trap effect surface, and none of it is a stub", () => {
    const names = trapEffectNames();
    /* The list must not be empty, or this test passes by measuring nothing -
     * the same shape as an empty output channel. */
    expect(names.length).toBeGreaterThan(10);

    const game = startGame(pack, { seed: 24601, depth: 5 });
    const registry = game.effects;
    expect(registry).toBeTruthy();

    const byStatus: Record<string, string[]> = {};
    for (const name of names) {
      const code = CODE_BY_NAME.get(name);
      expect(code, `trap.txt names an effect the build has no code for: ${name}`)
        .toBeDefined();
      const status = registry!.statusOf(code!) ?? "unregistered";
      (byStatus[status] ??= []).push(name);
    }

    /* Named rather than counted, so a failure says WHICH trap effect went
     * dark instead of that the number moved. */
    expect(byStatus["stub"] ?? []).toEqual([]);
    expect(byStatus["unregistered"] ?? []).toEqual([]);
    expect(
      [...(byStatus["implemented"] ?? []), ...(byStatus["partial"] ?? [])].sort(),
    ).toEqual(names);
  });

  it("the core-only registry DOES stub them, so the live check is not vacuous", () => {
    /* The control: without it, "no stubs" could equally mean nothing is ever
     * stubbed and the assertion above measures nothing. registerCoreHandlers is
     * the worldless baseline; wireGame is what upgrades these, and this is the
     * difference being measured. */
    const bare = new EffectRegistry();
    registerCoreHandlers(bare);
    const stubbed = trapEffectNames().filter(
      (n) => bare.statusOf(CODE_BY_NAME.get(n)!) === "stub",
    );
    expect(stubbed.length).toBeGreaterThan(5);
  });
});
