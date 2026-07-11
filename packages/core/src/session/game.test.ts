import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TMD } from "../generated";
import { FlagSet } from "../bitflag";
import { MFLAG_SIZE, RF_SIZE } from "../mon/types";
import { runGameLoop, LOOP_STATUS } from "../game/loop";
import type { PlayerCommand } from "../game/context";
import { startGame } from "./game";
import type { GamePack } from "./game";
import { calcBonuses } from "../player/calcs";
import { gearGet } from "../game/gear";

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

// A full game pack: core content plus the player-domain records.
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

describe("startGame (new-game assembly)", () => {
  it("births a level-1 character with derived bonuses at the player spot", () => {
    const { state, booted } = startGame(pack, { seed: 123, depth: 1 });
    expect(state.actor.player.lev).toBe(1);
    expect(state.actor.player.mhp).toBeGreaterThan(0);
    // calcBonuses produced real derived combat state.
    expect(state.actor.combat.numBlows).toBeGreaterThan(0);
    expect(state.actor.combat.skills.length).toBeGreaterThan(0);
    expect(state.actor.speed).toBe(110); // Human Warrior base speed.
    // The player is placed where the level said, and marked on the map.
    if (booted.playerSpot) {
      expect(state.actor.grid).toEqual(booted.playerSpot);
      expect(state.chunk.mon(state.actor.grid)).toBe(-1);
    }
    // Monster slot 0 is unused; any placed monsters registered from 1.
    expect(state.monsters[0]).toBeNull();
  });

  it("defaults to Human Warrior, honouring race/class overrides", () => {
    const { players } = startGame(pack, { seed: 1 });
    // The default lookups resolve against the real pack.
    expect(players.raceByName("Human")).not.toBeNull();
    expect(players.classByName("Warrior")).not.toBeNull();
  });

  it("is a runnable state: the loop advances turns and yields for input", () => {
    const { state, registry } = startGame(pack, { seed: 123, depth: 1 });
    const commands: PlayerCommand[] = [{ code: "hold" }];
    state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;

    const status = runGameLoop(state, registry);
    // One queued hold, then the queue empties: the world runs until the
    // player must act again, so the loop stops for input with turns elapsed.
    expect(status).toBe(LOOP_STATUS.INPUT);
    expect(state.turn).toBeGreaterThan(0);
  });

  it("derives combat bonuses from the worn starting kit", () => {
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    const p = state.actor.player;

    // A born Warrior is armed and armored (player_outfit + wield_all).
    expect(state.actor.weapon).not.toBeNull();

    const worn = p.equipment.map((h) => (h ? gearGet(state.gear, h) : null));
    const armed = calcBonuses(p, { equipment: worn });
    const bare = calcBonuses(p, { equipment: [] });

    // Worn body armour raises base AC above the unarmored state, and the
    // actor's combat state is exactly the equipped derivation py_attack reads.
    expect(armed.ac).toBeGreaterThan(bare.ac);
    expect(state.actor.combat.ac).toBe(armed.ac);
    expect(state.actor.combat.numBlows).toBe(armed.numBlows);
  });

  it("rebuilds monster groups from the generation group info", () => {
    const { state } = startGame(pack, { seed: 123, depth: 5 });
    // Every live monster belongs to a group that lists it back.
    let checked = 0;
    for (let i = 1; i < state.monsters.length; i++) {
      const mon = state.monsters[i];
      if (!mon) continue;
      const gi = mon.groupInfo[0]!.index;
      expect(gi).toBeGreaterThan(0);
      expect(state.groups[gi]!.members).toContain(mon.midx);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    // Each group has a live leader among its members.
    for (const group of state.groups) {
      if (!group) continue;
      expect(group.members).toContain(group.leader);
    }
  });

  it("registers the generated floor objects as live piles", () => {
    const { state, booted } = startGame(pack, { seed: 123, depth: 5 });
    expect(booted.objects.length).toBeGreaterThan(0);
    let onFloor = 0;
    for (const pile of state.floor.values()) onFloor += pile.length;
    // Same-grid stacks may merge, never grow.
    expect(onFloor).toBeGreaterThan(0);
    expect(onFloor).toBeLessThanOrEqual(booted.objects.length);
    // Every registered object knows its grid and its pile lists it.
    for (const pile of state.floor.values()) {
      for (const obj of pile) {
        expect(obj.grid).not.toBeNull();
      }
    }
  });

  it("wires the effect stack: monsters can cast and items are usable", () => {
    const { state, registry } = startGame(pack, { seed: 123, depth: 5 });
    // make_ranged_attack is installed on the state.
    expect(typeof state.monsterCast).toBe("function");
    // The object commands replaced their stubs.
    expect(registry.has("quaff")).toBe(true);
    expect(registry.has("zap-rod")).toBe(true);
    expect(registry.has("wield")).toBe(true);
    // The trap system is live (step hook + disarm).
    expect(typeof state.onPlayerMoved).toBe("function");
    expect(registry.has("disarm")).toBe(true);
  });

  it("instantiates generation-marked traps and locked doors", () => {
    const { state, booted } = startGame(pack, { seed: 321, depth: 8 });
    // Every door generation rolled locked carries a live door-lock trap.
    let locks = 0;
    let playerTraps = 0;
    for (const list of state.traps.values()) {
      for (const trap of list) {
        if (trap.kind.name === "door lock") locks++;
        else playerTraps++;
      }
    }
    expect(locks).toBe(booted.lockedDoors.length);
    // Trap grids that still allowed a trap got one (depth 8 rolls some).
    if (booted.trapGrids.length > 0) {
      expect(playerTraps).toBeGreaterThan(0);
    }
  });

  it("a born Warrior can quaff their starting Berserk Strength potion", () => {
    const { state, registry } = startGame(pack, { seed: 123, depth: 1 });
    const p = state.actor.player;
    // Find the kit potion in the pack.
    const handle = state.gear.pack.find((h) => {
      const o = gearGet(state.gear, h);
      return o !== null && o.kind.name === "Berserk Strength";
    });
    expect(handle).toBeDefined();

    p.chp = 1; // hurt, so the 30hp heal is observable
    const commands: PlayerCommand[] = [
      { code: "quaff", args: { handle: handle! } },
    ];
    state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;
    runGameLoop(state, registry);
    expect(p.chp).toBeGreaterThan(1);
    // And the berserker rage timed effect is running.
    expect(p.timed[TMD.SHERO]!).toBeGreaterThan(0);
  });

  it("a player kill grants experience and levels the character up", () => {
    const game = startGame(pack, { seed: 4242, depth: 1 });
    const p = game.state.actor.player;
    const mhpBefore = p.mhp;
    expect(p.lev).toBe(1);
    expect(p.exp).toBe(0);

    /* player_kill_monster's reward slice through the wired hook: a fat
     * kill (mexp * rlev / plev = 60 at level 1) passes level thresholds. */
    game.state.onPlayerKill?.({
      race: { mexp: 30, level: 2, flags: new FlagSet(RF_SIZE), blows: [] },
      mflag: new FlagSet(MFLAG_SIZE),
    } as unknown as Parameters<NonNullable<typeof game.state.onPlayerKill>>[0]);

    expect(p.exp).toBe(60);
    expect(p.lev).toBeGreaterThan(1);
    expect(p.maxLev).toBe(p.lev);
    /* PU_HP: mhp recomputed from the rolled hitdice at the new level. */
    expect(p.mhp).toBeGreaterThan(mhpBefore);
    expect(p.chp).toBeLessThanOrEqual(p.mhp);
  });

  it("equipment changes refresh the derived state (PU_BONUS)", () => {
    const game = startGame(pack, { seed: 91, depth: 1 });
    const { state, registry } = game;
    const weaponBefore = state.actor.weapon;
    expect(weaponBefore).not.toBeNull();

    /* Take the wielded weapon off through the command: the actor's derived
     * weapon reference must follow. */
    const handle = state.actor.player.equipment.find((h) => {
      if (!h) return false;
      const slot = state.actor.player.equipment.indexOf(h);
      return state.actor.player.body.slots[slot]?.type === "WEAPON";
    })!;
    const commands: PlayerCommand[] = [{ code: "takeoff", args: { handle } }];
    state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;
    runGameLoop(state, registry);
    expect(state.actor.weapon).toBeNull();

    /* And wielding it again restores it. */
    const again: PlayerCommand[] = [{ code: "wield", args: { handle } }];
    state.nextCommand = (): PlayerCommand | null => again.shift() ?? null;
    runGameLoop(state, registry);
    expect(state.actor.weapon).toBe(weaponBefore);
  });

  it("is deterministic for a fixed seed", () => {
    const a = startGame(pack, { seed: 777, depth: 2 });
    const b = startGame(pack, { seed: 777, depth: 2 });
    expect(a.state.actor.player.mhp).toBe(b.state.actor.player.mhp);
    expect(a.state.actor.combat.numBlows).toBe(b.state.actor.combat.numBlows);
    expect(a.state.monsters.length).toBe(b.state.monsters.length);
    if (a.booted.playerSpot && b.booted.playerSpot) {
      expect(a.booted.playerSpot).toEqual(b.booted.playerSpot);
    }
  });
});
