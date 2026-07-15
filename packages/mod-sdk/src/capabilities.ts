/**
 * Capability model for scripted plugins (MOD_LIFECYCLE.md section 4, P7
 * phase 5).
 *
 * Only `shape: plugin` packs may request capabilities; content and tile
 * packs are validated data that cannot execute, so they request none
 * (docs/MODS.md trust tiers). A plugin's `capabilities` list in its
 * manifest is the consent surface: the installer shows each one in plain
 * language, the user approves, and the runtime grants exactly that set -
 * nothing a plugin did not ask for and the user did not see. The
 * perceive/act facades (a later P7 phase) call `CapabilitySet.check()`
 * before honoring a request; an ungranted capability throws a clear
 * author-facing error rather than silently doing nothing or diverging.
 *
 * Vocabulary (four forms, MOD_LIFECYCLE section 4 / the frost example in
 * section 2):
 *  - "command:add"          - register commands on the act facade.
 *  - "event:<name>"         - subscribe to an engine event, e.g.
 *                             "event:turn-start".
 *  - "state:<domain>.read"  - read one perceive-facade domain, e.g.
 *                             "state:party.read"; or the wildcard
 *                             "state:*.read" for any domain.
 *  - "network:<host>"       - outbound network to one host; or "network:*"
 *                             for any host. Not in the section-4 examples
 *                             verbatim, but named there ("network access to
 *                             api.example.com"); "*" is this module's
 *                             extension for a plugin that genuinely needs
 *                             unrestricted egress, and reads the same way
 *                             the other wildcards do.
 *  - "registry:<domain>"    - override a game SYSTEM registry from a TRUSTED
 *                             in-process plugin (W2.2, core/mod/registry-host.ts):
 *                             "registry:effect" | "registry:room" |
 *                             "registry:command" | "registry:monster"; or the
 *                             wildcard "registry:*" for all four. Distinct from
 *                             "command:add": that adds a command via the act
 *                             facade, this replaces what a command DOES (and the
 *                             effect/room/AI logic behind the game).
 *
 * This module only surfaces `nondeterministic` from the manifest. The
 * save's determinism ratchet itself - flipping a save from DETERMINISTIC to
 * NONDETERMINISTIC the first time such a mod is enabled, once and
 * irreversibly - lives in core/save (decisions 4/18/22), not here.
 */

import type { PackManifest } from "./manifest.js";

export class CapabilityError extends Error {}

/** A capability string parsed into its structured form. */
export type ParsedCapability =
  | { kind: "command"; action: "add" }
  | { kind: "event"; name: string }
  | { kind: "state"; domain: string; access: "read" }
  | { kind: "network"; host: string }
  | { kind: "registry"; domain: string };

const EVENT_RE = /^event:([a-z][a-z0-9-]*)$/;
const STATE_RE = /^state:(\*|[a-z][a-z0-9-]*)\.read$/;
const NETWORK_RE = /^network:(\*|[a-zA-Z0-9.-]+)$/;
/** The four override domains ModRegistryHost gates, plus the "*" wildcard. */
const REGISTRY_RE = /^registry:(\*|effect|room|command|monster)$/;

/**
 * Parse and validate a capability string against the vocabulary above,
 * returning its structured form. Throws CapabilityError on anything
 * malformed or outside the recognized patterns - an unknown capability is
 * a hard error, not a silent no-op, since a typo'd request should fail
 * loudly at install rather than quietly never matching a grant.
 */
export function parseCapability(cap: string): ParsedCapability {
  if (cap === "command:add") {
    return { kind: "command", action: "add" };
  }
  const event = EVENT_RE.exec(cap);
  if (event) {
    return { kind: "event", name: event[1] as string };
  }
  const state = STATE_RE.exec(cap);
  if (state) {
    return { kind: "state", domain: state[1] as string, access: "read" };
  }
  const network = NETWORK_RE.exec(cap);
  if (network) {
    return { kind: "network", host: network[1] as string };
  }
  const registry = REGISTRY_RE.exec(cap);
  if (registry) {
    return { kind: "registry", domain: registry[1] as string };
  }
  throw new CapabilityError(`unrecognized capability: "${cap}"`);
}

/**
 * True if `grant` covers `request`. Exact match for command/event, plus the
 * two documented wildcards: a "state:*.read" grant covers a read of any
 * domain, and a "network:*" grant covers egress to any host.
 */
function grantCovers(grant: ParsedCapability, request: ParsedCapability): boolean {
  switch (request.kind) {
    case "command":
      return grant.kind === "command";
    case "event":
      return grant.kind === "event" && grant.name === request.name;
    case "state":
      return (
        grant.kind === "state" &&
        grant.access === request.access &&
        (grant.domain === "*" || grant.domain === request.domain)
      );
    case "network":
      return (
        grant.kind === "network" &&
        (grant.host === "*" || grant.host === request.host)
      );
    case "registry":
      return (
        grant.kind === "registry" &&
        (grant.domain === "*" || grant.domain === request.domain)
      );
  }
}

/**
 * The capabilities a plugin was granted, built from its manifest. Facades
 * hold one of these per loaded plugin and call `check()` before honoring
 * any request that touches commands, events, state reads, or the network.
 */
export class CapabilitySet {
  private readonly grants: readonly ParsedCapability[];
  private readonly nondeterministic: boolean;

  private constructor(grants: readonly ParsedCapability[], nondeterministic: boolean) {
    this.grants = grants;
    this.nondeterministic = nondeterministic;
  }

  /**
   * Build a CapabilitySet from a pack manifest. Only `shape: plugin` packs
   * may request capabilities (MOD_LIFECYCLE section 4): a content or tile
   * pack with a non-empty `capabilities` list throws CapabilityError, since
   * that shape cannot execute and so has nothing to grant capabilities to -
   * the request signals author confusion or an upstream validation bug,
   * not something to silently ignore.
   */
  static fromManifest(manifest: PackManifest): CapabilitySet {
    const requested = manifest.capabilities ?? [];
    if (manifest.shape !== "plugin" && requested.length > 0) {
      throw new CapabilityError(
        `pack ${manifest.id}: only shape "plugin" packs may request capabilities ` +
          `(this pack is shape "${manifest.shape}")`,
      );
    }
    const grants = requested.map((cap) => parseCapability(cap));
    return new CapabilitySet(grants, manifest.nondeterministic ?? false);
  }

  /**
   * True if `cap` is covered by a grant in this set, honoring the
   * "state:*.read" and "network:*" wildcards. Throws CapabilityError if
   * `cap` itself is not a recognized capability string.
   */
  has(cap: string): boolean {
    const request = parseCapability(cap);
    return this.grants.some((grant) => grantCovers(grant, request));
  }

  /**
   * Throws CapabilityError, naming the missing capability and how to fix
   * it, unless `cap` is granted. This is the guard the perceive/act facades
   * call before honoring a plugin's request - an author-facing error, not
   * a silent divergence.
   */
  check(cap: string): void {
    if (this.has(cap)) return;
    throw new CapabilityError(
      `this plugin needs capability "${cap}"; add it to pack.json capabilities`,
    );
  }

  /** True if the manifest declared `nondeterministic: true` (section 4). */
  isNondeterministic(): boolean {
    return this.nondeterministic;
  }
}
