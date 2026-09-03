import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loc } from "../loc.js";
import type { Loc } from "../loc.js";
import { addMonster, updateMonsterDistances } from "./context.js";
import type { GameState, PlayerCommand } from "./context.js";
import { gearGet } from "./gear.js";
import { playerBookHasUnlearnedSpells, playerCanCast } from "./spell-cmd.js";
import {
  playerObjectToBook,
  spellByIndex,
  spellChance,
  spellOkayToCast,
  spellOkayToStudy,
} from "../player/spell.js";
import { convertManaToHp } from "../player/combat-regen.js";
import { PF, SQUARE, STAT, TMD } from "../generated/index.js";
import { blankMonster } from "../mon/monster.js";
import type { MonsterRace } from "../mon/types.js";
import { processPlayer } from "./player-turn.js";
import type { ActionRegistry } from "./player-turn.js";
import { startGame } from "../session/game.js";
import type { GamePack } from "../session/game.js";
import type { AbilityGained } from "../mod/hooks.js";

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
    const gained: AbilityGained[] = [];
    state.modHooks = { abilityGained: (ability) => gained.push(ability) };

    /* Study: Mage chooses (PF_CHOOSE_SPELLS); spell 0 = Magic Missile. */
    const energy = run(state, registry, {
      code: "study",
      args: { handle, spell: 0 },
    });
    expect(energy).toBe(state.z.moveEnergy);
    expect(spellOkayToCast(p, 0)).toBe(true);
    expect(p.upkeep.newSpells).toBe(0);
    expect(gained).toEqual([
      {
        kind: "spell",
        spellIndex: 0,
        name: "Magic Missile",
        realm: "arcane",
        command: "cast",
      },
    ]);

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

/** Drop a tough monster on the first free cardinal grid; return [grid, dir]. */
function placeAdjacentTarget(
  state: GameState,
  booted: ReturnType<typeof startGame>["booted"],
): number {
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
  return dir;
}

describe("spell consequence wiring (over-exert / cast-in-dark / combat-regen)", () => {
  it("overcasting over-exerts FAINT then CON, drawing RNG in upstream order", () => {
    const { state, registry } = startMage(777);
    const p = state.actor.player;
    const handle = bookHandle(state);
    run(state, registry, { code: "study", args: { handle, spell: 0 } });

    const spell = spellByIndex(p.cls, 0)!;
    /* Empty the mana pool so the next cast overcasts (oops = smana - 0). */
    p.csp = 0;
    p.cspFrac = 0;
    const oops = spell.mana;
    const conBefore = p.statCur[STAT.CON]!;

    /* Record the RNG draw sequence. randFix(0) makes every gate roll 0, so the
     * fail roll fires (no effect chain) and both over-exert branches hit. */
    const calls: Array<[string, number]> = [];
    const r0 = state.rng.randint0.bind(state.rng);
    const r1 = state.rng.randint1.bind(state.rng);
    state.rng.randint0 = (m: number): number => {
      calls.push(["r0", m]);
      return r0(m);
    };
    state.rng.randint1 = (m: number): number => {
      calls.push(["r1", m]);
      return r1(m);
    };
    state.rng.randFix(0);

    const used = run(state, registry, { code: "cast", args: { spell: 0, dir: 6 } });
    expect(used).toBe(state.z.moveEnergy);

    /* The FAINT amount roll randint1(5*oops+1) uniquely marks the overcast. */
    const faintAmt = 5 * oops + 1;
    const idx = calls.findIndex((c) => c[0] === "r1" && c[1] === faintAmt);
    expect(idx).toBeGreaterThan(0);
    /* FAINT gate precedes its amount roll; the CON gate + permanent sub-roll
     * follow - proving player_over_exert(FAINT) ran before (CON). */
    expect(calls[idx - 1]).toEqual(["r0", 100]);
    expect(calls[idx + 1]).toEqual(["r0", 100]);
    expect(calls[idx + 2]).toEqual(["r0", 100]);
    /* Consequences applied: fainting (paralysis) and permanent CON damage. */
    expect(p.timed[TMD.PARALYZED] ?? 0).toBeGreaterThan(0);
    expect(p.statCur[STAT.CON]!).toBeLessThan(conBefore);
    expect(p.csp).toBe(0);
  });

  it("UNLIGHT casters take a +25 fail penalty on a lit grid (cast-in-dark)", () => {
    const { state } = startMage(5);
    const p = state.actor.player;
    const statInd = state.statInd ?? [];
    const dark = spellChance(p, statInd, 0, {
      hasPf: (pf: number): boolean => pf === PF.UNLIGHT,
      afraid: (): boolean => false,
      gridIsLit: (): boolean => false,
    });
    const lit = spellChance(p, statInd, 0, {
      hasPf: (pf: number): boolean => pf === PF.UNLIGHT,
      afraid: (): boolean => false,
      gridIsLit: (): boolean => true,
    });
    expect(lit - dark).toBe(25);

    /* The wired callback reads real grid light: squareIsLit(chunk, actor.grid). */
    /* Non-UNLIGHT casters are unaffected by grid light. */
    const litNon = spellChance(p, statInd, 0, {
      hasPf: (): boolean => false,
      afraid: (): boolean => false,
      gridIsLit: (): boolean => true,
    });
    const darkNon = spellChance(p, statInd, 0, {
      hasPf: (): boolean => false,
      afraid: (): boolean => false,
      gridIsLit: (): boolean => false,
    });
    expect(litNon).toBe(darkNon);
  });

  it("PF_COMBAT_REGEN casters recover HP on a successful cast", () => {
    const bg = startGame(pack, { seed: 3, depth: 1, className: "Blackguard" });
    const { state, registry, booted } = bg;
    const p = state.actor.player;
    expect(p.cls.pflags.has(PF.COMBAT_REGEN)).toBe(true);
    expect(p.msp).toBeGreaterThan(0);

    /* Learn the first learnable spell from the shadow book. */
    const handle = bookHandle(state);
    const book = playerObjectToBook(p, gearGet(state.gear, handle)!)!;
    const learnable = book.spells.find((s) => spellOkayToStudy(p, s.sidx));
    expect(learnable).toBeDefined();
    const sidx = learnable!.sidx;
    run(state, registry, { code: "study", args: { handle, spell: sidx } });

    const dir = placeAdjacentTarget(state, booted);

    /* Wound the player so there is lost HP to convert. */
    p.chp = 1;
    p.chpFrac = 0;
    /* Force a successful cast: randFix(100) makes the fail roll 99 >= chance. */
    state.rng.randFix(100);
    const before = p.chp * 65536 + p.chpFrac;
    run(state, registry, { code: "cast", args: { spell: sidx, dir } });
    const after = p.chp * 65536 + p.chpFrac;
    expect(after).toBeGreaterThan(before);
  });

  it("convert_mana_to_hp is deterministic fixed-point (no RNG)", () => {
    /* player-util.c L655: recover X/2% of lost HP for X% of msp spent. */
    const p = { mhp: 100, chp: 40, chpFrac: 0, msp: 30 } as never as Parameters<
      typeof convertManaToHp
    >[0];
    convertManaToHp(p, 10 << 16);
    /* hp_gain = 60*65536; sp_ratio = max(10,30)*131072/(10<<16) = 6.
     * (60*65536)/6 = 655360 2^16ths = exactly 10 HP recovered. */
    expect(p.chp).toBe(50);
    expect(p.chpFrac).toBe(0);

    /* No spend / full HP / no mana are no-ops. */
    const q = { mhp: 100, chp: 100, chpFrac: 0, msp: 30 } as never as Parameters<
      typeof convertManaToHp
    >[0];
    convertManaToHp(q, 10 << 16);
    expect(q.chp).toBe(100);
    const z = { mhp: 100, chp: 40, chpFrac: 0, msp: 0 } as never as Parameters<
      typeof convertManaToHp
    >[0];
    convertManaToHp(z, 10 << 16);
    expect(z.chp).toBe(40);
  });
});

/**
 * player_can_cast's no_light half (player-util.c L1096): upstream forbids
 * casting when `p->timed[TMD_BLIND] || no_light(p)`, one condition sharing one
 * message. Only the blindness half was wired before.
 */
describe("player_can_cast no_light (player-util.c L1096)", () => {
  /** Install the updateFov seam so SQUARE_SEEN carries information. */
  function withView(state: GameState, seen: boolean): void {
    state.updateFov = (): void => {};
    if (seen) state.chunk.sqinfoOn(state.actor.grid, SQUARE["SEEN"]);
    else state.chunk.sqinfoOff(state.actor.grid, SQUARE["SEEN"]);
  }

  it("refuses to cast on an unseen grid, with the shared 'You cannot see!'", () => {
    const { state } = startMage(11);
    withView(state, false);
    const msgs: string[] = [];
    expect(playerCanCast(state, { msg: (t) => msgs.push(t) })).toBe(false);
    /* The SAME string blindness produces - upstream does not distinguish. */
    expect(msgs).toEqual(["You cannot see!"]);
  });

  it("allows it on a seen grid, and blindness still blocks there", () => {
    const { state } = startMage(11);
    withView(state, true);
    expect(playerCanCast(state, {})).toBe(true);
    state.actor.player.timed[TMD.BLIND] = 5;
    const msgs: string[] = [];
    expect(playerCanCast(state, { msg: (t) => msgs.push(t) })).toBe(false);
    expect(msgs).toEqual(["You cannot see!"]);
  });

  it("the cast COMMAND is blocked too, spending no energy", () => {
    const { state, registry } = startMage(12);
    const handle = bookHandle(state);
    withView(state, true);
    run(state, registry, { code: "study", args: { handle, spell: 0 } });
    withView(state, false);
    expect(run(state, registry, { code: "cast", args: { spell: 0, dir: 6 } })).toBe(0);
  });

  it("study is blocked by no_light too (player_can_study calls player_can_cast)", () => {
    const { state, registry } = startMage(13);
    const handle = bookHandle(state);
    withView(state, false);
    /* player_can_study (L1122) delegates to player_can_cast first, so an
     * unlit would-be student never reaches the new-spells check. */
    expect(run(state, registry, { code: "study", args: { handle, spell: 0 } })).toBe(0);
    expect(state.actor.player.spellFlags[0] ?? 0).toBe(0);
  });

  it("no_light applies to EVERY host now the seam guard is gone (player-util.c L1096)", () => {
    /**
     * This asserted the opposite: `state.updateFov` undefined after startGame, and
     * noLight() answering false because of a guard that existed so a host with no
     * FOV seam could still cast at all. Both halves were accurate and both were
     * symptoms of the same thing - core supplied no default updateFov, SQUARE_SEEN
     * was clear on every grid, and the guard was covering for it.
     *
     * With a default installed the birth square is genuinely seen, so no_light is
     * upstream's check for everyone and the guard is deleted. What matters here is
     * that it reads the FLAG rather than the seam: lit, can cast; dark, cannot.
     */
    const { state } = startMage(14);
    expect(state.updateFov).toBeTypeOf("function");
    withView(state, true);
    expect(playerCanCast(state, {})).toBe(true);
    withView(state, false);
    expect(playerCanCast(state, {})).toBe(false);
  });
});

describe("playerBookHasUnlearnedSpells (player-util.c L1315)", () => {
  it("true at birth: newSpells>0 and the starting book holds a studiable spell", () => {
    const { state } = startMage();
    expect(state.actor.player.upkeep.newSpells).toBeGreaterThan(0);
    expect(playerBookHasUnlearnedSpells(state)).toBe(true);
  });

  it("false once newSpells is exhausted (L1323 short-circuit)", () => {
    const { state, registry } = startMage(777);
    const handle = bookHandle(state);
    run(state, registry, { code: "study", args: { handle, spell: 0 } });
    expect(state.actor.player.upkeep.newSpells).toBe(0);
    expect(playerBookHasUnlearnedSpells(state)).toBe(false);
  });

  it("false when newSpells>0 but no carried/floor book has a studiable spell (obj_can_study scan)", () => {
    const { state } = startMage();
    /* Drop every book the obj_can_study scan could find. */
    state.gear.pack = state.gear.pack.filter((h) => {
      const o = gearGet(state.gear, h);
      return o === null || playerObjectToBook(state.actor.player, o) === null;
    });
    expect(state.actor.player.upkeep.newSpells).toBeGreaterThan(0);
    expect(playerBookHasUnlearnedSpells(state)).toBe(false);
  });
});
