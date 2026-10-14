/**
 * Capability model for scripted plugins (MOD_LIFECYCLE.md section 4, P7
 * phase 5).
 *
 * Only `shape: plugin` packs may request capabilities; content and tile
 * packs are validated data that cannot execute, so they request none
 * (docs/MODS.md trust tiers). A plugin's `capabilities` list in its
 * manifest is the consent surface: the installer shows each one in plain
 * language, the user approves, and the runtime opens exactly that set of
 * facades and no others (read the next paragraph for the scope of that
 * claim, which is narrower than it sounds). The
 * perceive/act facades (a later P7 phase) call `CapabilitySet.check()`
 * before honoring a request; an ungranted capability throws a clear
 * author-facing error rather than silently doing nothing or diverging.
 *
 * WHAT "GRANTS EXACTLY THAT SET" MEANS, AND WHAT IT DOES NOT. It is a
 * statement about the FACADES, and it holds: a facade whose capability
 * was not granted throws. It is not a statement about what in-process
 * code can reach. A trusted plugin also receives `ctx.core` (the live
 * engine namespace), `ctx.state` and `ctx.registries`, none of them
 * capability-checked, and those carry the same live registry objects the
 * `registry:*` facades write through - see docs/modding/PLUGINS.md,
 * "What a capability gates", and the measurement in
 * packages/web/src/capability-gate-reach.test.ts. So a capability list
 * is a DECLARATION the player reads and the conflict report is built
 * from, not a containment boundary; the boundary is the install consent.
 * A capability granted to the SANDBOXED Worker tier is a different
 * matter - that tier is isolated by construction and gets none of the
 * registries.
 *
 * THE VOCABULARY lives in capability-vocabulary.ts: every capability, its
 * argument schema, consent text, what stops without it, and the tiers that may
 * hold it. This module parses against that list and decides which grant covers
 * which request. Four rules shape `grantCovers`:
 *  - wildcards: "state:*.read", "registry:*", "network:*" and "ui:*.replace"
 *    each range over one argument and nothing else;
 *  - the action is compared wherever a kind has more than one, so one consent
 *    cannot buy a different act (#261): "mod:install" and "mod:session",
 *    "debug:spawn" and "debug:wizard", "ui:*.replace" and "ui:region.create";
 *  - a capability in the `truth` namespace ("state:map-actual.read") is covered
 *    only by a grant that names it, never by a wildcard;
 *  - "network:local" covers this computer and the private address ranges, on
 *    any port (see `isLocalNetworkHost`), and a host with no port covers the
 *    scheme's default port only.
 *
 * This module only surfaces `nondeterministic` from the manifest. The
 * save's determinism ratchet itself - flipping a save from DETERMINISTIC to
 * NONDETERMINISTIC the first time such a mod is enabled, once and
 * irreversibly - lives in core/save (decisions 4/18/22), not here.
 */

import { isTruthCapability, matchCapability, type ParsedCapability } from "./capability-vocabulary.js";
import { hasFacet, type PackManifest } from "./manifest.js";

export class CapabilityError extends Error {}

/** A capability string parsed into its structured form. */
export type { ParsedCapability };

/**
 * Parse and validate a capability string against the vocabulary
 * (capability-vocabulary.ts), returning its structured form. Throws
 * CapabilityError on anything outside it: an unknown capability is a hard
 * error, since a typo'd request should fail loudly at install rather than
 * quietly never matching a grant.
 */
export function parseCapability(cap: string): ParsedCapability {
  let match;
  try {
    match = matchCapability(cap);
  } catch (e) {
    throw new CapabilityError(`capability "${cap}": ${e instanceof Error ? e.message : String(e)}`);
  }
  if (match === null) throw new CapabilityError(`unrecognized capability: "${cap}"`);
  return match.parsed;
}

/**
 * True if `grant` covers `request`. Exact match for most kinds, the action
 * compared wherever a kind has more than one, and the four wildcards in the
 * header. A `truth` request is covered only by the same capability, never by a
 * wildcard: "state:*.read" does not reach the real map.
 */
function grantCovers(grant: ParsedCapability, request: ParsedCapability): boolean {
  if (isTruthCapability(request)) return JSON.stringify(grant) === JSON.stringify(request);
  switch (request.kind) {
    case "engine":
      return grant.kind === "engine";
    case "command":
      /* The action is compared: adding a command to the act facade and asking
       * the broker to run one are two grants. */
      return grant.kind === "command" && grant.action === request.action;
    case "input":
      return grant.kind === "input" && grant.action === request.action;
    case "input-prompt":
      return grant.kind === "input-prompt";
    case "saves":
      return grant.kind === "saves";
    case "title":
      return grant.kind === "title";
    case "profiles":
      return grant.kind === "profiles";
    case "session":
      return grant.kind === "session";
    case "screens":
      return grant.kind === "screens";
    case "prefs":
      return grant.kind === "prefs" && grant.action === request.action;
    case "store":
      return grant.kind === "store" && grant.action === request.action;
    case "asset":
      return grant.kind === "asset";
    case "ui-panel":
      return grant.kind === "ui-panel";
    case "shared":
      return grant.kind === "shared" && grant.action === request.action;
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
        (grant.host === "*" ||
          grant.host === request.host ||
          (grant.host === "local" && isLocalNetworkHost(splitHostPort(request.host).host)))
      );
    case "registry":
      return (
        grant.kind === "registry" &&
        (grant.domain === "*" || grant.domain === request.domain)
      );
    case "display":
      /* Exact match only. See parseCapability: `registry:*` does not reach
       * here, so a mod holding the override wildcard still cannot take the
       * display without asking for it by name. */
      return grant.kind === "display" && grant.action === request.action;
    case "backup":
      /* Exact match only, same reasoning as "display" - there is exactly one
       * backup capability and no wildcard grant could ever cover it. */
      return grant.kind === "backup";
    case "mod":
      /* THE ACTION IS COMPARED, not just the kind, and it is the #261 lesson
       * applied before it could be re-learned here: `mod:install` puts a pack in
       * the library switched off, `mod:session` switches one on for the rest of the
       * session. Neither is a superset of the other, there is no wildcard, and a
       * kind-only comparison would have let one consent buy both. */
      return grant.kind === "mod" && grant.action === request.action;
    case "mod-read":
      /* Exact match only, same reasoning as "backup" - there is exactly one
       * mod-read capability and no wildcard grant could ever cover it, and
       * neither "mod:install" nor "mod:session" reaches here: they are a
       * different `kind` entirely, not a wider action of the same one. */
      return grant.kind === "mod-read";
    case "debug":
      /* Exact match only, and here that is the point rather than a consequence:
       * this is the grant a player is most likely to check for by name, so it
       * must never be reachable through anything wider.
       *
       * THE ACTION IS COMPARED, and until "debug:wizard" landed it was not - which
       * was invisible while "spawn" was the only action, and would have been a real
       * hole the moment a second one existed: a player who agreed to a mod
       * conjuring one monster would have been granting it the depth jumps, the
       * experience and the acquirement too. Exactly the #261 lesson, caught by
       * adding the second action rather than by shipping it. */
      return grant.kind === "debug" && grant.action === request.action;
    case "keymap":
      return grant.kind === "keymap" && grant.action === request.action;
    case "options":
      return grant.kind === "options" && grant.action === request.action;
    case "query":
      return grant.kind === "query" && grant.action === request.action;
    case "policy":
      return grant.kind === "policy" && grant.action === request.action;
    case "hook":
      return grant.kind === "hook" && grant.action === request.action;
    case "registry-declaration":
      return grant.kind === "registry-declaration" && grant.action === request.action;
    case "ui-region":
      return grant.kind === "ui-region" && grant.action === request.action;
    case "ui":
      /* Per region, with one wildcard. A `display` grant is NOT accepted here
       * and a `ui` grant is not accepted above: owning the dungeon and owning
       * the vitals are two consents, and a mod that wants both says both.
       *
       * THE ACTION IS COMPARED TOO, and until #261 it was not - which was
       * invisible only because every ui capability was a `.replace`, so the
       * comparison would have been of a constant against itself. `ui:region
       * .create` broke that: the wildcard is a wildcard over WHICH REGION
       * changes hands, and reading it as a wildcard over what may be done to
       * the interface let `ui:*.replace` carry the right to put new furniture
       * on the player's screen. That is a grant the consent prompt never showed
       * and the player never approved, and it would have escalated silently -
       * there is no error, no report, and nothing on screen that says a region
       * was created by a mod that was only ever allowed to redraw one.
       *
       * `region` is still compared as well: with two actions the pair is what
       * identifies a grant, and dropping either half re-opens one of the two
       * directions. */
      return (
        grant.kind === "ui" &&
        grant.action === request.action &&
        (grant.region === "*" || grant.region === request.region)
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
  private readonly affectsGameplay: boolean;

  private constructor(
    grants: readonly ParsedCapability[],
    nondeterministic: boolean,
    affectsGameplay: boolean,
  ) {
    this.grants = grants;
    this.nondeterministic = nondeterministic;
    this.affectsGameplay = affectsGameplay;
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
    if (!hasFacet(manifest, "plugin") && requested.length > 0) {
      throw new CapabilityError(
        `pack ${manifest.id}: only shape "plugin" packs may request capabilities ` +
          `(this pack is shape "${manifest.shape}")`,
      );
    }
    const grants = requested.map((cap) => parseCapability(cap));
    return new CapabilitySet(
      grants,
      manifest.nondeterministic ?? false,
      manifest.affectsGameplay ?? false,
    );
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
      `this plugin needs capability "${cap}"; add it to manifest.json capabilities`,
    );
  }

  /**
   * The hosts this set's `network:` grants name, as written after the prefix:
   * `"api.example.com"`, `"localhost:8010"`, `"local"` or `"*"`. Empty when the
   * manifest asked for no network access.
   */
  networkGrants(): readonly string[] {
    return this.grants.flatMap((grant) => (grant.kind === "network" ? [grant.host] : []));
  }

  /** True if the manifest declared `nondeterministic: true` (section 4). */
  isNondeterministic(): boolean {
    return this.nondeterministic;
  }

  /** True if the manifest declared `affectsGameplay: true`. */
  isAffectsGameplay(): boolean {
    return this.affectsGameplay;
  }
}

/**
 * Split `host` or `host:port` into its parts. A bracketed IPv6 literal keeps its
 * brackets; `port` is null when none is written.
 */
export function splitHostPort(value: string): { host: string; port: number | null } {
  const bracket = /^(\[[^\]]*\])(?::([0-9]+))?$/.exec(value);
  if (bracket) {
    return { host: bracket[1] as string, port: bracket[2] === undefined ? null : Number(bracket[2]) };
  }
  const colon = value.lastIndexOf(":");
  if (colon < 0) return { host: value, port: null };
  const port = value.slice(colon + 1);
  if (!/^[0-9]+$/.test(port)) return { host: value, port: null };
  return { host: value.slice(0, colon), port: Number(port) };
}

/**
 * True for a host `network:local` covers: `localhost` and names under
 * `.localhost`, the IPv4 loopback, private and link-local ranges (127/8, 10/8,
 * 172.16/12, 192.168/16, 169.254/16), and the IPv6 loopback, unique-local and
 * link-local ranges. Only literals are judged. A name such as `laya.lan` is not
 * resolved, because a name can point anywhere; a mod that needs one declares it
 * by name.
 */
export function isLocalNetworkHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    if ([a, b, c, d].some((n) => n > 255)) return false;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const v6 = /^\[([0-9a-f:.]+)\]$/.exec(h);
  if (v6) {
    const addr = v6[1] as string;
    if (addr === "::1") return true;
    const first = addr.split(":")[0] ?? "";
    if (first === "") return false;
    const word = parseInt(first, 16);
    return (word & 0xfe00) === 0xfc00 || (word & 0xffc0) === 0xfe80;
  }
  return false;
}

/**
 * The capability a request to `url` needs: `network:<host>`, plus `:<port>`
 * when the URL names a port other than its scheme's default. Null for anything
 * but an absolute http or https URL.
 */
export function networkRequestCapability(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname === "") return null;
  return `network:${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}`;
}

/**
 * True when one of `grants` (hosts as `CapabilitySet.networkGrants()` returns
 * them) covers the `network:` capability `cap`. Throws CapabilityError when a
 * grant or `cap` is not a valid network capability.
 */
export function networkGrantCovers(grants: readonly string[], cap: string): boolean {
  const request = parseCapability(cap);
  if (request.kind !== "network") throw new CapabilityError(`"${cap}" is not a network capability`);
  return grants.some((host) => grantCovers(parseCapability(`network:${host}`), request));
}
