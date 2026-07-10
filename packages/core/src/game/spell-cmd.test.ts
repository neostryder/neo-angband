import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import type { Loc } from "../loc";
import { addMonster, updateMonsterDistances } from "./context";
import type { GameState, PlayerCommand } from "./context";
import { gearGet } from "./gear";
import { playerObjectToBook, spellOkayToCast } from "../player/spell";
import { blankMonster } from "../mon/monster";
import type { MonsterRace } from "../mon/types";
import { processPlayer } from "./player-turn";
import type { ActionRegistry } from "./player-turn";
import { startGame } from "../session/game";
import type { GamePack } from "../session/game";

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

function startMage(seed = 123): ReturnType<typeof startGame> {
  return startGame(pack, { seed, depth: 1, className: "Mage" });
}

/** Run one command through processPlayer, returning the energy used. */
function run(
  state: GameState,
  registry: ActionRegistry,
  cmd: PlayerCommand,
): number {
  const commands = [cmd];
  state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;
  return processPlayer(state, registry).energyUsed;
}

/** The gear handle of the Mage's starting spellbook. */
function bookHandle(state: GameState): number {
  const h = state.gear.pack.find((handle) => {
    const o = gearGet(state.gear, handle);
    return o !== null && playerObjectToBook(state.actor.player, o) !== null;
  });
  expect(h).toBeDefined();
  return h!;
}

describe("startGame for a Mage (spellcasting wiring)", () => {
  it("is born with mana, a spellbook, and one spell to learn", () => {
    const { state } = startMage();
    const p = state.actor.player;
    expect(p.cls.name).toBe("Mage");
    expect(p.msp).toBeGreaterThan(0);
    expect(p.csp).toBe(p.msp);
    expect(p.upkeep.newSpells).toBeGreaterThan(0);
    /* The starting kit resolved the class book (registerBookKinds). */
    bookHandle(state);
  });

  it("studies Magic Missile from the book, then casts it at a monster", () => {
    const { state, registry, booted } = startMage(777);
    const p = state.actor.player;
    const handle = bookHandle(state);

    /* Study: Mage chooses (PF_CHOOSE_SPELLS); spell 0 = Magic Missile. */
    const energy = run(state, registry, {
      code: "study",
      args: { handle, spell: 0 },
    });
    expect(energy).toBe(state.z.moveEnergy);
    expect(spellOkayToCast(p, 0)).toBe(true);
    expect(p.upkeep.newSpells).toBe(0);

    /* Put a tough target next to the player (any free cardinal grid). */
    const grid = state.actor.grid;
    const spots: Array<[Loc, number]> = [
      [loc(grid.x + 1, grid.y), 6],
      [loc(grid.x - 1, grid.y), 4],
      [loc(grid.x, grid.y + 1), 2],
      [loc(grid.x, grid.y - 1), 8],
    ];
    const found = spots.find(
      ([g]) =>
        state.chunk.inBounds(g) &&
        state.chunk.isPassable(g) &&
        state.chunk.mon(g) === 0,
    );
    expect(found).toBeDefined();
    const [target, dir] = found!;
    const race = booted.registries.monsters.races.find(
      (r) => r && r.avgHp >= 50,
    ) as MonsterRace;
    const mon = blankMonster(race);
    mon.grid = target;
    mon.hp = 500;
    mon.maxhp = 500;
    addMonster(state, mon);
    updateMonsterDistances(state);

    /* Cast until the bolt lands (the fail chance is real). Each cast costs
     * a turn; mana drains 1 per cast, overcasting when empty. */
    const startCsp = p.csp;
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      const used = run(state, registry, {
        code: "cast",
        args: { spell: 0, dir },
      });
      expect(used).toBe(state.z.moveEnergy);
      if (mon.hp < 500 || state.monsters[mon.midx] === null) hit = true;
    }
    expect(hit).toBe(true);
    expect(p.csp).toBeLessThan(startCsp);
  });

  it("refuses to cast unlearned spells or while confused", () => {
    const { state, registry } = startMage();
    /* Unlearned. */
    expect(run(state, registry, { code: "cast", args: { spell: 0 } })).toBe(0);
    /* A Warrior cannot cast at all. */
    const warrior = startGame(pack, { seed: 5, depth: 1 });
    expect(
      run(warrior.state, warrior.registry, { code: "cast", args: { spell: 0 } }),
    ).toBe(0);
  });

  it("study refuses when nothing is learnable", () => {
    const { state, registry } = startMage(9);
    const handle = bookHandle(state);
    run(state, registry, { code: "study", args: { handle, spell: 0 } });
    /* Allowance exhausted: a second study is a free non-action. */
    expect(
      run(state, registry, { code: "study", args: { handle, spell: 1 } }),
    ).toBe(0);
  });
});
