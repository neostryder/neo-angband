/**
 * Plain-language descriptions of mod capabilities, for the W2.4 consent prompt.
 *
 * A manifest's `capabilities` are terse machine strings. Before a user enables
 * a plugin the manager shows, in human terms, what the mod DECLARED it means to
 * do, and flags the powerful ones so consent is informed. The sentences and the
 * power flags live in the SDK's capability vocabulary
 * (mod-sdk/src/capability-vocabulary.ts), the same list the parser reads; this
 * module renders them for the web and Electron hosts.
 *
 * DECLARED, not bounded, and the wording here is careful about it. For a mod that
 * ships code these lines are what its author said it would touch, not a limit on
 * what its code can reach: an in-process plugin holds the engine namespace, so
 * the registries the `registry:*` facades guard are reachable around them (see
 * docs/modding/PLUGINS.md, "What a capability gates"). That is why the consent
 * screen carries a separate in-process warning for every mod that ships code
 * rather than deriving one from `elevated` (mods.ts, capabilityConsentScreen),
 * and why no consent sentence promises a mod CANNOT do something.
 */

import { consentText, matchCapability } from "@rpgm-tools/neo-angband-mod-sdk";

/** One capability rendered for consent: a human line plus a power flag. */
export interface CapabilityDescription {
  /** The raw capability string, verbatim. */
  cap: string;
  /** Plain-language statement of what enabling this grants. */
  text: string;
  /**
   * True for the powerful grants a user should weigh carefully: trusted
   * in-process system override (registry:*), network egress, and wildcard/broad
   * state reads. The UI highlights these.
   */
  elevated: boolean;
}

/**
 * Describe a single capability string from the SDK's capability vocabulary
 * (capability-vocabulary.ts), which holds every consent sentence. Never throws:
 * an unrecognized string is itself reported (as elevated) so a malformed
 * manifest cannot hide a grant.
 */
export function describeCapability(cap: string): CapabilityDescription {
  let match;
  try {
    match = matchCapability(cap);
  } catch {
    match = null;
  }
  if (match === null) {
    return {
      cap,
      text: `Unrecognized capability "${cap}" (treated as high-risk)`,
      elevated: true,
    };
  }
  return { cap, text: consentText(match), elevated: match.entry.powerful };
}

/** Describe every capability a manifest requests, in declaration order. */
export function describeCapabilities(
  caps: readonly string[],
): CapabilityDescription[] {
  return caps.map(describeCapability);
}

/** True when any requested capability is one of the powerful (elevated) grants. */
export function hasElevatedCapability(caps: readonly string[]): boolean {
  return caps.some((c) => describeCapability(c).elevated);
}

/**
 * What stops working when the player refuses `cap`, from the vocabulary. Null
 * for a string the vocabulary does not know.
 */
export function capabilityWithoutIt(cap: string): string | null {
  try {
    return matchCapability(cap)?.entry.withoutIt ?? null;
  } catch {
    return null;
  }
}
