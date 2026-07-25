/**
 * The equipped-item curse effect countdown, ported from reference/src/game-world.c
 * (Angband 4.2.6): the curse loop of decrease_timeouts (L343-364) plus
 * reference/src/obj-curse.c do_curse_effect (L353-371).
 *
 * Every game turn, each curse carried on an equipped item counts its timeout
 * down; when it reaches zero the curse fires its effect (a random direction, the
 * curse's flavour message, then the curse object's effect chain run with an
 * object source) and re-rolls its timeout from the curse's time dice. This draws
 * RNG exactly as upstream - randint1(8) for the direction, the effect's own
 * draws, then randcalc(time, RANDOMISE) for the new timeout - so it is wired
 * only when a cursed item is actually equipped; the countdown itself (a plain
 * decrement) never draws.
 *
 * The seam mirrors the trap / object effect stack: the session installs the
 * effect bundle (registry + cast + env) and the curses registry, exactly the
 * pieces do_cmd_use and hit_trap already share.
 */

import { sourceObject } from "../effects/interpreter";
import type { GameObject } from "../obj/object";
import type { Curse } from "../obj/types";
import { playerKnowsCurse, playerLearnCurse } from "../obj/knowledge";
import type { ObjCmdDeps } from "./obj-cmd";
import { buildObjectEffectChain } from "./obj-cmd";
import { buildEffectContext } from "./effect-env";
import { attachGameEnv } from "./effect-game-env";
import { disturb } from "./player-path";
import type { GameState } from "./context";

/** The pieces do_curse_effect needs: the curses registry and the effect stack. */
export interface CurseTickDeps {
  /** The global curses[] registry (curse.txt), indexed by curse index. */
  curses: readonly (Curse | null)[];
  /** The same effect bundle traps / objects run their chains through. */
  effects: Pick<
    ObjCmdDeps,
    | "registry"
    | "cast"
    | "envDeps"
    | "inject"
    | "teleport"
    | "general"
    | "item"
    | "summon"
  >;
}

/**
 * do_curse_effect (obj-curse.c L353): fire curse `i` carried on `obj`. Draws a
 * random direction (randint1(8), skipping 5 as upstream does), prints the
 * curse's flavour message, runs its effect chain with an object source, then
 * disturbs the player. Returns whether the curse was newly identified (a fresh
 * curse whose effect identified itself), so the caller can learn it.
 */
function doCurseEffect(
  state: GameState,
  obj: GameObject,
  curseIndex: number,
  deps: CurseTickDeps,
): boolean {
  const curse = deps.curses[curseIndex];
  if (!curse) return false;
  const p = state.actor.player;
  const wasAware = playerKnowsCurse(p, curseIndex);

  /* A random direction for direction-taking effects (obj-curse.c L359-363). */
  let dir = state.rng.randint1(8);
  if (dir > 4) dir++;

  /* The curse's flavour message (msgt MSG_GENERIC). */
  if (curse.obj.effectMsg) state.msg?.(curse.obj.effectMsg);

  const ident = { value: false };
  const records = curse.obj.effect;
  if (records && records.length > 0) {
    const chain = buildObjectEffectChain(records, state, deps.effects.inject);
    const ctx = attachGameEnv(buildEffectContext(state, deps.effects.envDeps), {
      state,
      cast: deps.effects.cast,
      ...(deps.effects.envDeps.takeHitHooks
        ? { takeHitHooks: deps.effects.envDeps.takeHitHooks }
        : {}),
      ...(deps.effects.teleport ? { teleport: deps.effects.teleport } : {}),
      ...(deps.effects.general ? { general: deps.effects.general } : {}),
      ...(deps.effects.item ? { item: deps.effects.item } : {}),
      ...(deps.effects.summon ? { summon: deps.effects.summon } : {}),
    });
    deps.effects.registry.effectDo(chain, ctx, {
      origin: sourceObject(obj),
      aware: wasAware,
      dir,
      ident,
    });
  }

  /* curse->obj->known->effect assignment (obj-curse.c L368) rides the known-
   * object subsystem and is deferred; it only gates the object-info display of
   * an already-learned curse and draws no RNG. */
  disturb(state);
  return !wasAware && ident.value;
}

/**
 * The curse loop of decrease_timeouts (game-world.c L343-364): count every
 * equipped item's curse timeouts down by one, and when one reaches zero fire it,
 * learn it if it revealed itself, and re-roll its timeout from the curse's time.
 */
export function processCurseTimeouts(
  state: GameState,
  deps: CurseTickDeps,
): void {
  const p = state.actor.player;
  for (let i = 0; i < p.body.count; i++) {
    const obj = state.runeEnv.slotObject(i);
    if (!obj || !obj.curses) continue;
    for (let j = 0; j < deps.curses.length; j++) {
      const data = obj.curses[j];
      if (!data || !data.power) continue;
      data.timeout--;
      if (data.timeout === 0) {
        if (doCurseEffect(state, obj, j, deps)) {
          playerLearnCurse(p, state.runeEnv, j);
        }
        const c = deps.curses[j];
        if (c) data.timeout = state.rng.randcalc(c.obj.time, 0, "randomise");
      }
    }
  }
}
