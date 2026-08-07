import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MFLAG, PROJ, RF } from "../generated/index.js";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
} from "../effects/interpreter.js";
import type { EffectContext } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { loc } from "../loc.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { Dice } from "../dice.js";
import type { MonsterRace } from "../mon/types.js";
import { addMon, makeRace, makeState, monReg } from "./harness.js";
import type { GameState } from "./context.js";
import { basicPlayerActor, monsterCastSource } from "./project-cast.js";
import type { CastContext } from "./project-cast.js";
import { attachGameEnv } from "./effect-game-env.js";
import type { GameEffectEnv } from "./effect-game-env.js";
import { registerAttackHandlers } from "./effect-attack.js";
import { buildScore } from "../score/score.js";
import { makeTakeHitHooks } from "./take-hit-hooks.js";
import { takeHit } from "../player/take-hit.js";

const projections = bindProjections(
  JSON.parse(
    readFileSync(
      new URL("../../../content/pack/projection.json", import.meta.url),
      "utf8",
    ),
  ).records as ProjectionRecordJson[],
);

const plainRace = monReg.races.find(
  (r) =>
    r.rarity > 0 &&
    !r.flags.has(RF.UNIQUE) &&
    !r.flags.has(RF.IM_FIRE) &&
    !r.flags.has(RF.HURT_FIRE),
)!;

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerAttackHandlers(r);
  return r;
}

function castContext(state: GameState): CastContext {
  return { projections, maxRange: 20, playerActor: basicPlayerActor(state) };
}

function env(state: GameState, game: Partial<GameEffectEnv> = {}): EffectContext {
  return attachGameEnv(
    { rng: state.rng },
    { state, cast: castContext(state), ...game },
  );
}

describe("attack effect handlers - dispatch through the registry", () => {
  it("EF_BOLT damages the aimed monster and sets ident", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const ident = { value: false };
    registry().effectSimple(EF.BOLT, env(state, { aimed: mon.grid }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
      ident,
    });
    expect(mon.hp).toBe(30);
    expect(ident.value).toBe(true);
  });

  /*
   * project.c:147/218: project_path reads cave->decoy off the chunk and
   * PROJECT_STOP breaks the path there, so a decoy dropped in a bolt's way
   * eats it. The port's decoy lives on GameState, so project() has to be
   * PASSED it - and it was not, which is why world/project.ts compared against
   * a never-matching (-1,-1) sentinel. This asserts the LIVE call, because the
   * path-level test cannot tell whether anything supplies the grid.
   */
  it("a decoy in the path eats a bolt before it reaches the monster", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 9), { hp: 50 });
    state.decoy = loc(5, 7);
    registry().effectSimple(EF.BOLT, env(state, { aimed: mon.grid }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
    });
    expect(mon.hp).toBe(50);
  });

  it("...and reaches it once the decoy is gone (the control)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 9), { hp: 50 });
    state.decoy = null;
    registry().effectSimple(EF.BOLT, env(state, { aimed: mon.grid }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
    });
    expect(mon.hp).toBe(30);
  });

  it("EF_BEAM passes through several monsters in line", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const near = addMon(state, plainRace, loc(5, 7), { hp: 50 });
    const far = addMon(state, plainRace, loc(5, 9), { hp: 50 });
    registry().effectSimple(EF.BEAM, env(state, { aimed: loc(5, 9) }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
    });
    expect(near.hp).toBe(30);
    expect(far.hp).toBe(30);
  });

  it("EF_BALL from a monster detonates on the player", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    registry().effectSimple(EF.BALL, env(state), {
      origin: sourceMonster(mon.midx),
      diceString: "30",
      subtype: PROJ.FIRE,
    });
    expect(state.actor.player.chp).toBe(70);
  });

  it("EF_PROJECT_LOS hits every monster in line of sight", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const a = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const b = addMon(state, plainRace, loc(8, 5), { hp: 50 });
    registry().effectSimple(EF.PROJECT_LOS, env(state), {
      origin: sourcePlayer(),
      diceString: "15",
      subtype: PROJ.FIRE,
    });
    expect(a.hp).toBe(35);
    expect(b.hp).toBe(35);
  });

  it("no-ops without an attack environment (worldless rule)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const worldless: EffectContext = { rng: state.rng };
    const ran = registry().effectSimple(EF.BOLT, worldless, {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
    });
    expect(ran).toBe(true);
    expect(mon.hp).toBe(50);
  });

  it("EF_BOLT_STATUS identifies only when the projection was noticed", () => {
    /* An unseen monster: the bolt lands but nothing was noticed. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const ident = { value: false };
    registry().effectSimple(EF.BOLT_STATUS, env(state, { aimed: mon.grid }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
      ident,
    });
    expect(mon.hp).toBe(30);
    expect(ident.value).toBe(false);

    /* A visible monster: the effect is noticed and identifies. */
    const seen = makeState({ playerGrid: loc(5, 5) });
    const vis = addMon(seen, plainRace, loc(5, 8), { hp: 50 });
    vis.mflag.on(MFLAG.VISIBLE);
    const ident2 = { value: false };
    registry().effectSimple(EF.BOLT_STATUS, env(seen, { aimed: vis.grid }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
      ident: ident2,
    });
    expect(vis.hp).toBe(30);
    expect(ident2.value).toBe(true);
  });

  it("EF_LASH whips the player with the first blow's lash element", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 8 });
    state.actor.player.chp = 1000;
    const dice = new Dice();
    dice.parseString("10d1"); /* a fixed 10 per roll */
    const blow = {
      method: { name: "HIT" },
      effect: { name: "HURT", lashType: "FIRE" },
      dice,
      diceRaw: "10d1",
    } as unknown as MonsterRace["blows"][number];
    const race = { ...makeRace(), blows: [blow, blow] };
    const mon = addMon(state, race, loc(5, 8), { hp: 50 });

    const ident = { value: false };
    registry().effectSimple(EF.LASH, env(state), {
      origin: sourceMonster(mon.midx),
      radius: 3,
      ident,
    });
    /* Full first blow (10) plus half the second (5), through the player's
     * fire adjustment (none on the bare test actor). */
    expect(state.actor.player.chp).toBeLessThan(1000);
    expect(ident.value).toBe(true);
  });

  it("EF_LASH targets another monster when the caster is aiming at it (5.3)", () => {
    const state = makeState({ playerGrid: loc(15, 15), seed: 8 });
    state.actor.player.chp = 1000;
    const dice = new Dice();
    dice.parseString("10d1");
    const blow = {
      method: { name: "HIT" },
      effect: { name: "HURT", lashType: "FIRE" },
      dice,
      diceRaw: "10d1",
    } as unknown as MonsterRace["blows"][number];
    const race = { ...makeRace(), blows: [blow, blow] };
    const caster = addMon(state, race, loc(5, 8), { hp: 50 });
    const victim = addMon(state, plainRace, loc(5, 7), { hp: 50 });
    caster.target.midx = victim.midx;

    registry().effectSimple(EF.LASH, env(state), {
      origin: sourceMonster(caster.midx),
      radius: 3,
    });
    /* The lash strikes the targeted monster, sparing the distant player. */
    expect(victim.hp).toBeLessThan(50);
    expect(state.actor.player.chp).toBe(1000);
  });

  it("EF_LASH from a player source fails (monsters only)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const ran = registry().effectSimple(EF.LASH, env(state), {
      origin: sourcePlayer(),
      radius: 3,
    });
    expect(ran).toBe(false);
  });

  /**
   * A1/A2 (effect-handler-attack.c:811-814, 868-870): a monster-sourced ARC and
   * SHORT_BEAM target the player's grid DIRECTLY with no random draw - unlike
   * BALL/BREATH they have no confused-dir / target-monster branch. The old port
   * routed them through monsterGetTarget, which draws randint1(100) (and, when
   * confused, randint1(9)), desyncing the RNG and possibly mis-aiming. These
   * assert the player is hit AND the RNG state is untouched by targeting.
   */
  /**
   * The target-resolution draw removed by A1/A2 is monsterGetTarget's
   * `randint1(100)` accuracy roll (effect-mon-origin.ts). The fire projection
   * against a bare actor never rolls randint1(100) itself, so recording every
   * randint1 argument and asserting 100 never appears is a precise guard: it
   * fails the moment the monster path is re-routed through monsterGetTarget.
   */
  function spyRandint1(state: GameState): number[] {
    const args: number[] = [];
    const real = state.rng.randint1.bind(state.rng);
    state.rng.randint1 = (n: number): number => {
      args.push(n);
      return real(n);
    };
    return args;
  }

  it("EF_ARC from a monster hits the player with no spurious targeting draw (A1)", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    state.actor.player.chp = 100;
    const mon = addMon(state, plainRace, loc(10, 13), { hp: 50 });
    const r1Args = spyRandint1(state);
    registry().effectSimple(EF.ARC, env(state), {
      origin: sourceMonster(mon.midx),
      diceString: "30",
      subtype: PROJ.FIRE,
      radius: 6,
      other: 60,
    });
    expect(state.actor.player.chp).toBeLessThan(100);
    expect(r1Args).not.toContain(100); /* no monsterGetTarget accuracy roll */
  });

  it("EF_SHORT_BEAM from a monster hits the player with no spurious targeting draw (A2)", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    state.actor.player.chp = 100;
    const mon = addMon(state, plainRace, loc(10, 13), { hp: 50 });
    const r1Args = spyRandint1(state);
    registry().effectSimple(EF.SHORT_BEAM, env(state), {
      origin: sourceMonster(mon.midx),
      diceString: "30",
      subtype: PROJ.FIRE,
      radius: 6,
    });
    expect(state.actor.player.chp).toBeLessThan(100);
    expect(r1Args).not.toContain(100);
  });

  it("EF_STRIKE reverts to the player grid when the target is unreachable (A5)", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    /* A monster adjacent to the player, and an aim at a granite border grid
     * that is not projectable from the player. With the fallback the strike
     * centres on the player and catches the neighbour; without it, the blast
     * lands on the wall and the neighbour is untouched. */
    const mon = addMon(state, plainRace, loc(11, 10), { hp: 50 });
    /* effect_simple defaults dir to DIR_TARGET, so the aimed grid is consulted. */
    registry().effectSimple(EF.STRIKE, env(state, { aimed: loc(0, 0) }), {
      origin: sourcePlayer(),
      diceString: "40",
      subtype: PROJ.FIRE,
      radius: 1,
    });
    expect(mon.hp).toBeLessThan(50);
  });

});

/**
 * A4 (effect-handler-attack.c:411-440): a monster TOUCH does not always hit the
 * player. PORT_TODO 2.13 called these two branches deferred; they were BUILT,
 * complete, and in upstream's order - the item existed because `castTouch`'s
 * docblock in the neighbouring file still said they were not. What was genuinely
 * missing is what a closed item needs most: any test at all.
 *
 * The branches are reachable, measured rather than assumed: exactly ONE monster
 * spell uses TOUCH in 4.2.6 (`TRAPS`, `effect:TOUCH:MAKE_TRAP:3` at
 * monster_spell.txt:1050), and a monster spell is always SRC_MONSTER. So with a
 * decoy deployed, a caster that would otherwise ring the PLAYER with traps must
 * ring the decoy instead - which is the whole point of a decoy.
 */
describe("EF_TOUCH's monster-source branches (A4)", () => {
  /*
   * A FIXTURE MISTAKE OF MINE IS BURIED HERE, and it is the reason the
   * assertions below are shaped the way they are. My first draft asserted "the
   * targeted monster is hit" - declared from intuition - and it failed. It failed
   * because upstream sources the ball at `mon->target.midx`, the TARGET monster
   * itself (effect-handler-attack.c:431), and project_m returns early for its own
   * source monster (project-mon.c:1382, ported at project-monster.ts:149). So the
   * victim is EXEMPT from the ball centred on it, and only its neighbours are
   * struck. That is an upstream wart, not a port bug, and the way to see it is to
   * derive the expectation from the C rather than declare it.
   */
  it("centres a monster's touch on the DECOY, not the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const caster = addMon(state, plainRace, loc(10, 13), { hp: 50 });
    /* Far enough from the player that a player-centred ball cannot reach him, so
     * "the player was spared" is a real observation and not a radius accident. */
    state.decoy = loc(20, 10);
    /* A bystander NEXT TO the decoy: the positive half. Without it this test
     * would pass just as well if the effect did nothing at all. The decoy branch
     * sources the ball at a TRAP, so no monster is exempt from it. */
    const nearDecoy = addMon(state, plainRace, loc(21, 10), { hp: 50 });
    state.actor.player.chp = 1000;

    registry().effectSimple(EF.TOUCH, env(state), {
      origin: sourceMonster(caster.midx),
      diceString: "40",
      subtype: PROJ.FIRE,
      radius: 1,
    });

    expect(nearDecoy.hp, "the ball landed on the decoy").toBeLessThan(50);
    expect(state.actor.player.chp, "and the player is untouched").toBe(1000);
  });

  it("centres it on the TARGET MONSTER when there is no decoy", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const caster = addMon(state, plainRace, loc(10, 20), { hp: 50 });
    const victim = addMon(state, plainRace, loc(12, 20), { hp: 50 });
    /* Adjacent to the victim, so it is inside a radius-1 ball centred there and
     * NOT exempt from it. This is what proves the centring, since the victim
     * itself cannot be hurt by its own source. */
    const nearVictim = addMon(state, plainRace, loc(13, 20), { hp: 50 });
    caster.target.midx = victim.midx;
    state.actor.player.chp = 1000;
    expect(
      state.decoy,
      "fixture: no decoy, so the second branch decides",
    ).toBeUndefined();

    registry().effectSimple(EF.TOUCH, env(state), {
      origin: sourceMonster(caster.midx),
      diceString: "40",
      subtype: PROJ.FIRE,
      radius: 1,
    });

    expect(nearVictim.hp, "the ball landed on the victim's grid").toBeLessThan(50);
    expect(victim.hp, "the victim is its own source, so exempt").toBe(50);
    expect(state.actor.player.chp, "the distant player is spared").toBe(1000);
  });

  it("prefers the decoy over the target monster, as the C order does", () => {
    /* L421-434: the decoy branch is tested FIRST and returns. Swapping the two
     * would send the ball at the monster while a decoy stood waiting. */
    const state = makeState({ playerGrid: loc(10, 10) });
    const caster = addMon(state, plainRace, loc(10, 20), { hp: 50 });
    const victim = addMon(state, plainRace, loc(12, 20), { hp: 50 });
    const nearVictim = addMon(state, plainRace, loc(13, 20), { hp: 50 });
    caster.target.midx = victim.midx;
    state.decoy = loc(25, 10);
    const nearDecoy = addMon(state, plainRace, loc(26, 10), { hp: 50 });

    registry().effectSimple(EF.TOUCH, env(state), {
      origin: sourceMonster(caster.midx),
      diceString: "40",
      subtype: PROJ.FIRE,
      radius: 1,
    });

    expect(nearDecoy.hp, "the decoy branch won").toBeLessThan(50);
    expect(nearVictim.hp, "so nothing landed near the target monster").toBe(50);
  });

  it("still centres a PLAYER-sourced touch on the player (the fall-through)", () => {
    /* The base path castTouch owns, and the one the two branches must not steal:
     * origin.what is SRC_PLAYER, so neither monster branch applies even with a
     * decoy standing. */
    const state = makeState({ playerGrid: loc(10, 10) });
    const adjacent = addMon(state, plainRace, loc(11, 10), { hp: 50 });
    state.decoy = loc(25, 10);
    const nearDecoy = addMon(state, plainRace, loc(26, 10), { hp: 50 });

    registry().effectSimple(EF.TOUCH, env(state), {
      origin: sourcePlayer(),
      diceString: "40",
      subtype: PROJ.FIRE,
      radius: 1,
    });

    expect(adjacent.hp, "the ring around the player still lands").toBeLessThan(50);
    expect(nearDecoy.hp, "and the decoy is irrelevant to a player source").toBe(50);
  });
});

/**
 * monster_desc(MDESC_DIED_FROM) as the death cause. PORT_TODO 3.2.
 *
 * MDESC_DIED_FROM is MDESC_SHOW | MDESC_IND_VIS: the full name, with the
 * indefinite article an ordinary monster gets and a unique does not. Both death
 * sites wrote the bare race name, so a tombstone and a high-score row read
 * "Killed by kobold".
 *
 * THE ITEM WAS WRONG ABOUT ITS THIRD SITE, in the helpful direction. It said the
 * high-score entry "cannot name the killer at all because it is not wired through
 * GameState". It is wired: `take-hit-hooks.ts:68` writes `p.diedFrom = killer` and
 * `score.ts:98` reads it as `how`. So fixing the two death sites fixes the score
 * row with them, and the last test here walks that whole chain.
 *
 * WHAT THESE TESTS DRIVE, and why not the handler. `handleDAMAGE` reaches its
 * killer through `damageEffectApplyToPlayer`, which needs `ctx.env.player` -
 * something this file's minimal `env()` does not build (the working damage tests
 * above land through the PROJECTION path instead). Rather than grow a player
 * adapter for one string, these tests exercise `monsterCastSource`, which is the
 * function the projection death cause actually comes from, and then push its
 * string through the real `takeHit` and `buildScore`. Stated rather than left as
 * an apparent oversight.
 */
describe("the death cause names the killer as upstream does", () => {
  /** A race with a chosen name, for the article rules. */
  function namedRace(name: string, flags: number[] = []): MonsterRace {
    return { ...makeRace({ flags }), name } as MonsterRace;
  }

  function killerFor(name: string, flags: number[] = []): string {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, namedRace(name, flags), loc(5, 6), { hp: 50 });
    /* source_monster(midx) (project-cast.ts): the source a monster projection
     * carries, and origin.killer is what projectPlayer hands to takeHit. */
    return monsterCastSource(state, mon.midx).killer ?? "";
  }

  it('an ordinary monster gets its indefinite article ("a kobold")', () => {
    expect(killerFor("kobold")).toBe("a kobold");
  });

  it('a vowel-initial name gets "an", not "a"', () => {
    expect(killerFor("orc archer")).toBe("an orc archer");
  });

  it("a UNIQUE gets no article at all", () => {
    /* monsterDesc's unique branch returns the bare name (desc.ts:186). That is
     * also why the "Killed <unique>" history line at session/game.ts:951 is
     * correct to use race.name directly - checked against monsterDesc, not
     * assumed from the comment that says so. */
    expect(killerFor("Grip, Farmer Maggot's dog", [RF.UNIQUE])).toBe(
      "Grip, Farmer Maggot's dog",
    );
  });

  it("still answers for a midx with no monster", () => {
    /* The `?? "a monster"` fallback: a dead or invalid source must not produce
     * "undefined" as a cause of death. */
    const state = makeState({ playerGrid: loc(5, 5) });
    expect(monsterCastSource(state, 999).killer).toBe("a monster");
  });

  it("carries the article through takeHit into the high-score row", () => {
    /* The chain the item said was broken: killer -> takeHit -> p.diedFrom ->
     * score.how. Driven with the REAL hooks, because makeState's defaults hurt
     * the player without recording the death - a first draft of these tests read
     * an empty diedFrom and would have passed against any killer name at all. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, namedRace("kobold"), loc(5, 6), { hp: 50 });
    const killer = monsterCastSource(state, mon.midx).killer!;
    const p = state.actor.player;
    p.chp = 1;

    takeHit(
      { ...p, get chp() { return p.chp; }, set chp(v) { p.chp = v; } } as never,
      30,
      killer,
      makeTakeHitHooks(state),
    );

    expect(p.diedFrom, "recordDeath ran").toBe("a kobold");
    const entry = buildScore(p, {
      diedFrom: p.diedFrom,
      turn: state.turn,
      depth: state.chunk.depth,
    });
    expect(entry.how).toBe("a kobold");
  });
});
