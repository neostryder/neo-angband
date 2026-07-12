/**
 * Tests for calcBonuses / calcBlows (player-calcs.c calc_bonuses and
 * calc_blows, innate portion). Every expected value is hand-derived from the
 * upstream C tables; the derivations are spelled out in comments with the
 * exact table indices used.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELEM, OBJ_MOD, OF, PF, STAT, TMD, TV } from "../generated";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import type { ObjectKind } from "../obj/types";
import { Rng } from "../rng";
import { bindPlayer } from "./bind";
import type { PlayerPackRecords } from "./bind";
import { generatePlayer } from "./birth";
import {
  adjustSkillScale,
  calcBlows,
  calcBonuses,
  calcSkills,
  playerFlags,
  toCombatState,
  toDefenderState,
  weightLimit,
} from "./calcs";
import type { Player } from "./player";
import { SKILL, SKILL_MAX } from "./types";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: T[] };
  return parsed.records;
}

function loadPack(): PlayerPackRecords {
  return {
    races: packJson("p_race"),
    classes: packJson("class"),
    properties: packJson("player_property"),
    timed: packJson("player_timed"),
    shapes: packJson("shape"),
    bodies: packJson("body"),
    history: packJson("history"),
    realms: packJson("realm"),
  };
}

const reg = bindPlayer(loadPack());

/** A born player of the given race/class with explicitly set natural stats. */
function bornWithStats(
  raceName: string,
  clsName: string,
  stats: readonly number[],
): Player {
  const race = reg.raceByName(raceName);
  const cls = reg.classByName(clsName);
  const body = reg.bodies[0];
  if (!race || !cls || !body) throw new Error("missing fixtures");
  const { player } = generatePlayer(
    race,
    cls,
    { body, historyChart: reg.historyChart(race) },
    new Rng(4242),
  );
  for (let i = 0; i < stats.length; i++) {
    player.statMax[i] = stats[i] ?? 0;
    player.statCur[i] = stats[i] ?? 0;
    player.statBirth[i] = stats[i] ?? 0;
  }
  return player;
}

describe("calcBonuses: rune knowledge gates equipment modifiers (decision 25)", () => {
  const STATS = [16, 12, 11, 15, 14] as const;

  it("a born character starts with every rune unknown (obj_k empty)", () => {
    const p = bornWithStats("Human", "Warrior", STATS);
    expect(p.objKnown.modifiers.every((m) => m === 0)).toBe(true);
  });

  it("keeps an unlearned +STR modifier inert, then applies it once the rune is known", () => {
    const p = bornWithStats("Human", "Warrior", STATS);
    const equipment: (GameObject | null)[] = new Array<GameObject | null>(
      p.body.count,
    ).fill(null);
    // An item bearing +3 STR, worn in the last (non-weapon) slot.
    const item = objectNew({} as ObjectKind);
    item.modifiers[STAT.STR] = 3;
    equipment[p.body.count - 1] = item;

    // Rune unknown (the faithful birth default): the modifier does nothing.
    const unknown = calcBonuses(p, { equipment });
    expect(unknown.statAdd[STAT.STR]).toBe(0);

    // Learn the STR rune: the same worn item now grants its full +3.
    p.objKnown.modifiers[STAT.STR] = 1;
    const learned = calcBonuses(p, { equipment });
    expect(learned.statAdd[STAT.STR]).toBe(3);
    expect(learned.statUse[STAT.STR]).toBeGreaterThan(
      unknown.statUse[STAT.STR] ?? 0,
    );
  });
});

/*
 * The reference character: a level-1 Human Warrior with natural stats
 * STR 16, INT 12, WIS 11, DEX 15, CON 14.
 *
 * Human r_adj is all zero; Warrior c_adj is STR +3, INT -2, WIS -2, DEX +2,
 * CON +2 (class.txt). modify_stat_value gives:
 *   STR 16 +3 -> 17 -> 18 -> 28 (18/10)   ind = 15 + (28-18)/10 = 16
 *   INT 12 -2 -> 10                       ind = 10 - 3 = 7
 *   WIS 11 -2 -> 9                        ind = 6
 *   DEX 15 +2 -> 17                       ind = 14
 *   CON 14 +2 -> 16                       ind = 13
 */
const HUMAN_WARRIOR_STATS = [16, 12, 11, 15, 14] as const;

describe("calcBonuses: level-1 Human Warrior (hand-derived)", () => {
  const player = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
  const state = calcBonuses(player);

  it("computes stat use values and indices", () => {
    expect(state.statUse).toEqual([28, 10, 9, 17, 16]);
    expect(state.statInd).toEqual([16, 7, 6, 14, 13]);
    /* statCur == statMax, so top matches use. */
    expect(state.statTop).toEqual(state.statUse);
    expect(state.statAdd).toEqual([0, 0, 0, 0, 0]);
  });

  it("computes skills from class base + stat tables + level scaling", () => {
    /* Warrior c_skills base (Human r_skills all 0), then the stat term from
       the C tables at the indices above, then x_skills * 1 / 10:
       DISARM_PHYS  25 + adj_dex_dis[14]=2  + 15/10=1 = 28
       DISARM_MAGIC 20 + adj_int_dis[7]=1   + 10/10=1 = 22
       DEVICE       18 + adj_int_dev[7]=1   +  7/10=0 = 19
       SAVE         18 + adj_wis_sav[6]=1   + 10/10=1 = 20
       SEARCH       10                      + 12/10=1 = 11
       STEALTH       0                      +  0      =  0
       MELEE        70                      + 45/10=4 = 74
       BOW          55                      + 45/10=4 = 59
       THROW        55                      + 45/10=4 = 59
       DIGGING       0 + adj_str_dig[16]=10 +  0      = 10 */
    expect(state.skills).toEqual([28, 22, 19, 20, 11, 0, 74, 59, 59, 10]);
  });

  it("computes to-hit/to-dam/to-ac from the stat tables", () => {
    /* to_h = adj_dex_th[14]=2 + adj_str_th[16]=1 = 3
       to_d = adj_str_td[16]=2
       to_a = adj_dex_ta[14]=1; base ac is 0 (unarmored). */
    expect(state.toH).toBe(3);
    expect(state.toD).toBe(2);
    expect(state.toA).toBe(1);
    expect(state.ac).toBe(0);
  });

  it("computes base speed 110 with no encumbrance", () => {
    expect(state.speed).toBe(110);
    /* weight_limit = adj_str_wgt[16]=22 * 100 = 2200. */
    expect(weightLimit(state)).toBe(2200);
  });

  it("computes unarmed blows through calc_blows", () => {
    /* str_index = adj_str_blow[16]=30 * att_multiply 5 / min_weight 30 = 5
       dex_index = adj_dex_blow[14] = 2
       blows_table[5][2] = 42 -> 10000/42 = 238, under the 600 cap. */
    expect(state.numBlows).toBe(238);
  });

  it("keeps innate misc fields at their unarmed/unarmored values", () => {
    expect(state.seeInfra).toBe(0); /* Human infravision 0 */
    expect(state.hold).toBe(30); /* adj_str_hold[16] = 30 */
    expect(state.numShots).toBe(0);
    expect(state.ammoMult).toBe(0);
    expect(state.ammoTval).toBe(0);
    expect(state.numMoves).toBe(0);
    expect(state.heavyWield).toBe(false);
    expect(state.heavyShoot).toBe(false);
    expect(state.blessWield).toBe(false);
    expect(state.cumberArmor).toBe(false);
    expect(state.curLight).toBe(0);
    expect(state.damRed).toBe(0);
    expect(state.percDamRed).toBe(0);
  });

  it("carries the Warrior player flags and NO_MANA for msp 0", () => {
    expect(state.pflags.has(PF.BRAVERY_30)).toBe(true);
    expect(state.pflags.has(PF.SHIELD_BASH)).toBe(true);
    expect(state.pflags.has(PF.NO_MANA)).toBe(true);
    /* BRAVERY_30 grants PROT_FEAR only at level 30+. */
    expect(state.flags.has(OF.PROT_FEAR)).toBe(false);
    expect(state.flags.has(OF.AFRAID)).toBe(false);
  });

  it("has all-zero element info for a Human", () => {
    for (const el of state.elInfo) expect(el.resLevel).toBe(0);
  });

  it("agrees with calcSkills for the innate case", () => {
    const race = reg.raceByName("Human");
    const cls = reg.classByName("Warrior");
    if (!race || !cls) throw new Error("missing fixtures");
    expect(calcSkills(race, cls, 1, state.statInd)).toEqual(state.skills);
  });
});

describe("calcBonuses: race/level variations", () => {
  it("grants OF_PROT_FEAR to a BRAVERY_30 class at level 30", () => {
    const player = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    player.lev = 30;
    const state = calcBonuses(player);
    expect(state.flags.has(OF.PROT_FEAR)).toBe(true);
    expect(playerFlags(player).has(OF.PROT_FEAR)).toBe(true);
    /* Level scaling: MELEE = 70 + adj 0 + 45 * 30 / 10 = 205. */
    expect(state.skills[SKILL.TO_HIT_MELEE]).toBe(205);
  });

  it("keeps racial element resists (Elf resists light)", () => {
    const player = bornWithStats("Elf", "Warrior", HUMAN_WARRIOR_STATS);
    const state = calcBonuses(player);
    expect(state.elInfo[ELEM.LIGHT]?.resLevel).toBe(1);
    expect(state.elInfo[ELEM.DARK]?.resLevel).toBe(0);
  });

  it("applies UNLIGHT/EVIL element info only in the dungeon", () => {
    const player = bornWithStats(
      "Human",
      "Necromancer",
      HUMAN_WARRIOR_STATS,
    );
    const born = calcBonuses(player);
    expect(born.elInfo[ELEM.DARK]?.resLevel).toBe(0);
    expect(born.elInfo[ELEM.NETHER]?.resLevel).toBe(0);
    expect(born.elInfo[ELEM.HOLY_ORB]?.resLevel).toBe(0);
    const dungeon = calcBonuses(player, { characterDungeon: true });
    expect(dungeon.elInfo[ELEM.DARK]?.resLevel).toBe(1);
    expect(dungeon.elInfo[ELEM.NETHER]?.resLevel).toBe(1);
    expect(dungeon.elInfo[ELEM.HOLY_ORB]?.resLevel).toBe(-1);
  });

  it("picks up racial infravision (Dwarf sees 5)", () => {
    const player = bornWithStats("Dwarf", "Warrior", HUMAN_WARRIOR_STATS);
    const state = calcBonuses(player);
    expect(state.seeInfra).toBe(5);
  });
});

describe("calcBlows (player-calcs.c:1703-1735, hand-derived)", () => {
  const warrior = reg.classByName("Warrior");
  if (!warrior) throw new Error("missing Warrior");

  it("gives exactly one blow (100) unarmed at rock-bottom stats", () => {
    /* STR 5 -> ind 2: adj_str_blow[2]=5 * 5 / 30 = 0.
       DEX 8 -> ind 5: adj_dex_blow[5]=0.
       blows_table[0][0] = 100 -> 10000/100 = 100. */
    expect(calcBlows(warrior, null, 2, 5)).toBe(100);
  });

  it("computes unarmed blows for the reference Warrior", () => {
    /* Same derivation as the calcBonuses test: table[5][2]=42 -> 238. */
    expect(calcBlows(warrior, null, 16, 14)).toBe(238);
  });

  it("uses the real weapon weight once it exceeds min_weight", () => {
    /* 13.0 lb weapon (130 tenth-lb) > min_weight 30:
       str_index = adj_str_blow[16]=30 * 5 / 130 = 1
       dex_index = adj_dex_blow[14] = 2
       blows_table[1][2] = 85 -> 10000/85 = 117. */
    expect(calcBlows(warrior, 130, 16, 14)).toBe(117);
  });

  it("substitutes min_weight for lighter weapons", () => {
    /* A 1.2 lb Dagger (12) is below min_weight 30, so the divisor is 30 and
       the result equals the unarmed case. */
    expect(calcBlows(warrior, 12, 16, 14)).toBe(238);
  });

  it("adds 100 per extra blow", () => {
    expect(calcBlows(warrior, 130, 16, 14, 1)).toBe(217);
  });

  it("caps at 100 * max_attacks", () => {
    /* STR ind 37: adj_str_blow[37]=240 * 5 / 30 = 40 -> capped at 11.
       DEX ind 37: adj_dex_blow[37]=11.
       blows_table[11][11] = 15 -> 10000/15 = 666 -> min(666, 600) = 600. */
    expect(calcBlows(warrior, null, 37, 37)).toBe(600);
  });

  it("requires two blows under O-combat (birth_percent_damage)", () => {
    expect(calcBlows(warrior, null, 2, 5, 0, true)).toBe(200);
  });
});

describe("adjustSkillScale (player-calcs.c:1781-1792)", () => {
  it("scales up like value * (den + num) / den", () => {
    expect(adjustSkillScale(100, 1, 20, 0)).toBe(105);
    expect(adjustSkillScale(19, 1, 20, 0)).toBe(19); /* 19*1/20 trunc = 0 */
  });

  it("rounds the decrease up to mimic the positive-value identity", () => {
    /* 100 * (20 - 1) / 20 = 95: v -= ceil(100 * 1 / 20) = 5. */
    expect(adjustSkillScale(100, -1, 20, 0)).toBe(95);
    /* 19 -= ceil(19/20) = 1 -> 18 (contrast the trunc on the way up). */
    expect(adjustSkillScale(19, -1, 20, 0)).toBe(18);
  });
});

describe("adapters for combat and turn-loop consumers", () => {
  const player = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
  const state = calcBonuses(player);

  it("toCombatState exposes the PlayerCombatState fields", () => {
    const combat = toCombatState(state);
    expect(combat.toH).toBe(3);
    expect(combat.toD).toBe(2);
    expect(combat.ac).toBe(0);
    expect(combat.toA).toBe(1);
    expect(combat.numBlows).toBe(238);
    expect(combat.ammoMult).toBe(0);
    expect(combat.blessWield).toBe(false);
    expect(combat.skills.length).toBe(SKILL_MAX);
    expect(combat.skills[SKILL.TO_HIT_MELEE]).toBe(74);
  });

  it("toDefenderState exposes ac + to_a", () => {
    expect(toDefenderState(state)).toEqual({ ac: 0, toA: 1 });
  });
});

/* ------------------------------------------------------------------ */
/* calc_light (player-calcs.c:1598-1645)                               */
/* ------------------------------------------------------------------ */

/** Fresh equipment array (all slots empty) for a player. */
function emptyEquipment(p: Player): (GameObject | null)[] {
  return new Array<GameObject | null>(p.body.count).fill(null);
}

/** The body-slot index of the LIGHT slot. */
function lightSlot(p: Player): number {
  return p.body.slots.findIndex((s) => s.type === "LIGHT");
}

/** The first RING slot index. */
function ringSlot(p: Player): number {
  return p.body.slots.findIndex((s) => s.type === "RING");
}

describe("calcLight (player-calcs.c:1598-1645)", () => {
  it("keeps curLight 0 for an unarmed player with no light source", () => {
    const p = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    expect(calcBonuses(p).curLight).toBe(0);
    /* Also 0 with an (empty) equipment array supplied. */
    expect(calcBonuses(p, { equipment: emptyEquipment(p) }).curLight).toBe(0);
  });

  it("lights a wielded fuelled torch (OF_LIGHT_2, timeout>0) to radius 2", () => {
    const p = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    const eq = emptyEquipment(p);
    const torch = objectNew({} as ObjectKind);
    torch.tval = TV.LIGHT;
    torch.flags.on(OF.LIGHT_2);
    torch.timeout = 5000;
    eq[lightSlot(p)] = torch;
    expect(calcBonuses(p, { equipment: eq }).curLight).toBe(2);
  });

  it("gives no light from a burnt-out torch (fuel gate: timeout==0)", () => {
    const p = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    const eq = emptyEquipment(p);
    const torch = objectNew({} as ObjectKind);
    torch.tval = TV.LIGHT;
    torch.flags.on(OF.LIGHT_2);
    torch.timeout = 0;
    eq[lightSlot(p)] = torch;
    expect(calcBonuses(p, { equipment: eq }).curLight).toBe(0);
  });

  it("lights a LIGHT_3 lantern to radius 3", () => {
    const p = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    const eq = emptyEquipment(p);
    const lantern = objectNew({} as ObjectKind);
    lantern.tval = TV.LIGHT;
    lantern.flags.on(OF.LIGHT_3);
    lantern.timeout = 5000;
    eq[lightSlot(p)] = lantern;
    expect(calcBonuses(p, { equipment: eq }).curLight).toBe(3);
  });

  it("stacks a raw OBJ_MOD_LIGHT ring on a torch (light is NOT rune-gated)", () => {
    const p = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    /* Every rune unknown, yet the +1 light applies (calc_light reads the raw
       modifier, unlike the pval modifiers in the equipment loop). */
    expect(p.objKnown.modifiers.every((m) => m === 0)).toBe(true);
    const eq = emptyEquipment(p);
    const torch = objectNew({} as ObjectKind);
    torch.tval = TV.LIGHT;
    torch.flags.on(OF.LIGHT_2);
    torch.timeout = 5000;
    eq[lightSlot(p)] = torch;
    const ring = objectNew({} as ObjectKind);
    ring.modifiers[OBJ_MOD.LIGHT] = 1;
    eq[ringSlot(p)] = ring;
    expect(calcBonuses(p, { equipment: eq }).curLight).toBe(3);
  });

  it("reduces +LIGHT gear by 1 for an UNLIGHT player", () => {
    const p = bornWithStats("Human", "Necromancer", HUMAN_WARRIOR_STATS);
    const eq = emptyEquipment(p);
    const ring = objectNew({} as ObjectKind);
    ring.modifiers[OBJ_MOD.LIGHT] = 1;
    eq[ringSlot(p)] = ring;
    const state = calcBonuses(p, { equipment: eq });
    expect(state.pflags.has(PF.UNLIGHT)).toBe(true);
    /* amt = 0 + mod(1), then UNLIGHT subtracts 1 -> 0. */
    expect(state.curLight).toBe(0);
    /* A non-UNLIGHT Warrior with the same ring keeps the full +1. */
    const w = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    const weq = emptyEquipment(w);
    const wring = objectNew({} as ObjectKind);
    wring.modifiers[OBJ_MOD.LIGHT] = 1;
    weq[ringSlot(w)] = wring;
    expect(calcBonuses(w, { equipment: weq }).curLight).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Timed-effect contributions (player-calcs.c:2094-2213)               */
/* ------------------------------------------------------------------ */

/** A born Warrior plus a baseline derive computed with the timed table. */
function warriorAndBase(): {
  base: ReturnType<typeof calcBonuses>;
  fresh: () => Player;
} {
  const fresh = (): Player =>
    bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
  const base = calcBonuses(fresh(), { timedEffects: reg.timed });
  return { base, fresh };
}

describe("temp_resist ELEM/PROJ alignment", () => {
  it("pins ELEM.ACID..POIS to 0..4 (proj_name_to_idx equivalence)", () => {
    /* temp_resist binds ELEM[name] as a stand-in for proj_name_to_idx; that
       is faithful only because PROJ_ACID..PROJ_POIS coincide with 0..4. */
    expect([ELEM.ACID, ELEM.ELEC, ELEM.FIRE, ELEM.COLD, ELEM.POIS]).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("binds the five OPP_* temp resists and the flag synonyms", () => {
    expect(reg.timed[TMD.OPP_FIRE]?.tempResist).toBe(ELEM.FIRE);
    expect(reg.timed[TMD.OPP_ACID]?.tempResist).toBe(ELEM.ACID);
    expect(reg.timed[TMD.AFRAID]?.oflagDup).toBe(OF.AFRAID);
    expect(reg.timed[TMD.BOLD]?.oflagDup).toBe(OF.PROT_FEAR);
    expect(reg.timed[TMD.TRAPSAFE]?.oflagDup).toBe(OF.TRAP_IMMUNE);
    /* A plain effect with no synonym / resist stays at the defaults. */
    expect(reg.timed[TMD.FAST]?.oflagDup).toBe(0);
    expect(reg.timed[TMD.FAST]?.tempResist).toBe(-1);
  });
});

describe("calcBonuses: timed-effect deltas", () => {
  const opt = { timedEffects: reg.timed } as const;

  it("FAST adds +10 speed, SLOW subtracts 10", () => {
    const { base, fresh } = warriorAndBase();
    const fp = fresh();
    fp.timed[TMD.FAST] = 10;
    expect(calcBonuses(fp, opt).speed - base.speed).toBe(10);
    const sp = fresh();
    sp.timed[TMD.SLOW] = 10;
    expect(calcBonuses(sp, opt).speed - base.speed).toBe(-10);
  });

  it("BLESSED adds +5 to_a and +10 to_h", () => {
    const { base, fresh } = warriorAndBase();
    const p = fresh();
    p.timed[TMD.BLESSED] = 10;
    const s = calcBonuses(p, opt);
    expect(s.toA - base.toA).toBe(5);
    expect(s.toH - base.toH).toBe(10);
  });

  it("HERO adds +12 to_h; INVULN +100 to_a; SHIELD +50 to_a", () => {
    const { base, fresh } = warriorAndBase();
    const h = fresh();
    h.timed[TMD.HERO] = 10;
    expect(calcBonuses(h, opt).toH - base.toH).toBe(12);
    const iv = fresh();
    iv.timed[TMD.INVULN] = 10;
    expect(calcBonuses(iv, opt).toA - base.toA).toBe(100);
    const sh = fresh();
    sh.timed[TMD.SHIELD] = 10;
    expect(calcBonuses(sh, opt).toA - base.toA).toBe(50);
  });

  it("SHERO adds +75 melee skill and -10 to_a", () => {
    const { base, fresh } = warriorAndBase();
    const p = fresh();
    p.timed[TMD.SHERO] = 10;
    const s = calcBonuses(p, opt);
    expect(s.skills[SKILL.TO_HIT_MELEE]! - base.skills[SKILL.TO_HIT_MELEE]!).toBe(
      75,
    );
    expect(s.toA - base.toA).toBe(-10);
  });

  it("STONESKIN adds +40 to_a and -5 speed", () => {
    const { base, fresh } = warriorAndBase();
    const p = fresh();
    p.timed[TMD.STONESKIN] = 10;
    const s = calcBonuses(p, opt);
    expect(s.toA - base.toA).toBe(40);
    expect(s.speed - base.speed).toBe(-5);
  });

  it("SINFRA adds +5 infravision; TERROR adds +10 speed", () => {
    const { base, fresh } = warriorAndBase();
    const si = fresh();
    si.timed[TMD.SINFRA] = 10;
    expect(calcBonuses(si, opt).seeInfra - base.seeInfra).toBe(5);
    const tr = fresh();
    tr.timed[TMD.TERROR] = 10;
    /* TERROR gives +10 speed (and, via its AFRAID synonym, fear). */
    expect(calcBonuses(tr, opt).speed - base.speed).toBe(10);
  });

  it("CONFUSED penalises the device skill", () => {
    const { base, fresh } = warriorAndBase();
    const p = fresh();
    p.timed[TMD.CONFUSED] = 10;
    /* Device base 18 at the timed block: adjust(-1,4,0) = 18 - ceil(18/4) = 13,
       then +1 from adj_int_dev -> 14 vs baseline 19: a -5 delta. */
    expect(calcBonuses(p, opt).skills[SKILL.DEVICE]! - base.skills[SKILL.DEVICE]!).toBe(
      -5,
    );
  });

  it("BLOODLUST adds to_d and extra blows", () => {
    const { base, fresh } = warriorAndBase();
    const p = fresh();
    p.timed[TMD.BLOODLUST] = 40;
    const s = calcBonuses(p, opt);
    /* to_d += 40/2 = 20; extra_blows += 40/20 = 2 -> +200 to num_blows. */
    expect(s.toD - base.toD).toBe(20);
    expect(s.numBlows - base.numBlows).toBe(200);
  });
});

describe("calcBonuses: STUN grades (FASTCAST side effect gated on update)", () => {
  const opt = { timedEffects: reg.timed } as const;

  it("Stun grade applies -5/-5 and zeroes FASTCAST when update", () => {
    const { base, fresh } = warriorAndBase();
    const p = fresh();
    p.timed[TMD.STUN] = 30; /* <= 50 -> "Stun" */
    p.timed[TMD.FASTCAST] = 5;
    const s = calcBonuses(p, { ...opt, update: true });
    expect(s.toH - base.toH).toBe(-5);
    expect(s.toD - base.toD).toBe(-5);
    expect(p.timed[TMD.FASTCAST]).toBe(0);
  });

  it("Heavy Stun grade applies -20/-20", () => {
    const { base, fresh } = warriorAndBase();
    const p = fresh();
    p.timed[TMD.STUN] = 100; /* 51..150 -> "Heavy Stun" */
    const s = calcBonuses(p, opt);
    expect(s.toH - base.toH).toBe(-20);
    expect(s.toD - base.toD).toBe(-20);
  });

  it("leaves FASTCAST intact when update is false", () => {
    const p = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    p.timed[TMD.STUN] = 30;
    p.timed[TMD.FASTCAST] = 5;
    calcBonuses(p, { timedEffects: reg.timed, update: false });
    expect(p.timed[TMD.FASTCAST]).toBe(5);
  });
});

describe("calcBonuses: temporary elemental resists (temp_resist)", () => {
  it("OPP_FIRE bumps the fire resist level by one", () => {
    const p = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    p.timed[TMD.OPP_FIRE] = 100;
    const s = calcBonuses(p, { timedEffects: reg.timed });
    expect(s.elInfo[ELEM.FIRE]?.resLevel).toBe(1);
    /* Untouched elements stay 0. */
    expect(s.elInfo[ELEM.COLD]?.resLevel).toBe(0);
  });
});

describe("calcBonuses: player_flags_timed and fear", () => {
  it("AFRAID sets OF_AFRAID and applies the fear penalties (incl. device)", () => {
    const { base, fresh } = warriorAndBase();
    const p = fresh();
    p.timed[TMD.AFRAID] = 10;
    const s = calcBonuses(p, { timedEffects: reg.timed });
    expect(s.flags.has(OF.AFRAID)).toBe(true);
    /* Fear: to_h -20, to_a +8, device adjust(-1,20,0) = -1 vs baseline. */
    expect(s.toH - base.toH).toBe(-20);
    expect(s.toA - base.toA).toBe(8);
    expect(s.skills[SKILL.DEVICE]! - base.skills[SKILL.DEVICE]!).toBe(-1);
  });

  it("TRAPSAFE does NOT leak OF_TRAP_IMMUNE through the timed path", () => {
    const p = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    p.timed[TMD.TRAPSAFE] = 10;
    const s = calcBonuses(p, { timedEffects: reg.timed });
    expect(s.flags.has(OF.TRAP_IMMUNE)).toBe(false);
  });

  it("BOLD sets OF_PROT_FEAR", () => {
    const p = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    p.timed[TMD.BOLD] = 10;
    const s = calcBonuses(p, { timedEffects: reg.timed });
    expect(s.flags.has(OF.PROT_FEAR)).toBe(true);
  });
});

describe("calcBonuses: food grades outside Fed", () => {
  const opt = { timedEffects: reg.timed } as const;

  it("applies hunger penalties to to_h/to_d and device", () => {
    const { base, fresh } = warriorAndBase();
    const p = fresh();
    p.timed[TMD.FOOD] = 600; /* Weak grade: lack = 1500-600 = 900 -> l = 12 */
    const s = calcBonuses(p, opt);
    expect(s.toH - base.toH).toBe(-12);
    expect(s.toD - base.toD).toBe(-12);
    /* l in (10,15]: device adjust(-1,10,0) = 18 - ceil(18/10) = 16, +1 -> -2. */
    expect(s.skills[SKILL.DEVICE]! - base.skills[SKILL.DEVICE]!).toBe(-2);
  });

  it("gorging (Full) slows the player unless ATT_VAMP is active", () => {
    const { base, fresh } = warriorAndBase();
    const gorged = fresh();
    gorged.timed[TMD.FOOD] = 9500; /* Full grade: excess = 500 -> speed -5 */
    expect(calcBonuses(gorged, opt).speed - base.speed).toBe(-5);
    /* ATT_VAMP suppresses the excess speed penalty. */
    const vamp = fresh();
    vamp.timed[TMD.FOOD] = 9500;
    vamp.timed[TMD.ATT_VAMP] = 1;
    expect(calcBonuses(vamp, opt).speed - base.speed).toBe(0);
  });
});
