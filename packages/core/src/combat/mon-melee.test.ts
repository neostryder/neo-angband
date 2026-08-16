import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RF } from "../generated/index.js";
import { FlagSet } from "../bitflag.js";
import { Dice } from "../dice.js";
import type { RandomValue } from "../rng.js";
import { Rng } from "../rng.js";
import { loc } from "../loc.js";
import { bindMonsters } from "../mon/bind.js";
import type { MonsterPackRecords } from "../mon/bind.js";
import { blankMonster } from "../mon/monster.js";
import type { Monster } from "../mon/monster.js";
import { RF_SIZE } from "../mon/types.js";
import type { MonsterBlow, MonsterRace } from "../mon/types.js";
import { bindPlayer } from "../player/bind.js";
import type { PlayerPackRecords } from "../player/bind.js";
import { blankPlayer } from "../player/player.js";
import type { Player } from "../player/player.js";
import type { DefenderState, MonBlowEnv } from "./mon-melee.js";
import { monMeleeAttack, monsterCritical, RESOLVED_BLOW_EFFECTS } from "./mon-melee.js";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}
function packJson<T>(name: string): T[] {
  return (load(name) as { records: T[] }).records;
}

const monReg = bindMonsters({
  pain: packJson("pain"),
  blowMethods: packJson("blow_methods"),
  blowEffects: packJson("blow_effects"),
  monsterSpells: packJson("monster_spell"),
  monsterBases: packJson("monster_base"),
  monsters: packJson("monster"),
  summons: packJson("summon"),
  pits: packJson("pit"),
} as MonsterPackRecords);

const plReg = bindPlayer({
  races: packJson("p_race"),
  classes: packJson("class"),
  properties: packJson("player_property"),
  timed: packJson("player_timed"),
  shapes: packJson("shape"),
  bodies: packJson("body"),
  history: packJson("history"),
  realms: packJson("realm"),
} as PlayerPackRecords);

const realRace = monReg.races.find((r) => r.base) as MonsterRace;

function makeMon(
  effectName: string,
  methodName: string,
  diceStr: string,
  level: number,
  ...flags: number[]
): Monster {
  const method = monReg.blowMethods.get(methodName);
  const effect = monReg.blowEffects.get(effectName);
  if (!method || !effect) throw new Error(`missing blow ${methodName}/${effectName}`);
  const d = new Dice();
  d.parseString(diceStr);
  const blow: MonsterBlow = { method, effect, dice: d, diceRaw: diceStr };
  const flagsSet = new FlagSet(RF_SIZE);
  for (const f of flags) flagsSet.on(f);
  const race: MonsterRace = { ...realRace, level, flags: flagsSet, blows: [blow] };
  const mon = blankMonster(race);
  mon.hp = 100;
  mon.maxhp = 100;
  return mon;
}

/** A race with several blows, for testing across-blow behaviour (e.g. blink). */
function makeMonMultiBlow(
  blowSpecs: ReadonlyArray<readonly [effect: string, method: string, dice: string]>,
  level: number,
): Monster {
  const blows: MonsterBlow[] = blowSpecs.map(([effectName, methodName, diceStr]) => {
    const method = monReg.blowMethods.get(methodName);
    const effect = monReg.blowEffects.get(effectName);
    if (!method || !effect) {
      throw new Error(`missing blow ${methodName}/${effectName}`);
    }
    const d = new Dice();
    d.parseString(diceStr);
    return { method, effect, dice: d, diceRaw: diceStr };
  });
  const flagsSet = new FlagSet(RF_SIZE);
  const race: MonsterRace = { ...realRace, level, flags: flagsSet, blows };
  const mon = blankMonster(race);
  mon.hp = 100;
  mon.maxhp = 100;
  return mon;
}

/**
 * A minimal MonBlowEnv double: every hook is a no-op except the ones under
 * test, which push a tag onto `calls` so the caller can assert exact
 * dispatch ORDER (mirroring make_attack_normal / the melee_effect_handler_*
 * call sequence) without pulling in the real game/mon-side.ts subsystems.
 */
function makeFakeEnv(opts: {
  eatGoldReturn?: boolean;
  eatItemReturn?: { blinked: boolean; obvious: boolean };
} = {}): { env: MonBlowEnv; calls: string[] } {
  const calls: string[] = [];
  const env: MonBlowEnv = {
    playerGrid: () => loc(0, 0),
    applyReduction: (dam: number) => {
      calls.push(`applyReduction:${dam}`);
      return dam;
    },
    takeHit: (dam: number) => {
      calls.push(`takeHit:${dam}`);
    },
    get playerDied() {
      return false;
    },
    msg: () => {},
    monName: "The kobold",
    showDamage: false,
    monVisible: true,
    elementalDam: (_proj: number, dam: number) => dam,
    invenDamage: () => {},
    resists: () => false,
    incTimed: () => true,
    saveVsSkill: () => false,
    drainStat: () => {},
    hasHoldLife: () => false,
    drainExp: () => {},
    drainCharges: () => {},
    eatGold: () => {
      calls.push("eatGold");
      return opts.eatGoldReturn ?? false;
    },
    eatItem: () => {
      calls.push("eatItem");
      return opts.eatItemReturn ?? { blinked: false, obvious: true };
    },
    eatFood: () => {
      calls.push("eatFood");
    },
    eatLight: () => {
      calls.push("eatLight");
    },
    disenchant: () => {},
    earthquake: () => {},
    thrust: () => {},
    blinkAway: () => {
      calls.push("blinkAway");
    },
  };
  return { env, calls };
}

function defender(): Player {
  const p = blankPlayer(
    plReg.races[0] as (typeof plReg.races)[number],
    plReg.classes[0] as (typeof plReg.classes)[number],
    plReg.bodies[0] as (typeof plReg.bodies)[number],
  );
  p.lev = 1;
  p.chp = 100;
  p.mhp = 100;
  return p;
}

const def: DefenderState = { ac: 0, toA: 0 };

describe("worldless SHATTER fatal hit", () => {
  it("takes neither side effect nor knockback RNG draw, matching the live path", () => {
    const worldlessRng = new Rng(1);
    const worldlessDefender = defender();
    worldlessDefender.chp = 1;
    const worldless = monMeleeAttack(
      worldlessRng,
      makeMon("SHATTER", "HIT", "200", 50),
      worldlessDefender,
      def,
    );

    const liveRng = new Rng(1);
    const liveDefender = defender();
    liveDefender.chp = 1;
    const { env, calls } = makeFakeEnv();
    let died = false;
    Object.defineProperty(env, "playerDied", { get: () => died });
    env.takeHit = (damage: number) => {
      liveDefender.chp -= damage;
      died = liveDefender.chp < 0;
    };
    env.earthquake = () => calls.push("earthquake");
    env.thrust = () => calls.push("thrust");
    const live = monMeleeAttack(
      liveRng,
      makeMon("SHATTER", "HIT", "200", 50),
      liveDefender,
      def,
      { env },
    );

    expect(worldless.playerDied).toBe(true);
    expect(live.playerDied).toBe(true);
    expect(worldless.sideEffects).toEqual([]);
    expect(calls).toEqual(["applyReduction:200"]);
    expect(worldlessRng.getState()).toEqual(liveRng.getState());
  });
});

describe("monster_critical", () => {
  const oneD4: RandomValue = { base: 0, dice: 1, sides: 4, mBonus: 0 };

  it("returns a tier for a maxed weak blow", () => {
    const rng = new Rng(1);
    rng.randFix(0); // randint0(100) -> 0, below dam so no early-out
    /* dam==total(4), tier for dam<=11 is 1, +1 for perfect damage = 2. */
    expect(monsterCritical(rng, oneD4, 5, 4)).toBe(2);
  });

  it("weak blows usually fail the critical roll", () => {
    const rng = new Rng(1);
    rng.randFix(50); // randint0(100) -> 49 >= dam(4)
    expect(monsterCritical(rng, oneD4, 5, 4)).toBe(0);
  });
});

describe("make_attack_normal", () => {
  it("does not attack with RF_NEVER_BLOW", () => {
    const rng = new Rng(1);
    const res = monMeleeAttack(rng, makeMon("HURT", "HIT", "1d4", 5, RF.NEVER_BLOW), defender(), def);
    expect(res.attacked).toBe(false);
    expect(res.blows.length).toBe(0);
  });

  it("misses in the bottom to-hit band and hits above it (rand_fix)", () => {
    const missRng = new Rng(1);
    missRng.randFix(0);
    const p1 = defender();
    const miss = monMeleeAttack(missRng, makeMon("HURT", "HIT", "1d4", 5), p1, def);
    expect(miss.blows[0]?.hit).toBe(false);
    expect(p1.chp).toBe(100);

    const hitRng = new Rng(1);
    hitRng.randFix(100);
    const p2 = defender();
    const hit = monMeleeAttack(hitRng, makeMon("HURT", "HIT", "1d4", 5), p2, def);
    expect(hit.blows[0]?.hit).toBe(true);
    /* HURT: adjust_dam_armor(1d4 max = 4, ac 0) = 4. */
    expect(hit.totalDamage).toBe(4);
    expect(p2.chp).toBe(96);
  });

  it("records a status ailment in the side-effect log (POISON)", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const res = monMeleeAttack(rng, makeMon("POISON", "HIT", "1d4", 5), defender(), def);
    expect(res.sideEffects.some((s) => s.kind === "timed" && s.effect === "POISONED")).toBe(true);
    expect(res.sideEffects.some((s) => s.kind === "elemental" && s.element === "POIS")).toBe(true);
  });

  it("records a stat drain in the side-effect log (LOSE_STR)", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const p = defender();
    const res = monMeleeAttack(rng, makeMon("LOSE_STR", "HIT", "1d4", 5), p, def);
    expect(res.sideEffects.some((s) => s.kind === "drainStat" && s.stat === "STR")).toBe(true);
    /* LOSE_STR deals the base damage directly. */
    expect(res.totalDamage).toBe(4);
    expect(p.chp).toBe(96);
  });

  /*
   * melee_handler_for_blow_effect (mon-blows.c:1191) is a TOTAL map over
   * blow_effects.txt: its table lists exactly the 30 names the data file
   * defines, so no blow can hit the "ERROR: Effect handler not found" branch
   * (mon-attack.c:650 / :841). This asserts the same totality for the port, in
   * both directions - a name in the pack with no handler would silently deal
   * bare damage, and a handler for a name the data does not define would be
   * dead code masking a rename.
   */
  it("maps every RBE_ blow effect to a handler, both directions (mon-blows.c:1191)", () => {
    const packEffects = new Set(monReg.blowEffects.keys());
    const resolved = new Set(RESOLVED_BLOW_EFFECTS);
    const missingHandler = [...packEffects].filter((n) => !resolved.has(n));
    const extraHandler = [...resolved].filter((n) => !packEffects.has(n));
    expect(missingHandler).toEqual([]);
    expect(extraHandler).toEqual([]);
    /* mon-blows.c:1197-1226 lists 30 handlers; blow_effects.txt has 30 names. */
    expect(packEffects.size).toBe(30);
    expect(resolved.size).toBe(30);
  });

  /*
   * The list is only a claim unless each name really reaches its own handler.
   * Drive every effect through monMeleeAttack and require the side-effect log /
   * damage to be what that handler produces, so a name present in
   * RESOLVED_BLOW_EFFECTS but fallen through to `default` is caught.
   */
  it("every listed effect reaches a concrete handler, not the fallthrough", () => {
    /* The distinguishing signature of each handler (mon-blows.c:638-1183). */
    const signature: Record<string, (r: ReturnType<typeof monMeleeAttack>) => boolean> = {
      NONE: (r) => r.totalDamage === 0,
      /* HURT's only mark is armour-reduced damage and nothing else; the CUT /
       * STUN timers come from the METHOD (mon-attack.c:653-700), not the
       * handler, so they are excluded here. */
      HURT: (r) =>
        r.totalDamage > 0 &&
        r.sideEffects.every(
          (s) => s.kind === "timed" && (s.effect === "CUT" || s.effect === "STUN"),
        ),
      POISON: (r) =>
        r.sideEffects.some((s) => s.kind === "elemental" && s.element === "POIS") &&
        r.sideEffects.some((s) => s.kind === "timed" && s.effect === "POISONED"),
      DISENCHANT: (r) => r.sideEffects.some((s) => s.kind === "disenchant"),
      DRAIN_CHARGES: (r) => r.sideEffects.some((s) => s.kind === "drainCharges"),
      EAT_GOLD: (r) => r.sideEffects.some((s) => s.kind === "eatGold"),
      EAT_ITEM: (r) => r.sideEffects.some((s) => s.kind === "eatItem"),
      EAT_FOOD: (r) => r.sideEffects.some((s) => s.kind === "eatFood"),
      EAT_LIGHT: (r) => r.sideEffects.some((s) => s.kind === "eatLight"),
      ACID: (r) => r.sideEffects.some((s) => s.kind === "elemental" && s.element === "ACID"),
      ELEC: (r) => r.sideEffects.some((s) => s.kind === "elemental" && s.element === "ELEC"),
      FIRE: (r) => r.sideEffects.some((s) => s.kind === "elemental" && s.element === "FIRE"),
      COLD: (r) => r.sideEffects.some((s) => s.kind === "elemental" && s.element === "COLD"),
      BLIND: (r) => r.sideEffects.some((s) => s.kind === "timed" && s.effect === "BLIND"),
      CONFUSE: (r) => r.sideEffects.some((s) => s.kind === "timed" && s.effect === "CONFUSED"),
      TERRIFY: (r) => r.sideEffects.some((s) => s.kind === "timed" && s.effect === "AFRAID"),
      PARALYZE: (r) => r.sideEffects.some((s) => s.kind === "timed" && s.effect === "PARALYZED"),
      LOSE_STR: (r) => r.sideEffects.some((s) => s.kind === "drainStat" && s.stat === "STR"),
      LOSE_INT: (r) => r.sideEffects.some((s) => s.kind === "drainStat" && s.stat === "INT"),
      LOSE_WIS: (r) => r.sideEffects.some((s) => s.kind === "drainStat" && s.stat === "WIS"),
      LOSE_DEX: (r) => r.sideEffects.some((s) => s.kind === "drainStat" && s.stat === "DEX"),
      LOSE_CON: (r) => r.sideEffects.some((s) => s.kind === "drainStat" && s.stat === "CON"),
      LOSE_ALL: (r) => r.sideEffects.filter((s) => s.kind === "drainStat").length === 5,
      /* SHATTER's earthquake needs hp > 23, so use big dice below. */
      SHATTER: (r) => r.sideEffects.some((s) => s.kind === "earthquake"),
      EXP_10: (r) => r.sideEffects.some((s) => s.kind === "loseExp" && s.holdChance === 95),
      EXP_20: (r) => r.sideEffects.some((s) => s.kind === "loseExp" && s.holdChance === 90),
      EXP_40: (r) => r.sideEffects.some((s) => s.kind === "loseExp" && s.holdChance === 75),
      EXP_80: (r) => r.sideEffects.some((s) => s.kind === "loseExp" && s.holdChance === 50),
      HALLU: (r) => r.sideEffects.some((s) => s.kind === "timed" && s.effect === "IMAGE"),
    };
    /* signature covers all but BLACK_BREATH, whose one_in_(5) cannot fire under
     * rand_fix (randint0(5) -> 4); it is proved by the seeded case below. */
    expect(Object.keys(signature).sort()).toEqual(
      RESOLVED_BLOW_EFFECTS.filter((n) => n !== "BLACK_BREATH").sort(),
    );

    for (const name of RESOLVED_BLOW_EFFECTS) {
      if (name === "BLACK_BREATH") continue;
      const rng = new Rng(1);
      rng.randFix(100);
      const p = defender();
      p.chp = 100000;
      p.mhp = 100000;
      const res = monMeleeAttack(rng, makeMon(name, "HIT", "60d10", 20), p, def);
      expect(
        signature[name]!(res),
        `${name} did not reach its own handler (fell through to default?)`,
      ).toBe(true);
    }
  });

  it("BLACK_BREATH reaches its handler (one_in_(5), so sampled)", () => {
    /* melee_effect_handler_BLACK_BREATH (mon-blows.c L1174): one_in_(5) adds
     * TMD_BLACKBREATH for damage/10 turns. rand_fix cannot make randint0(5)
     * return 0, so sample real seeds: the `default` fallthrough would produce
     * the timer in NONE of them. */
    let hits = 0;
    let breathed = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = new Rng(seed);
      const p = defender();
      p.chp = 100000;
      p.mhp = 100000;
      const res = monMeleeAttack(
        rng,
        makeMon("BLACK_BREATH", "HIT", "60d10", 20),
        p,
        def,
      );
      if (!res.blows[0]?.hit) continue;
      hits++;
      if (res.sideEffects.some((s) => s.kind === "timed" && s.effect === "BLACKBREATH")) {
        breathed++;
      }
    }
    expect(hits).toBeGreaterThan(50);
    expect(breathed).toBeGreaterThan(0);
    /* Roughly one landing blow in five, well away from 0 or 1. */
    expect(breathed / hits).toBeGreaterThan(0.1);
    expect(breathed / hits).toBeLessThan(0.35);
  });
});

/*
 * display_blow_message_vs_player (mon-blows.c L194): the "The kobold hits you."
 * line every landing blow shows, emitted immediately before take_hit. The
 * randint0(num_messages) variant draw is a no-op for the single-message methods
 * (so normal combat RNG is unchanged) and picks one of the eight lines for the
 * multi-message methods (INSULT / MOAN).
 */
describe("display_blow_message_vs_player (mon-blows.c L194)", () => {
  function capturingEnv(
    monName: string,
    showDamage: boolean,
  ): { env: MonBlowEnv; msgs: string[] } {
    const { env } = makeFakeEnv();
    const msgs: string[] = [];
    return {
      env: {
        ...env,
        msg: (t: string): void => {
          msgs.push(t);
        },
        monName,
        showDamage,
      },
      msgs,
    };
  }

  it("emits 'The kobold hits you.' on a landed HURT/HIT blow", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const { env, msgs } = capturingEnv("The kobold", false);
    monMeleeAttack(rng, makeMon("HURT", "HIT", "1d4", 5), defender(), def, { env });
    expect(msgs).toContain("The kobold hits you.");
  });

  it("appends the ' (N)' damage suffix when show_damage is on", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const { env, msgs } = capturingEnv("The kobold", true);
    monMeleeAttack(rng, makeMon("HURT", "HIT", "1d4", 5), defender(), def, { env });
    /* HURT: adjust_dam_armor(1d4 max = 4, ac 0) = 4. */
    expect(msgs).toContain("The kobold hits you. (4)");
  });

  it("announces a miss by a visible monster (mon-attack.c L718)", () => {
    const rng = new Rng(1);
    rng.randFix(0);
    const { env, msgs } = capturingEnv("The kobold", false);
    /* HIT.miss is true; the to-hit band misses at randFix(0). */
    monMeleeAttack(rng, makeMon("HURT", "HIT", "1d4", 5), defender(), def, { env });
    expect(msgs).toEqual(["The kobold misses you."]);
  });

  it("stays silent on a miss by an unseen monster", () => {
    const rng = new Rng(1);
    rng.randFix(0);
    const { env } = makeFakeEnv();
    const msgs: string[] = [];
    const unseen: MonBlowEnv = {
      ...env,
      msg: (t: string): void => {
        msgs.push(t);
      },
      monName: "Something",
      monVisible: false,
    };
    monMeleeAttack(rng, makeMon("HURT", "HIT", "1d4", 5), defender(), def, {
      env: unseen,
    });
    expect(msgs.length).toBe(0);
  });

  it("substitutes the player-target tags for the multi-message INSULT method", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const { env, msgs } = capturingEnv("The cutpurse", false);
    monMeleeAttack(rng, makeMon("EAT_GOLD", "INSULT", "1d4", 5), defender(), def, {
      env,
    });
    /* Every INSULT line ends in "!" (no added fullstop) and resolves {target}->
     * you / {oftarget}->your for a blow against the player. */
    const insults = [
      "insults you!",
      "insults your mother!",
      "gives you the finger!",
      "humiliates you!",
      "defiles you!",
      "dances around you!",
      "makes obscene gestures!",
      "moons you!!!",
    ].map((a) => `The cutpurse ${a}`);
    expect(msgs.some((m) => insults.includes(m))).toBe(true);
  });
});

/*
 * make_attack_normal's dispatch to the EAT_ effect handlers (mon-blows.c
 * melee_effect_handler_EAT_GOLD / _EAT_ITEM / _EAT_FOOD / _EAT_LIGHT), and the
 * once-per-attack blink-away (mon-attack.c L740). The real handler logic
 * (gold formula, item pick, light drain) lives behind MonBlowEnv in
 * game/mon-side.ts and is exercised there; this exercises only what
 * combat/mon-melee.ts itself is responsible for: monster_damage_target runs
 * BEFORE the handler (applyReduction then takeHit, matching
 * monster_damage_target's `bool no_further_monster_effect` gate), the handler
 * runs exactly once per blow, and `context->blinked` (mon-attack.c L740) fires
 * blinkAway at most once per attack regardless of how many blows stole.
 */
describe("make_attack_normal - EAT_ effect dispatch (mon-blows.c / mon-attack.c)", () => {
  it("EAT_GOLD: damage lands before the handler, then blinks away on a successful steal", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const { env, calls } = makeFakeEnv({ eatGoldReturn: true });
    const res = monMeleeAttack(
      rng,
      makeMon("EAT_GOLD", "TOUCH", "1d4", 5),
      defender(),
      def,
      { env },
    );
    expect(calls).toEqual(["applyReduction:4", "takeHit:4", "eatGold", "blinkAway"]);
    expect(res.attacked).toBe(true);
  });

  it("EAT_GOLD: does not blink away when nothing is stolen", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const { env, calls } = makeFakeEnv({ eatGoldReturn: false });
    monMeleeAttack(rng, makeMon("EAT_GOLD", "TOUCH", "1d4", 5), defender(), def, {
      env,
    });
    expect(calls).toEqual(["applyReduction:4", "takeHit:4", "eatGold"]);
  });

  it("EAT_ITEM / EAT_FOOD / EAT_LIGHT: damage-then-handler order, no blink by default", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["EAT_ITEM", "eatItem"],
      ["EAT_FOOD", "eatFood"],
      ["EAT_LIGHT", "eatLight"],
    ];
    for (const [effectName, call] of cases) {
      const rng = new Rng(1);
      rng.randFix(100);
      const { env, calls } = makeFakeEnv();
      monMeleeAttack(rng, makeMon(effectName, "TOUCH", "1d4", 5), defender(), def, {
        env,
      });
      expect(calls).toEqual(["applyReduction:4", "takeHit:4", call]);
    }
  });

  it("EAT_ITEM: blinks away when the handler reports a steal", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const { env, calls } = makeFakeEnv({
      eatItemReturn: { blinked: true, obvious: true },
    });
    monMeleeAttack(rng, makeMon("EAT_ITEM", "TOUCH", "1d4", 5), defender(), def, {
      env,
    });
    expect(calls).toEqual(["applyReduction:4", "takeHit:4", "eatItem", "blinkAway"]);
  });

  it("blinks away only once per attack even when two blows each steal", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const mon = makeMonMultiBlow(
      [
        ["EAT_GOLD", "TOUCH", "1d4"],
        ["EAT_ITEM", "TOUCH", "1d4"],
      ],
      5,
    );
    const { env, calls } = makeFakeEnv({
      eatGoldReturn: true,
      eatItemReturn: { blinked: true, obvious: true },
    });
    monMeleeAttack(rng, mon, defender(), def, { env });
    expect(calls.filter((c) => c === "blinkAway").length).toBe(1);
    expect(calls.filter((c) => c === "eatGold").length).toBe(1);
    expect(calls.filter((c) => c === "eatItem").length).toBe(1);
    /* blinkAway is the very last call, after both blows' handlers. */
    expect(calls[calls.length - 1]).toBe("blinkAway");
  });

  it("skips the handler entirely (and never blinks) when the blow misses", () => {
    const rng = new Rng(1);
    rng.randFix(0); // miss (see the "misses in the bottom to-hit band" case above)
    const { env, calls } = makeFakeEnv({ eatGoldReturn: true });
    const res = monMeleeAttack(
      rng,
      makeMon("EAT_GOLD", "TOUCH", "1d4", 5),
      defender(),
      def,
      { env },
    );
    expect(res.blows[0]?.hit).toBe(false);
    expect(calls).toEqual([]);
  });
});
