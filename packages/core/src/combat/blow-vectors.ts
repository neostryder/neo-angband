/**
 * Golden vectors for monster blow resolution.
 *
 * WHY THIS EXISTS. Converting the two 26-case blow-effect switches in
 * mon-melee.ts into a registry is a refactor of live combat, and the thing that
 * must be proven is not "the tests still pass" but "every blow resolves
 * identically, including the RNG position it leaves behind". The 67 existing
 * tests over these paths assert particular behaviours; they do not span
 * 30 effects x both paths x the branches inside each handler.
 *
 * So the ground truth is DERIVED, not declared: this module walks a grid of
 * blow scenarios through the public `monMeleeAttack` entry point and records
 * everything observable - the result, the env call sequence with its arguments,
 * the messages, and a probe draw taken from the RNG afterwards. The fixture
 * committed beside it (`blow-vectors.json`) was generated from the code as it
 * stood BEFORE the registry existed, so a vector that still matches is evidence
 * the refactor changed nothing, and a vector that does not names the blow, the
 * path, and the scenario that moved.
 *
 * The probe matters more than it looks. Two implementations can agree on damage
 * and side effects while drawing a different NUMBER of random values, which is
 * invisible in the blow itself and diverges the whole game a few turns later.
 * `rngProbe` is one draw taken after the attack: it can only match if the
 * stream is at the same position.
 *
 * Fixtures are INJECTED rather than loaded here, so this module pulls in no
 * node:fs and no content pack, and can be imported from anywhere.
 *
 * Regenerate with `node packages/core/scripts/gen-blow-vectors.mjs` - which
 * OVERWRITES the evidence, so only do it when the change is intended and say so
 * in the commit.
 */

import { Rng } from "../rng.js";
import { loc } from "../loc.js";
import type { Monster } from "../mon/monster.js";
import type { Player } from "../player/player.js";
import type { DefenderState, MonBlowEnv, MonMeleeAttack } from "./mon-melee.js";
import { monMeleeAttack, RESOLVED_BLOW_EFFECTS } from "./mon-melee.js";

/** How a vector's scenario is built, supplied by the caller (test or script). */
export interface BlowVectorFixtures {
  /** A monster whose single blow is (effect, method) with the given dice. */
  makeMonster(effect: string, method: string, dice: string, level: number): Monster;
  /** A fresh level-1 player with 100/100 hp. */
  makePlayer(): Player;
}

/** One recorded run of one scenario down one path. */
export interface BlowVectorRun {
  attacked: boolean;
  playerDied: boolean;
  totalDamage: number;
  blows: string[];
  sideEffects: string[];
  /** The defender's hp afterwards, so damage APPLICATION is covered too. */
  chp: number;
  /** Every env method that touched the world, in order, with its arguments. */
  calls: string[];
  /** Messages emitted, in order. */
  msgs: string[];
  /** One draw taken after the attack: only matches if the stream is aligned. */
  rngProbe: number;
}

/** One scenario, run down every path. */
export interface BlowVector {
  effect: string;
  method: string;
  dice: string;
  ac: number;
  hp: number;
  /** No env: the recording path, which logs side-effect intents. */
  worldless: BlowVectorRun;
  /** An env that resists nothing and saves against nothing. */
  liveSoft: BlowVectorRun;
  /** An env that resists, saves, and whose thefts blink the monster away. */
  liveHard: BlowVectorRun;
}

/** The scenario grid. Every axis here changes which branches a handler takes. */
const METHODS = ["HIT", "INSULT"] as const;
const DICE = ["1d4", "15d15"] as const;
const ACS = [0, 60] as const;
const HPS = [100, 1] as const;
const LEVEL = 25;
const SEED = 20260808;

/**
 * INSULT is in the grid on purpose: its blow method carries 8 action messages,
 * so `monster_blow_method_action` draws `randint0(8)` where a single-message
 * method draws nothing. That draw is the first RNG event of the effect, which
 * makes it the axis most likely to expose a handler that moved its message.
 */

function describeSideEffect(s: {
  kind: string;
  [k: string]: unknown;
}): string {
  const rest = Object.keys(s)
    .filter((k) => k !== "kind")
    .sort()
    .map((k) => `${k}=${String(s[k])}`)
    .join(",");
  return rest === "" ? s.kind : `${s.kind}(${rest})`;
}

function describeResult(
  r: MonMeleeAttack,
  chp: number,
  calls: string[],
  msgs: string[],
  rngProbe: number,
): BlowVectorRun {
  return {
    attacked: r.attacked,
    playerDied: r.playerDied,
    totalDamage: r.totalDamage,
    blows: r.blows.map(
      (b) =>
        `${b.hit ? "hit" : "miss"} ${b.effect}/${b.method} dam=${b.damage} ` +
        `obvious=${String(b.obvious)} [${b.sideEffects.map(describeSideEffect).join(" ")}]`,
    ),
    sideEffects: r.sideEffects.map(describeSideEffect),
    chp,
    calls,
    msgs,
    rngProbe,
  };
}

/**
 * A recording MonBlowEnv. Every method logs itself with its arguments, so the
 * ORDER of world-touching calls is part of the evidence rather than something
 * a reader has to infer from the damage numbers.
 *
 * `hard` flips every branch the env controls: resists, saving throws, and the
 * two theft results. Both variants are recorded because a handler that dropped
 * a save check would still match the soft run.
 */
function recordingEnv(
  player: Player,
  monster: Monster,
  hard: boolean,
): { env: MonBlowEnv; calls: string[]; msgs: string[] } {
  const calls: string[] = [];
  const msgs: string[] = [];
  let died = false;
  const env: MonBlowEnv = {
    playerGrid: () => loc(0, 0),
    applyReduction: (dam) => {
      const out = hard ? Math.trunc(dam / 2) : dam;
      calls.push(`applyReduction(${dam})->${out}`);
      return out;
    },
    takeHit: (dam) => {
      player.chp -= dam;
      died = player.chp < 0;
      calls.push(`takeHit(${dam}) chp=${player.chp}${died ? " DEAD" : ""}`);
    },
    finishElemental: () => calls.push("finishElemental"),
    get playerDied() {
      return died;
    },
    msg: (text, msgt) => {
      msgs.push(msgt === undefined ? text : `${text} <${msgt}>`);
    },
    monName: `The ${monster.race.name}`,
    showDamage: true,
    monVisible: true,
    disturb: () => calls.push("disturb"),
    elementalDam: (proj, dam) => {
      const out = hard ? Math.trunc(dam / 3) : dam;
      calls.push(`elementalDam(${proj},${dam})->${out}`);
      return out;
    },
    invenDamage: (elem, cperc) => calls.push(`invenDamage(${elem},${cperc})`),
    resists: (elem) => {
      calls.push(`resists(${elem})->${String(hard)}`);
      return hard;
    },
    incTimed: (tmd, amount, check) => {
      calls.push(`incTimed(${tmd},${amount},${String(check)})`);
      return true;
    },
    saveVsSkill: () => {
      calls.push(`saveVsSkill->${String(hard)}`);
      return hard;
    },
    drainStat: (stat) => calls.push(`drainStat(${stat})`),
    hasHoldLife: () => {
      calls.push(`hasHoldLife->${String(hard)}`);
      return hard;
    },
    drainExp: (chance, amount) => calls.push(`drainExp(${chance},${amount})`),
    drainCharges: (rlev) => calls.push(`drainCharges(${rlev})`),
    eatGold: () => {
      calls.push(`eatGold->${String(hard)}`);
      return hard;
    },
    eatItem: () => {
      calls.push(`eatItem->${String(hard)}`);
      return { blinked: hard, obvious: !hard };
    },
    eatFood: () => calls.push("eatFood"),
    eatLight: () => calls.push("eatLight"),
    disenchant: () => calls.push("disenchant"),
    earthquake: (radius) => calls.push(`earthquake(${radius})`),
    thrust: (dist) => calls.push(`thrust(${dist})`),
    blinkAway: () => calls.push("blinkAway"),
  };
  return { env, calls, msgs };
}

/**
 * Run the whole grid and return what every scenario did. Deterministic: each
 * run gets its own `Rng(SEED)`, so a vector depends on nothing outside this
 * module and the injected fixtures.
 */
export function computeBlowVectors(f: BlowVectorFixtures): BlowVector[] {
  const out: BlowVector[] = [];
  for (const effect of RESOLVED_BLOW_EFFECTS) {
    for (const method of METHODS) {
      for (const dice of DICE) {
        for (const ac of ACS) {
          for (const hp of HPS) {
            const def: DefenderState = { ac, toA: 0 };

            const wRng = new Rng(SEED);
            const wPlayer = f.makePlayer();
            wPlayer.chp = hp;
            const wResult = monMeleeAttack(
              wRng,
              f.makeMonster(effect, method, dice, LEVEL),
              wPlayer,
              def,
            );
            const worldless = describeResult(
              wResult,
              wPlayer.chp,
              [],
              [],
              wRng.randint0(100_000_000),
            );

            const live = ([false, true] as const).map((hard) => {
              const rng = new Rng(SEED);
              const player = f.makePlayer();
              player.chp = hp;
              const monster = f.makeMonster(effect, method, dice, LEVEL);
              const rec = recordingEnv(player, monster, hard);
              const result = monMeleeAttack(rng, monster, player, def, {
                env: rec.env,
              });
              return describeResult(
                result,
                player.chp,
                rec.calls,
                rec.msgs,
                rng.randint0(100_000_000),
              );
            });

            out.push({
              effect,
              method,
              dice,
              ac,
              hp,
              worldless,
              liveSoft: live[0] as BlowVectorRun,
              liveHard: live[1] as BlowVectorRun,
            });
          }
        }
      }
    }
  }
  return out;
}
