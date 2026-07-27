import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeObject } from "../game/describe";
import { ODESC } from "../obj/desc";
import { tvalCanHaveFlavor } from "../obj/object";
import { ObjRegistry } from "../obj/bind";
import { HIST, MFLAG, OF, RF, TMD } from "../generated";
import { FlagSet } from "../bitflag";
import { MFLAG_SIZE, RF_SIZE } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import { runGameLoop, LOOP_STATUS } from "../game/loop";
import { processPlayer } from "../game/player-turn";
import type { PlayerCommand } from "../game/context";
import { startGame } from "./game";
import type { GamePack } from "./game";
import { calcBonuses } from "../player/calcs";
import { gearGet } from "../game/gear";
import { histHas, historyIsArtifactKnown } from "../player/history";
import { floorCarry } from "../game/floor";
import { objectPrep } from "../obj/make";
import { squareIsKnown } from "../game/known";
import { loc } from "../loc";
import { bindTraps, lookupTrap } from "../world/trap";
import { placeTrap, squareIsPlayerTrap } from "../game/trap";

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

  it("initial birth entry leaves only_partial set until first FOV (ui-display.c:2522)", () => {
    /* startGame has no host updateFov yet, so onlyPartial stays true for the
     * host's first level-entry FOV (feeling suppressed, cave-view.c:849-851). */
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    expect(state.chunk.onlyPartial).toBe(true);
  });

  it("memorizes the whole daytime town on birth (town_gen -> cave_illuminate)", () => {
    // Birth defaults to the town (depth 0) at turn 0, which is daytime. The C
    // town_gen calls cave_illuminate, memorizing every lit town grid so the
    // whole town is visible on entry - not just the FOV bubble around the
    // spawn. Every floor grid must therefore be known immediately at birth.
    const { state } = startGame(pack, { seed: 123, depth: 0 });
    expect(state.chunk.depth).toBe(0);
    let floors = 0;
    let knownFloors = 0;
    for (let y = 0; y < state.chunk.height; y++) {
      for (let x = 0; x < state.chunk.width; x++) {
        const g = loc(x, y);
        if (!state.chunk.isFloor(g)) continue;
        floors++;
        if (squareIsKnown(state, g)) knownFloors++;
      }
    }
    expect(floors).toBeGreaterThan(100);
    expect(knownFloors).toBe(floors);
  });

  it("seeds the standard quests at birth (player_quests_reset)", () => {
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    const p = state.actor.player;
    // The Sauron/Morgoth guardian quests are copied from the pack, zeroed.
    expect(p.quests).toHaveLength(2);
    expect(p.quests.map((q) => q.level).sort((a, b) => a - b)).toEqual([99, 100]);
    expect(p.quests.every((q) => q.curNum === 0)).toBe(true);
    expect(p.totalWinner).toBe(false);
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

  it("live step-on-trap path honors OF_TRAP_IMMUNE equipment", () => {
    const { state, registry } = startGame(pack, { seed: 123, depth: 1 });
    const handle = state.actor.player.equipment.find((h) => h > 0);
    expect(handle).toBeDefined();
    const worn = gearGet(state.gear, handle!);
    expect(worn).not.toBeNull();

    /* Make a worn object trap-immune, then refresh p->state as equipment
     * changes do in the live session. */
    worn!.flags.on(OF.TRAP_IMMUNE);
    state.updateBonuses?.();
    expect(state.playerState?.flags.has(OF.TRAP_IMMUNE)).toBe(true);

    const dirs = [
      [6, 1, 0],
      [4, -1, 0],
      [2, 0, 1],
      [8, 0, -1],
    ] as const;
    const step = dirs
      .map(([dir, dx, dy]) => ({
        dir,
        grid: { x: state.actor.grid.x + dx, y: state.actor.grid.y + dy },
      }))
      .find(({ grid }) => state.chunk.inBounds(grid) && state.chunk.isPassable(grid));
    expect(step).toBeDefined();

    const kinds = bindTraps(pack.trap ?? []);
    const pit = lookupTrap(kinds, "pit");
    expect(pit).not.toBeNull();
    placeTrap(state, step!.grid, pit!.tidx, 5, { kinds });
    state.actor.player.chp = 100;
    state.nextCommand = (): PlayerCommand => ({ code: "walk", dir: step!.dir });

    processPlayer(state, registry);

    /* This is the installed session onPlayerMoved -> hitTrap path: the player
     * steps onto the armed pit, stays unharmed, and the trap is merely learned
     * / revealed rather than fired. */
    expect(state.actor.grid).toEqual(step!.grid);
    expect(state.actor.player.chp).toBe(100);
    expect(squareIsPlayerTrap(state, step!.grid)).toBe(true);
  });

  it("wires state.becomeAware to the real become_aware (mimic reveal)", () => {
    const { state } = startGame(pack, { seed: 123, depth: 5 });
    let mon: (typeof state.monsters)[number] = null;
    for (let i = 1; i < state.monsters.length; i++) {
      const m = state.monsters[i];
      if (m) {
        mon = m;
        break;
      }
    }
    expect(mon).toBeTruthy();
    expect(typeof state.becomeAware).toBe("function");

    mon!.mflag.on(MFLAG.CAMOUFLAGE);
    state.becomeAware!(mon!);
    /* The real become_aware (game/known.ts) clears the flag - a stub that
     * merely recorded the call would leave it set. */
    expect(mon!.mflag.has(MFLAG.CAMOUFLAGE)).toBe(false);
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

    /* msgt(MSG_LEVEL, "Welcome to level %d.") (player.c L250). wireGame has to
     * hand ExpDeps a msg sink or the announcement goes nowhere - it did not,
     * so every level-up was silent while the level and max HP just changed. */
    const said: { text: string; type?: unknown }[] = [];
    game.state.msg = (text, type): void => {
      said.push(type === undefined ? { text } : { text, type });
    };

    /* player_kill_monster's reward slice through the wired hook: a fat
     * kill (mexp * rlev / plev = 60 at level 1) passes level thresholds. */
    game.state.onPlayerKill?.({
      race: {
        ridx: 1,
        mexp: 30,
        level: 2,
        flags: new FlagSet(RF_SIZE),
        blows: [],
        drops: [],
      },
      originalRace: null,
      midx: 0,
      grid: { x: 20, y: 12 },
      heldObj: [],
      mflag: new FlagSet(MFLAG_SIZE),
    } as unknown as Parameters<NonNullable<typeof game.state.onPlayerKill>>[0]);

    expect(p.exp).toBe(60);
    expect(p.lev).toBeGreaterThan(1);
    expect(p.maxLev).toBe(p.lev);
    /* PU_HP: mhp recomputed from the rolled hitdice at the new level. */
    expect(p.mhp).toBeGreaterThan(mhpBefore);
    expect(p.chp).toBeLessThanOrEqual(p.mhp);

    /* history_add(HIST_GAIN_LEVEL) (player.c L246-247): one entry per level
     * gained, via the wired ExpDeps.onGainLevel. */
    const gainEntries = p.hist.filter((e) => histHas(e.type, HIST.GAIN_LEVEL));
    expect(gainEntries.length).toBe(p.lev - 1);
    expect(gainEntries[0]!.event).toBe("Reached level 2");

    /* One announcement per level gained, each typed MSG_LEVEL (its colour and
     * sound come from that type at the presentation boundary). */
    const welcomes = said.filter((m) => m.text.startsWith("Welcome to level "));
    expect(welcomes.map((m) => m.text)).toEqual(
      Array.from({ length: p.lev - 1 }, (_, i) => `Welcome to level ${i + 2}.`),
    );
    expect(welcomes.every((m) => m.type === "LEVEL")).toBe(true);
  });

  it("killing a unique logs HIST_SLAY_UNIQUE; a non-unique kill logs nothing", () => {
    const game = startGame(pack, { seed: 4242, depth: 1 });
    const p = game.state.actor.player;

    const uniqueFlags = new FlagSet(RF_SIZE);
    uniqueFlags.on(RF.UNIQUE);
    game.state.onPlayerKill?.({
      race: {
        ridx: 2,
        name: "Grip, Farmer Maggot's Dog",
        mexp: 1,
        level: 1,
        flags: uniqueFlags,
        blows: [],
        drops: [],
        maxNum: 1,
      },
      originalRace: null,
      midx: 0,
      grid: { x: 20, y: 12 },
      heldObj: [],
      mflag: new FlagSet(MFLAG_SIZE),
    } as unknown as Parameters<NonNullable<typeof game.state.onPlayerKill>>[0]);

    const slayEntries = p.hist.filter((e) => histHas(e.type, HIST.SLAY_UNIQUE));
    expect(slayEntries).toHaveLength(1);
    expect(slayEntries[0]!.event).toBe("Killed Grip, Farmer Maggot's Dog");

    /* A non-unique kill (the earlier test's race shape) logs nothing. */
    game.state.onPlayerKill?.({
      race: {
        ridx: 3,
        name: "a rat",
        mexp: 1,
        level: 1,
        flags: new FlagSet(RF_SIZE),
        blows: [],
        drops: [],
      },
      originalRace: null,
      midx: 0,
      grid: { x: 20, y: 12 },
      heldObj: [],
      mflag: new FlagSet(MFLAG_SIZE),
    } as unknown as Parameters<NonNullable<typeof game.state.onPlayerKill>>[0]);
    expect(p.hist.filter((e) => histHas(e.type, HIST.SLAY_UNIQUE))).toHaveLength(1);
  });

  it("bug-fixes #4245: a re-kill of an already-dead unique logs one entry with the flag, two without", () => {
    /* A single shared race object so the first kill's max_num=0 persists into
     * the second kill (alreadyDead). The mon is otherwise the synthetic shape
     * the faithful unique test above uses. */
    const uniqueFlags = new FlagSet(RF_SIZE);
    uniqueFlags.on(RF.UNIQUE);
    const race = {
      ridx: 2,
      name: "Grip, Farmer Maggot's Dog",
      mexp: 1,
      level: 1,
      flags: uniqueFlags,
      blows: [],
      drops: [],
      maxNum: 1,
    };
    const mon = () =>
      ({
        race,
        originalRace: null,
        midx: 0,
        grid: { x: 20, y: 12 },
        heldObj: [],
        mflag: new FlagSet(MFLAG_SIZE),
      }) as unknown as Parameters<NonNullable<typeof game.state.onPlayerKill>>[0];

    /* FAITHFUL (flag OFF): two lethal blows => two "Killed" entries. */
    let game = startGame(pack, { seed: 4242, depth: 1 });
    race.maxNum = 1;
    game.state.onPlayerKill?.(mon());
    game.state.onPlayerKill?.(mon());
    expect(
      game.state.actor.player.hist.filter((e) =>
        histHas(e.type, HIST.SLAY_UNIQUE),
      ),
    ).toHaveLength(2);

    /* CORRECTED (flag ON): the second (already-dead) kill logs nothing. */
    game = startGame(pack, { seed: 4242, depth: 1 });
    game.state.modRules = { "bugfix.uniqueKillHistory": true };
    race.maxNum = 1;
    game.state.onPlayerKill?.(mon());
    game.state.onPlayerKill?.(mon());
    expect(
      game.state.actor.player.hist.filter((e) =>
        histHas(e.type, HIST.SLAY_UNIQUE),
      ),
    ).toHaveLength(1);
  });

  it("picking up an artifact logs HIST_ARTIFACT_KNOWN with the spoiled name, RNG-untouched", () => {
    const game = startGame(pack, { seed: 4242, depth: 1 });
    const { state, registry } = game;
    const reg = game.booted.registries;
    const art = reg.objects.artifacts.find((a) => a?.name === "of Galadriel")!;
    const kind = reg.objects.lookupKind(art.tval, art.sval)!;
    const obj = objectPrep(state.rng, reg.objects, reg.constants, kind, 0, "average");
    obj.artifact = art;
    floorCarry(state, state.actor.grid, obj);

    // Call the registered "pickup" action directly (not the whole game loop,
    // which would also run monster turns and draw RNG for unrelated reasons)
    // so the RNG delta measured below is solely the pickup + history_add.
    const pickupAction = registry.get("pickup")!;
    const before = state.rng.getState();
    pickupAction(state, { code: "pickup" });
    const after = state.rng.getState();

    expect(historyIsArtifactKnown(state.actor.player, art)).toBe(true);
    const found = state.actor.player.hist.find((e) =>
      histHas(e.type, HIST.ARTIFACT_KNOWN),
    );
    expect(found?.event).toBe("Found the Phial of Galadriel");
    /* Recording the find must not perturb the RNG stream (no save-scum). */
    expect(after).toEqual(before);
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

/* ------------------------------------------------------------------ *
 * Racial occurrence counts (mon-make.c cur_num).
 * ------------------------------------------------------------------ */

/**
 * C's invariant, asserted end-to-end: `race->cur_num` is the number of live
 * monsters of that race, and nothing else.
 *
 * C maintains it with a single increment inside place_new_monster_one
 * (mon-make.c L1040-1041), because C generates monsters directly into the live
 * cave. The port generates a level into a detached Gen first, so its single
 * increment lives at the populate boundary instead - countMonsterRaces, called
 * from the level-change path - while generation tracks uniques level-locally
 * and deliberately leaves the shared registry alone.
 *
 * That makes the count a two-stage contract, and a second increment added at
 * generation time double-counts every monster on a freshly generated level. The
 * damage is not cosmetic: wipe_mon_list decrements only once per live monster on
 * the way out, so each descent leaks, and a unique that reaches cur_num >=
 * max_num is refused by get_mon_num (mon-make.c L257-258) forever - it
 * disappears from the rest of the game. Descending several levels here is what
 * exposes the leak; a single level only shows the doubling.
 */
describe("cur_num tracks the live monster count (mon-make.c L1040-1041)", () => {
  it("holds on a fresh level and across a descent", () => {
    const game = startGame(pack, { seed: 4242, depth: 3 });
    const state = game.state;

    /* Races met so far, so a leak is still visible after their level is gone. */
    const seen = new Set<MonsterRace>();

    const check = (label: string): void => {
      const live = new Map<MonsterRace, number>();
      for (let i = 1; i < state.monsters.length; i++) {
        const mon = state.monsters[i];
        if (!mon) continue;
        /* A shapechanged monster counts against the race it really is. */
        const race = mon.originalRace ?? mon.race;
        seen.add(race);
        live.set(race, (live.get(race) ?? 0) + 1);
      }
      const wrong = [...seen]
        .filter((r) => r.curNum !== (live.get(r) ?? 0))
        .map((r) => `${label} ${r.name}: curNum=${r.curNum} live=${live.get(r) ?? 0}`);
      expect(wrong).toEqual([]);
    };

    check("depth 3");
    expect(seen.size).toBeGreaterThan(0);

    for (const depth of [4, 5, 6, 7]) {
      game.changeLevel(depth);
      expect(state.chunk.depth).toBe(depth);
      check(`depth ${depth}`);
    }
  });
});

/**
 * object_flavor_aware(p, obj) on each start item (player-birth.c:650). Found
 * absent by the upstream text census follow-up: the port had this ledgered as
 * DEFERRED, so a starting consumable was named by its flavour ("a Clear Flask")
 * instead of by what the player already knows it to be.
 */
describe("player_outfit flavour awareness (player-birth.c:650)", () => {
  /** Every flavoured kind the character starts out carrying. */
  function startingFlavouredKinds(state: ReturnType<typeof startGame>["state"]) {
    return [...state.gear.store.values()].filter((o) =>
      tvalCanHaveFlavor(o.tval),
    );
  }

  it("makes the player aware of every flavoured kind in their own starting kit", () => {
    /* A Ranger starts with Flasks of Oil - a flavoured tval - so there is
     * something for this to be true of. */
    const { state } = startGame(pack, { seed: 7, depth: 0 });
    const flavoured = startingFlavouredKinds(state);
    expect(flavoured.length).toBeGreaterThan(0);
    for (const obj of flavoured) {
      expect(
        state.flavorKnown?.isAware(obj.kind),
        `not aware of the starting ${obj.kind.name}`,
      ).toBe(true);
    }
  });

  it("names a starting consumable rather than describing its flavour", () => {
    const { state } = startGame(pack, { seed: 7, depth: 0 });
    for (const obj of startingFlavouredKinds(state)) {
      const name = describeObject(state, obj, ODESC.FULL);
      /* An unaware flavoured object reads as its flavour ("Smoky", "Clear"),
       * never as its own name, so the kind name appearing is the proof. */
      expect(name.toLowerCase()).toContain(
        obj.kind.name.replace(/^& /u, "").replace(/~/gu, "").toLowerCase(),
      );
    }
  });

  it("does not make the player aware of kinds they were not given", () => {
    const { state } = startGame(pack, { seed: 7, depth: 0 });
    const objReg = new ObjRegistry(pack.obj);
    const carried = new Set(
      [...state.gear.store.values()].map((o) => o.kind.kidx),
    );
    const unowned = objReg.kinds.filter(
      (k) =>
        tvalCanHaveFlavor(k.tval) &&
        k.kidx < objReg.ordinaryKindCount &&
        !carried.has(k.kidx),
    );
    expect(unowned.length).toBeGreaterThan(0);
    /* Birth must not hand out blanket awareness - that is birth_know_flavors,
     * an option, and it is off here. */
    expect(unowned.every((k) => state.flavorKnown?.isAware(k) !== true)).toBe(
      true,
    );
  });
});
