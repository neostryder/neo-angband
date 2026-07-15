/**
 * Plain-language descriptions of mod capabilities, for the W2.4 consent prompt.
 *
 * A manifest's `capabilities` are terse machine strings (capabilities.ts
 * vocabulary: command:add, event:<name>, state:<domain>.read, network:<host>,
 * registry:<domain>). Before a user enables a plugin the manager must show, in
 * human terms, exactly what it is being allowed to do - and flag the powerful
 * ones (in-process system override, network egress, broad state reads) so
 * consent is informed. This module is the single source of that mapping; it is
 * pure so it can be unit-tested and reused by any host (web or Electron).
 */

import { parseCapability } from "@neo-angband/mod-sdk";

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

/** Describe one registry:<domain> override grant. */
function describeRegistry(domain: string): { text: string; elevated: boolean } {
  switch (domain) {
    case "*":
      return {
        text: "Override ANY game system - effects, level generation, commands, monster AI, and vocabulary (full trusted, in-process access)",
        elevated: true,
      };
    case "effect":
      return { text: "Override effect, combat, and magic logic", elevated: true };
    case "room":
      return { text: "Override dungeon / level generation", elevated: true };
    case "command":
      return { text: "Change what player commands do (and add commands)", elevated: true };
    case "monster":
      return { text: "Override monster AI (take over monster turns)", elevated: true };
    case "vocab":
      return {
        text: "Add new vocabulary - flags, stats, and other terms",
        elevated: false,
      };
    default:
      return { text: `Override the "${domain}" game system`, elevated: true };
  }
}

/**
 * Describe a single capability string. Never throws: an unrecognized string is
 * itself reported (as elevated) so a malformed manifest cannot hide a grant.
 */
export function describeCapability(cap: string): CapabilityDescription {
  let parsed;
  try {
    parsed = parseCapability(cap);
  } catch {
    return {
      cap,
      text: `Unrecognized capability "${cap}" (treated as high-risk)`,
      elevated: true,
    };
  }
  switch (parsed.kind) {
    case "command":
      return { cap, text: "Add new player commands", elevated: false };
    case "event":
      return { cap, text: `Observe the "${parsed.name}" game event`, elevated: false };
    case "state":
      return parsed.domain === "*"
        ? { cap, text: "Read ALL game state", elevated: true }
        : { cap, text: `Read ${parsed.domain} game state`, elevated: false };
    case "network":
      return parsed.host === "*"
        ? {
            cap,
            text: "Send network requests to ANY host (your data could leave this device)",
            elevated: true,
          }
        : {
            cap,
            text: `Send network requests to ${parsed.host}`,
            elevated: true,
          };
    case "registry": {
      const r = describeRegistry(parsed.domain);
      return { cap, text: r.text, elevated: r.elevated };
    }
  }
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
