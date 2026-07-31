/**
 * The behaviour seam: the closed set of points where a mod may change what the
 * ENGINE does, as opposed to what content it runs on.
 *
 * WHY THIS EXISTS
 *
 * Content mods are already fully expressible - a pack contributes records and
 * composeContentPacks merges them, and core never learns a mod was involved.
 * Behaviour is different. A fix like "don't log a duplicate unique kill" is not a
 * record; it is a decision taken inside a function, and no amount of data can
 * reach inside that function from outside. So the first cut of the bundled
 * bug-fixes / QoL mods did the only thing that was available: the FIX LIVED IN
 * CORE behind `if (modRuleEnabled(state, "bugfix.x"))`.
 *
 * That was wrong, and neostryder named exactly why (2026-07-29): "the whole point of
 * making them mods was to exclude them from the core game." A flag-gated fix is
 * not excluded from core. It ships in core, it is tested in core, and core
 * carries the string "bugfix.uniqueKillHistory" - so core knows the mod's name.
 * Deleting the mod folder would not delete one line of it.
 *
 * WHAT THIS CHANGES, AND WHAT IT HONESTLY DOES NOT
 *
 * After this, core contains no mod's fix and no mod's name: no `bugfix.*` or
 * `qol.*` literal, no staircase repair, no message rewriter. Each fix body lives
 * in its mod's own folder and arrives as that mod's code.
 *
 * What core still contains - and cannot stop containing - is the SEAM ITSELF:
 * one named, documented extension point per behaviour a mod may override. That
 * is not a residue of the bundled mods; it is the price of behaviour modding at
 * all, and it is the same bargain SKSE, Forge and every other real modding
 * system strikes. The difference from a flag read is the difference that matters:
 * a seam is generic and available to ANY mod, and it holds no opinion about what
 * should plug into it, whereas `if (modRuleEnabled(state, "bugfix.stairsReachable"))`
 * is core implementing one specific mod.
 *
 * SHAPE
 *
 * A plain interface of optional functions rather than a string-keyed registry,
 * for three reasons:
 *
 *  - It is typed end to end. A registry keyed by strings pushes every payload
 *    through `unknown` and moves the errors to runtime.
 *  - "A disabled mod's patches DO NOT EXIST" becomes literally true, not merely
 *    false-y: with no mod loaded the field is ABSENT, the optional call is not
 *    made, and the faithful path is the only path that was ever compiled into
 *    the branch. No flag map is consulted because there is no flag map.
 *  - It costs nothing. `state.modHooks?.historyAdd?.(...)` on an absent object is
 *    one undefined check, not a map lookup per call.
 *
 * COMPOSITION IS THE HOST'S JOB
 *
 * Two enabled mods may both want the same hook. Core deliberately holds ONE
 * ModHooks and knows nothing about mod identity, ordering or enablement - the
 * host (web/cli) collects each enabled mod's contributions in load order and
 * folds them into a single object (see composeModHooks). This is the same
 * layering as content: core consumes a composed result and never the pack list.
 *
 * DETERMINISM
 *
 * Two of these run inside the generation and object pipelines, where an extra
 * RNG draw does not merely change a value, it desynchronises every draw after
 * it - so a seed would stop meaning the same level. Those hooks are documented
 * RNG-FREE and are given no rng to draw from. That is a contract a mod can still
 * break by reaching for a global; the test suite pins it by running generation
 * with a hook installed and asserting the level is bit-identical.
 */

import type { GameState } from "../game/context.js";

/**
 * A mod's behaviour contributions. Every member is optional; an absent member
 * means "this mod does not touch that point" and core takes its faithful path.
 *
 * Each entry documents the ONE core call site it serves, because a hook whose
 * call site is not written down is a hook nobody can verify is still wired -
 * exactly the failure the call-site census exists to catch.
 */
export interface ModHooks {
  /**
   * A walk into a grid the player could tunnel through (cave-cmd.ts,
   * movementAutoDig's call site).
   *
   * Return the energy the move should cost, or null to decline - and declining
   * MUST be free of observable effect, because faithful core's behaviour here is
   * to bump into the wall without drawing any RNG. A hook that rolls a dig check
   * and then returns null has already moved the RNG stream.
   *
   * `deps` is the live CaveCmdDeps the session built, passed through because the
   * work a mod would want to do here (tunnelAux - one real dig attempt with the
   * upstream roll and payouts) needs dependencies only the session can construct.
   * Typed as unknown so this seam does not drag the cave-command types into every
   * consumer of ModHooks; a mod casts it back to CaveCmdDeps, which core exports.
   *
   * Serves: the QoL mod's "auto-dig on walk".
   */
  walkBlockedByDiggable?: (
    state: GameState,
    grid: { y: number; x: number },
    deps: unknown,
  ) => number | null;

  /**
   * Two floor-list entries that compared exactly equal, including on distance
   * (obj-list.ts, the comparator's final tiebreak).
   *
   * Return a negative/positive number to order them, or 0 to leave them equal
   * (which is what faithful core does - it keeps collect order via a stable
   * sort). Must be a consistent total order or the sort is meaningless.
   *
   * Serves: the bug-fixes mod's strict object-list ordering (#4664).
   */
  objectListTiebreak?: (
    a: { readonly dy: number; readonly dx: number },
    b: { readonly dy: number; readonly dx: number },
  ) => number;

  /**
   * A finished, otherwise-accepted level, before cave_generate returns it
   * (generate.ts, the accept branch).
   *
   * Return false to REJECT the level, which makes cave_generate re-roll exactly
   * as it does for a monster-maximum overflow. May mutate the level to repair it
   * and then return true.
   *
   * RNG-FREE: no rng is passed and none may be reached. A draw here shifts every
   * subsequent draw and a seed stops reproducing its dungeon.
   *
   * Serves: the bug-fixes mod's reachable-staircase repair.
   */
  levelGenerated?: (gen: unknown, quest: boolean) => boolean;

  /**
   * An object about to be committed as an artifact, when it ALREADY carries one
   * (obj/make.ts, the `obj.artifact` branch).
   *
   * Return false to refuse the commit; the caller then clears the artifact and
   * reports failure. Faithful core commits it unconditionally.
   *
   * RNG-FREE, for the same reason as levelGenerated: this runs inside object
   * creation, on the main stream.
   *
   * Serves: the bug-fixes mod's duplicate-artifact guard (#4510).
   */
  artifactCommit?: (aidx: number, alreadyCreated: boolean) => boolean;

  /**
   * A character-history entry about to be written (session/game.ts and any
   * other historyAdd call site that passes its context).
   *
   * Return false to suppress the entry. Faithful core writes every entry it
   * reaches, duplicates included.
   *
   * Serves: the bug-fixes mod's no-duplicate-unique-kill fix (#4245).
   */
  historyAdd?: (entry: { readonly what: string; readonly type: number; readonly duplicate: boolean }) => boolean;

  /**
   * Whether the noise and scent heatmaps belong in the save (session/save.ts,
   * snapshotSquares' argument).
   *
   * Return true to persist them. Faithful core omits them, which is the upstream
   * behaviour and the upstream bug.
   *
   * Serves: the bug-fixes mod's noise/scent persistence (#4605).
   */
  saveNoiseScent?: () => boolean;

  /**
   * Player-visible message text, on its way to the message line (the host's
   * message sink).
   *
   * Return the text to show. Faithful core shows what it was given, warts and
   * all. A hook here can only RESTATE a message - it must never change what a
   * message means, or the port would be showing text upstream never wrote and no
   * census could see it.
   *
   * Serves: the bug-fixes mod's cosmetic string corrections.
   */
  messageText?: (raw: string) => string;
}

/**
 * Fold several mods' contributions into the single ModHooks core holds.
 *
 * Order is LOAD order, and what "later wins" means differs per hook because the
 * hooks differ in kind - which is precisely why this is one written-down function
 * and not a generic merge:
 *
 *  - VETO hooks (levelGenerated, artifactCommit, historyAdd) are conjunctive:
 *    every contributor must agree, and the first refusal decides. This is the
 *    only safe fold - a mod that vetoes a duplicate artifact must not be
 *    overruled by a later mod that merely has no opinion.
 *  - TRANSFORM hooks (messageText) compose in order, each seeing the previous
 *    one's output.
 *  - FIRST-HANDLER hooks (walkBlockedByDiggable) stop at the first non-null, so
 *    an earlier mod's handling wins and a later one cannot double-spend energy.
 *  - ANY hooks (saveNoiseScent) are disjunctive: one mod asking for the data is
 *    enough, because the data is additive and a second mod cannot object.
 *  - ORDERING hooks (objectListTiebreak) stop at the first non-zero answer, the
 *    same way a lexicographic comparator chains.
 *
 * Returns undefined when nothing contributed, so the caller can leave the field
 * absent rather than storing an empty object - keeping "no mod loaded" and "a
 * mod loaded that touches nothing" indistinguishable from core's side.
 */
export function composeModHooks(
  contributions: readonly ModHooks[],
): ModHooks | undefined {
  const list = contributions.filter((c) => Object.keys(c).length > 0);
  if (list.length === 0) return undefined;

  const out: ModHooks = {};

  const walk = list.map((c) => c.walkBlockedByDiggable).filter(isFn);
  if (walk.length > 0) {
    out.walkBlockedByDiggable = (state, grid, deps): number | null => {
      for (const fn of walk) {
        const energy = fn(state, grid, deps);
        if (energy !== null) return energy;
      }
      return null;
    };
  }

  const tiebreak = list.map((c) => c.objectListTiebreak).filter(isFn);
  if (tiebreak.length > 0) {
    out.objectListTiebreak = (a, b): number => {
      for (const fn of tiebreak) {
        const r = fn(a, b);
        if (r !== 0) return r;
      }
      return 0;
    };
  }

  const level = list.map((c) => c.levelGenerated).filter(isFn);
  if (level.length > 0) {
    out.levelGenerated = (gen, quest): boolean => {
      /* Every contributor runs even after one has repaired the level, because a
       * second mod's invariant is not satisfied by the first mod's repair. The
       * first REFUSAL short-circuits, since the level is being thrown away. */
      for (const fn of level) if (!fn(gen, quest)) return false;
      return true;
    };
  }

  const artifact = list.map((c) => c.artifactCommit).filter(isFn);
  if (artifact.length > 0) {
    out.artifactCommit = (aidx, alreadyCreated): boolean => {
      for (const fn of artifact) if (!fn(aidx, alreadyCreated)) return false;
      return true;
    };
  }

  const history = list.map((c) => c.historyAdd).filter(isFn);
  if (history.length > 0) {
    out.historyAdd = (entry): boolean => {
      for (const fn of history) if (!fn(entry)) return false;
      return true;
    };
  }

  const noise = list.map((c) => c.saveNoiseScent).filter(isFn);
  if (noise.length > 0) {
    out.saveNoiseScent = (): boolean => noise.some((fn) => fn());
  }

  const text = list.map((c) => c.messageText).filter(isFn);
  if (text.length > 0) {
    out.messageText = (raw): string => text.reduce((s, fn) => fn(s), raw);
  }

  return out;
}

function isFn<T>(v: T | undefined): v is T {
  return typeof v === "function";
}
