/**
 * The `bug-fixes` mod's behaviour, as the mod's OWN code.
 *
 * Nothing in this file is compiled into core. Delete this folder and every fix
 * below goes with it - there is no `bugfix.*` string, no staircase repair, no
 * duplicate-artifact guard and no message rewriter anywhere in packages/core.
 * That is the whole point of the mod being a mod (Aaron, 2026-07-29: "the whole
 * point of making them mods was to exclude them from the core game").
 *
 * Each patch cites its upstream issue; docs/modding/BUG_FIXES.md carries the
 * long form (issue / PR / commit per entry).
 *
 * ------------------------------------------------------------------
 * ENTRY POINT CONTRACT - identical in every mod that changes behaviour
 * ------------------------------------------------------------------
 *
 *   export default function <mod>Hooks(
 *     flags: Readonly<Record<string, boolean>>,
 *   ): ModHooks;
 *
 * `flags` is the host's RESOLVED per-patch choice map: every `rules[].flag` this
 * mod declares in its manifest.json, mapped to the value the player's toggles
 * settled on (manifest `default` unless they changed it). The host calls this
 * ONCE per enabled mod, in load order, and folds the results with
 * composeModHooks (mod/hooks.ts) into the single ModHooks core holds.
 *
 * Three rules make this shape work:
 *
 *  1. THE MOD READS ITS OWN FLAGS. Core never sees a flag name. A hook is
 *     installed only if the patch that needs it is on, so a patch the player
 *     switched off is not merely inert - its hook is ABSENT, and core takes the
 *     faithful path with one undefined check.
 *  2. NEVER RETURN A FUNCTION THAT SELF-DISABLES. `historyAdd: (e) => flags.x ?
 *     !e.duplicate : true` would be wrong even though it behaves the same: an
 *     installed hook is a promise to core that something wants that point, and
 *     under composeModHooks a hook that is present but opinionless still runs
 *     (and, for the first-handler hooks, can shadow another mod's).
 *  3. A DISABLED MOD IS NEVER CALLED AT ALL. The host does not invoke this
 *     function for a mod the player has not enabled, so returning `{}` here
 *     means "enabled, but every patch off".
 *
 * The mod is a plain ES module importing @neo-angband/core's public API - the
 * same API a third-party mod has. It uses no private path and no test hook.
 */

import type { Gen, ModHooks } from "@neo-angband/core";
import { ensureStairsReachable } from "./stairs";
import { miscStringFix } from "./strings";

export default function bugFixesHooks(
  flags: Readonly<Record<string, boolean>>,
): ModHooks {
  const hooks: ModHooks = {};

  /*
   * #4245 "Killing a unique twice logs it twice". A unique reached again through
   * a shape-change or projection death path logs a second "Killed X" entry.
   * Faithful core logs every entry it reaches, duplicates included; core tells us
   * whether THIS entry is a duplicate and holds no opinion about it.
   */
  if (flags["bugfix.uniqueKillHistory"] === true) {
    hooks.historyAdd = (entry): boolean => !entry.duplicate;
  }

  /*
   * #4605 "Noise and scent are not saved". The heatmaps are transient upstream,
   * so monsters track the player differently after a save/reload than they would
   * have without one. Asking for them in the save is the whole fix - core does
   * the writing and the reading either way.
   */
  if (flags["bugfix.noiseScentSave"] === true) {
    hooks.saveNoiseScent = (): boolean => true;
  }

  /*
   * #4664 "Object list is not always correctly ordered". Upstream's compare_items
   * (obj-util.c) is not a strict weak order for qsort, so the list can come out
   * unstable. The port's comparator IS a lexicographic strict weak order feeding
   * a STABLE Array.sort, so ties keep collect order - but two distinct entries at
   * equal distance are still formally equivalent. This adds a deterministic
   * geometric total key (nearer-to-top first, then leftmost), making the order a
   * strict TOTAL order that holds even under a non-stable sort. PR #4668 was
   * closed unmerged, so there is no accepted upstream fix to port instead.
   *
   * Total order, so it is a legal comparator: antisymmetric by construction
   * (Math.sign of a difference) and transitive (lexicographic on dy then dx).
   */
  if (flags["bugfix.objectListOrder"] === true) {
    hooks.objectListTiebreak = (a, b): number =>
      Math.sign(a.dy - b.dy) || Math.sign(a.dx - b.dx);
  }

  /*
   * #4510 "Duplicate artifacts". The shared ArtifactState already makes
   * duplication impossible by construction for freshly-selected artifacts (the
   * selection loop skips any created one). This closes the remaining window: an
   * object handed to make_artifact that ALREADY carries an artifact skips that
   * scan, so committing it again would copy the artifact data and re-mark it
   * created a second time. Refusing makes ArtifactState the single source of
   * truth. Faithful 4.2.6 commits it.
   *
   * RNG-FREE, as the hook requires: a pure read of the created flag core passes
   * in. Core refuses BEFORE copy_artifact_data draws, so the veto changes the
   * outcome without half-drawing.
   */
  if (flags["bugfix.duplicateArtifact"] === true) {
    hooks.artifactCommit = (_aidx, alreadyCreated): boolean => !alreadyCreated;
  }

  /*
   * "Always a reachable up and down staircase" - upstream can seal a staircase
   * inside a vault it never tunnelled into (measured 10.2% of floors, usually the
   * up stair). See stairs.ts for the defect, the measurement, and why this is a
   * mod rather than a port fix.
   *
   * RNG-FREE, as the hook requires, which is what makes it safe to run on every
   * level: a floor that needed no repair is bit-identical to one generated with
   * no mod at all. Returning false rejects the level and cave_generate re-rolls.
   */
  if (flags["bugfix.stairsReachable"] === true) {
    hooks.levelGenerated = (gen, quest): boolean =>
      ensureStairsReachable(gen as Gen, quest);
  }

  /*
   * "Misc. string fixes": upstream's own cosmetic string warts, corrected at the
   * host's single message sink so every msg()/msgt() in core and the shell is
   * covered by one rule. Identity for anything not in the table (strings.ts), and
   * an exact-match table on purpose - messages arrive interpolated, so a general
   * rewrite would edit inscriptions and names the player typed.
   */
  if (flags["bugfix.miscStrings"] === true) {
    hooks.messageText = (raw): string => miscStringFix(raw);
  }

  return hooks;
}
