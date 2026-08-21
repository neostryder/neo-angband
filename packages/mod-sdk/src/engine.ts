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
 *
 * AND A FAILED RANGE IS NOT ALWAYS A REFUSAL (2026-08-02). Ratified decision 18
 * is that the engine LABELS and does not FORBID, and this gate was applying it
 * backwards: an out-of-range `engine` refused to load a pack of JSON that would
 * have composed perfectly well. Nothing in a data pack's manifest can make its
 * data unloadable - the worst case is a patch aimed at a record that has since
 * moved, and composePacks now reports that one op and keeps the rest.
 *
 * So the range is a GATE on a pack that ships code and a LABEL on one that does
 * not, and `modApi` is the signal, because the manifest already requires it of
 * exactly the packs that ship a plugin.js. Code is the thing that genuinely
 * breaks across an engine release: it calls functions, and a function that has
 * been renamed is a crash rather than a warning. This is the difference between
 * an engine patch that costs every content author a release and one that costs
 * them nothing, which is the whole reason the distinction is here.
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
      /**
       * Whether this is a REFUSAL or a warning to show beside a pack that loads
       * anyway. True exactly when the pack ships code (`modApi` is declared).
       *
       * Separate from `ok` rather than folded into it, because a caller that
       * only wants to know "did the versions line up" and a caller deciding "do I
       * load this" are asking different questions, and collapsing them is how the
       * warning would end up either suppressed or treated as fatal. `ok: false,
       * blocks: false` is a real and common state: the pack loads, and the player
       * is told why it might misbehave.
       */
      readonly blocks: boolean;
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
/**
 * Whether a NEWER game could satisfy this range, when the current one does not.
 *
 * WHY THIS IS NOT PART OF THE VERDICT. `engineVerdict` deliberately refuses to say
 * which side is behind, because a range does not give that away: `>=0.24.0` wants a
 * newer game and `<0.5.0` wants an older one, and a confident "update the game"
 * would be wrong half the time on the one line a player acts on. That restraint is
 * right for the verdict, which has to be correct for every range. But a screen that
 * has decided to OFFER an older version of a mod does need to know whether updating
 * the game is the thing that would unlock the newer one, or whether it would make
 * matters worse - so the question gets asked separately, and answered by probing
 * rather than by reasoning about a range this matcher cannot decompose.
 *
 * A BOUNDED PROBE, NOT AN INTERVAL SOLVER, and the bound is the honest part. It
 * tries the next nine patches, the next nine minors and the next nine majors above
 * the running version, plus one far-future version for an open upper bound. `true`
 * means one of those satisfies the range, so a game update really can get there.
 * `false` means none of them does, which is not a proof that none ever could - so
 * the caller must fall back to naming both versions and claiming nothing, exactly
 * as the verdict does. `null` is a range this build cannot read at all.
 */
export function newerGameCouldRun(range: string, engineVersion: string): boolean | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(engineVersion);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  const ladder: string[] = [];
  for (let i = 1; i <= 9; i++) ladder.push(`${String(major)}.${String(minor)}.${String(patch + i)}`);
  for (let i = 1; i <= 9; i++) ladder.push(`${String(major)}.${String(minor + i)}.0`);
  for (let i = 1; i <= 9; i++) ladder.push(`${String(major + i)}.0.0`);
  ladder.push("9999.0.0");
  for (const candidate of ladder) {
    try {
      if (satisfies(candidate, range)) return true;
    } catch {
      /* An unreadable range is unreadable for every candidate, so one throw settles
       * it. Reported as "cannot tell" rather than "no", because the manifest being
       * broken is a different fact from the game being the wrong version, and the
       * caller says different words for each. */
      return null;
    }
  }
  return false;
}

export function engineVerdict(
  manifest: Pick<PackManifest, "engine" | "modApi">,
  engineVersion: string,
  /**
   * Whether this pack ships CODE, and therefore whether a mismatch is a gate or
   * a label. Defaults to what the manifest says, and is overridable for the one
   * caller that knows better: the plugin loader is holding a plugin.js it can
   * see, and it runs this gate BEFORE it checks whether `modApi` was declared at
   * all - so a code pack that forgot the field must not buy the lenient path
   * with the omission.
   */
  hasCode: boolean = manifest.modApi !== undefined,
): EngineVerdict {
  const range = manifest.engine;
  if (range === undefined) return OK;

  /* CODE, not "is this a first-party pack" and not "did the author ask to be
   * strict". `modApi` is required of every pack shipping plugin.js and
   * meaningless on one that does not, so it already partitions the packs along
   * exactly the line that matters, and it cannot be set to buy leniency:
   * declaring it is declaring code, which is the stricter side. */
  const blocks = hasCode;

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
      blocks,
      why:
        `declares "engine": ${JSON.stringify(range)}, which is not a version range ` +
        `this game can read (${message(e)}) - the manifest needs fixing` +
        (blocks ? "" : ", though its data loads anyway"),
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
  /* Two sentences, because the two audiences can do two different things. A code
   * pack's player is being told why it is NOT loading; a data pack's player is
   * being told what to suspect if something looks wrong, and is not being asked
   * to act at all. Telling the second group "one of them needs an update" would
   * send them looking for a release that may never come, for a mod that is
   * probably working fine. */
  return {
    ok: false,
    kind: "out-of-range",
    blocks,
    why: blocks
      ? `was written for engine ${range}, and this game is ${engineVersion} - ` +
        `the two do not line up, so one of them needs an update before its code can run`
      : `was written for engine ${range} and this game is ${engineVersion}, so it is ` +
        `running outside what its author tested - its data is loaded, and anything ` +
        `it could not apply is listed on its own row`,
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
