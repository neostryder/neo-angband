/**
 * The producer for the three projection handler tables.
 *
 * project_f (37 arms), project_o (11) and project_p (21) each became a keyed
 * registry on 2026-08-08/09, each with an override field - `env.featHandlers`,
 * `env.objHandlers`, `deps.playerHandlers`. Nothing wrote any of them. The
 * conversions were the hard, parity-sensitive half (6,912 golden vectors for
 * project_p alone) and they bought a mod nothing at all, because a field a mod
 * cannot set is not a seam a mod can use.
 *
 * This is the other half: one registry per game, seeded from core's tables,
 * reachable through `registry:projection`.
 *
 * PER CODE, NOT PER TABLE. The override fields are typed as whole tables and
 * their comments said composing several mods' tables was "the host's job" - and
 * a whole table cannot compose. Two mods each handing over a complete map means
 * the second silently discards the first, including its brand-new projection.
 * So a mod writes ONE code at a time, and `handlerFor(code)` hands back whatever
 * is installed right now - core's handler, or an earlier mod's. Mod B wrapping
 * mod A's WATER handler works exactly the way mod A wrapping core's does, which
 * is what "one modder can overwrite or extend another's" requires.
 *
 * THE TABLE IS LIVE. `table` returns the registry's own Map, and the engine
 * holds that object from `wireGame` onward. `register(host, ctx)` runs with a
 * live game - after the wiring - so a snapshot taken at wiring time would be a
 * seam that silently ignored every mod. The identity is the mechanism, and
 * `projection-registry.test.ts` asserts it directly.
 *
 * PER GAME, NEVER SHARED. Constructed with a COPY of each core table, for the
 * same reason `BlowEffectRegistry` and `StoreBehaviourRegistry` are built per
 * game in wireGame: a module-level singleton would carry one character's mod
 * into the next character's game, and mutating PROJECT_FEAT_HANDLERS itself
 * would carry it into every game in the process.
 */

import { PROJECT_FEAT_HANDLERS } from "./project-feat.js";
import type { ProjectFeatHandler } from "./project-feat.js";
import { PROJECT_OBJ_HANDLERS } from "./project-obj.js";
import type { ProjectObjHandler } from "./project-obj.js";
import { PLAYER_SIDE_HANDLERS } from "./player-side.js";
import type { PlayerSideHandler } from "./player-side.js";

/**
 * One handler table, keyed by projection CODE.
 *
 * The key is the code (`"FIRE"`, `"my-mod:sludge"`), never the numeric PROJ
 * value, because a mod's projection is appended at a slot core never compiled
 * in - `projectionCodeFor` resolves the number through the bound projection
 * table first, and a numeric key would look in the wrong place.
 */
export class ProjectionHandlerTable<H> {
  private readonly handlers: Map<string, H>;

  constructor(core: ReadonlyMap<string, H>) {
    this.handlers = new Map(core);
  }

  /** Install (or replace) the handler for one projection code. */
  set(code: string, handler: H): void {
    this.handlers.set(code, handler);
  }

  /**
   * The handler currently installed for a code, or null. This is the wrap
   * seam: take what is there, install one that calls through to it. What comes
   * back is core's handler until some mod has replaced it, and that mod's
   * afterwards - the caller neither knows nor needs to.
   */
  handlerFor(code: string): H | null {
    return this.handlers.get(code) ?? null;
  }

  /** Whether anything answers for this code. */
  has(code: string): boolean {
    return this.handlers.has(code);
  }

  /** Every code with a handler, in insertion order (core's first). */
  codes(): readonly string[] {
    return [...this.handlers.keys()];
  }

  /**
   * The LIVE table the engine dispatches through. Held by identity from
   * wireGame onward, so a `set` after the game is wired is seen by the next
   * projection - which is the only time a mod's `register` can run.
   */
  get table(): ReadonlyMap<string, H> {
    return this.handlers;
  }
}

/**
 * The three projection tables a mod can reach, seeded with core's 69 handlers.
 * Built per game in `wireGame` and published on `GameState.projectionHandlers`.
 */
export class ProjectionHandlerRegistry {
  /** project_f: what a projection does to TERRAIN. */
  readonly feat = new ProjectionHandlerTable<ProjectFeatHandler>(
    PROJECT_FEAT_HANDLERS,
  );
  /** project_o: what a projection does to OBJECTS on the floor. */
  readonly obj = new ProjectionHandlerTable<ProjectObjHandler>(
    PROJECT_OBJ_HANDLERS,
  );
  /** project_p: what a projection does to the PLAYER. */
  readonly player = new ProjectionHandlerTable<PlayerSideHandler>(
    PLAYER_SIDE_HANDLERS,
  );
}
