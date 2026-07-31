/**
 * The ENGINE gate: may a pack load on this build of the game?
 *
 * A manifest's `engine` is a semver RANGE over the engine's version
 * (core's ENGINE_VERSION), declared by the pack author to say which builds their
 * pack was written for. It has existed on PackManifest since the manifest was
 * written, every discovery path in the host carefully carries it through
 * normalisation - and until now NOTHING read it. `satisfies()` had exactly one
 * caller, resolve.ts, for mod-to-mod `dependencies`.
 *
 * A range nothing evaluates is worse than no field at all, because authors fill it
 * in and believe it. Two of the three first-party mods had drifted to
 * `"engine": "4.2.x"` - the ANGBAND baseline (PARITY_BASELINE), not the port's
 * version - and no test, no build and no boot could notice, because no code path
 * ever compared it to anything.
 *
 * SEPARATE FROM `modApi`, and deliberately so; manifest.ts documents why at the
 * field. The two answer different questions and must not be merged:
 *
 *   engine  a RANGE over the game's version, declared by any pack. "This content
 *           was written for these builds." A patch release moves the game's
 *           version and not the plugin ABI, so a range is the right shape.
 *   modApi  an exact INTEGER, required of a pack shipping plugin.js, matched
 *           exactly, because the ABI is unstable before 1.0 and a range would
 *           promise a compatibility that does not exist.
 *
 * A pack can fail either, both, or neither, and the reasons a player must read are
 * different in each case - so this returns a discriminated verdict rather than a
 * boolean, and the caller keeps them apart.
 */

import type { PackManifest } from "./manifest.js";
import { satisfies } from "./semver.js";

/**
 * Why a pack may not load here - or that it may.
 *
 * `kind` rather than only prose, because the two failures have different AUDIENCES
 * and a caller may want to route them differently: `out-of-range` is a message for
 * the PLAYER (nothing is broken; the versions do not line up), and `bad-manifest`
 * is a message for the pack's AUTHOR (the manifest does not say anything
 * evaluable). Asserting on `kind` also keeps the tests off the wording.
 */
export type EngineVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: "out-of-range" | "bad-manifest";
      readonly why: string;
    };

const OK: EngineVerdict = { ok: true };

/**
 * Does `engineVersion` satisfy the pack's declared `engine` range?
 *
 * An ABSENT range is allowed, and that is not laxity: `engine` is optional on
 * PackManifest, most packs are pure data that no engine release breaks, and a pack
 * that declines to guess at future compatibility is making a reasonable choice. An
 * EMPTY OR MALFORMED range is not the same thing - the author meant to say
 * something and said something unreadable - so it is refused as an author error
 * rather than quietly treated as absent.
 *
 * Pure, and takes the version as an argument rather than importing it, so a test
 * can drive any build and so mod-sdk stays independent of core.
 */
export function engineVerdict(
  manifest: Pick<PackManifest, "engine">,
  engineVersion: string,
): EngineVerdict {
  const range = manifest.engine;
  if (range === undefined) return OK;

  let matched: boolean;
  try {
    matched = satisfies(engineVersion, range);
  } catch (e) {
    /* satisfies() throws SemverError for an empty range and for any token it cannot
     * parse. It also throws if `engineVersion` itself is unparseable, which would be
     * the GAME's fault and not the pack's - but that is a build-time impossibility
     * (core's ENGINE_VERSION is a literal) and pretending to distinguish it here
     * would mean claiming to know which of the two strings was wrong. The range is
     * the one an author can fix, and the message quotes it so they can see it. */
    return {
      ok: false,
      kind: "bad-manifest",
      why:
        `declares "engine": ${JSON.stringify(range)}, which is not a version range ` +
        `this game can read (${message(e)}) - the manifest needs fixing`,
    };
  }
  if (matched) return OK;

  /* BOTH versions, and no claim about which side is behind. The modApi gate above it
   * does say which way round, and it can: it compares two integers and the larger one
   * is the newer. A RANGE does not give that for free - a mod wanting `^0.20.0` on a
   * 0.10.0 build needs a newer GAME, one wanting `<0.5.0` needs a newer MOD, and
   * telling them apart means computing the range's bounds, which this matcher does not
   * expose. Naming the pair says everything true and nothing invented; a confident
   * "the mod needs updating" would be wrong half the time, on the one line the player
   * acts on. */
  return {
    ok: false,
    kind: "out-of-range",
    why:
      `was written for engine ${range}, and this game is ${engineVersion} - ` +
      `the two do not line up, so one of them needs an update before it can load`,
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
