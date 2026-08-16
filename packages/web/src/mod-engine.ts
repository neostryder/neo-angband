/**
 * ONE engine gate, for every path a mod can take into the game.
 *
 * mod-sdk's `engineVerdict` is the rule; this is the single place that binds it to
 * THIS build's version and turns a verdict into the shared ModProblem channel. It
 * exists as its own module for two reasons that are not style:
 *
 *   1. THREE PATHS, NOT ONE. A mod reaches the game as content (pack.ts
 *      activePackSetFrom -> composeContentPacks), as code (mod-code.ts loadModCode
 *      -> import plugin.js), or as tiles (tile-mods.ts enabledTileModes). Before
 *      this, the only version gate in the host - `modApi` - lived inside the CODE
 *      loader, so it covered plugin.js and nothing else: a content pack or a tile
 *      pack could declare anything it liked and there was no gate for it to fail.
 *      A compatibility rule that only one of three doors checks is not a rule.
 *   2. NO CYCLE. pack.ts imports mod-code.ts, so mod-code.ts cannot import pack.ts.
 *      A gate the two of them shared had to live below both.
 *
 * ENGINE_VERSION is defaulted rather than passed, so no caller can gate against a
 * different build than its neighbour, and overridable, so a test can drive one.
 */

import { ENGINE_VERSION } from "@rpgm-tools/neo-angband-core";
import { engineVerdict } from "@rpgm-tools/neo-angband-mod-sdk";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModProblem } from "./mod-problems";

/** The manifest fields the gate reads; anything shaped like this can be judged. */
export type GateableManifest = Pick<PackManifest, "id"> & {
  readonly engine?: string;
  /** Declared by exactly the packs that ship a plugin.js, and the reason the
   * gate is a gate for them and a label for everyone else. */
  readonly modApi?: number;
};

/**
 * What this build has to say about the pack's engine range, or null if it has
 * nothing to say.
 *
 * Returns the PROBLEM rather than a boolean, because a refusal that is not reported
 * is the failure this whole area was in: computed, correct, and invisible. A caller
 * that only wants the yes/no reads `engineAllows`, and one that reports gets the
 * sentence for free with no second copy of the wording.
 *
 * NOT EVERY PROBLEM IS A REFUSAL. A pack with no code that declares a range this
 * build sits outside still loads, and still gets a line - so a caller that treated
 * "a problem exists" as "skip it" would be reinstating the old behaviour without
 * noticing. That is why `engineAllows` reads `blocks` and not `!== null`, and why
 * this function is no longer called `engineRefusal`.
 */
export function engineProblem(
  manifest: GateableManifest,
  engineVersion: string = ENGINE_VERSION,
): ModProblem | null {
  const verdict = engineVerdict(manifest, engineVersion);
  if (verdict.ok) return null;
  return { id: manifest.id, why: verdict.why };
}

/** Shorthand for the paths that only need to know whether to skip the pack. */
export function engineAllows(
  manifest: GateableManifest,
  engineVersion: string = ENGINE_VERSION,
): boolean {
  const verdict = engineVerdict(manifest, engineVersion);
  return verdict.ok || !verdict.blocks;
}

/**
 * The gate for the PLUGIN loader, which is holding a plugin.js it can see.
 *
 * Its own `modApi` check runs after this one, so a code pack that omitted the
 * field would otherwise reach `engineProblem` looking like data and be waved
 * through on a range it does not satisfy. Being able to see the file beats
 * inferring from the manifest, so this caller says so instead of guessing.
 */
export function engineBlocksCode(
  manifest: GateableManifest,
  engineVersion: string = ENGINE_VERSION,
): ModProblem | null {
  const verdict = engineVerdict(manifest, engineVersion, true);
  if (verdict.ok) return null;
  return { id: manifest.id, why: verdict.why };
}
