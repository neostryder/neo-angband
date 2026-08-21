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
 *                             "registry:profile" | "registry:blow" |
 *                             "registry:store" | "registry:command" |
 *                             "registry:monster" | "registry:projection" |
 *                             "registry:ui-entry" | "registry:glyph" |
 *                             "registry:effect-info" |
 *                             "registry:randart" | "registry:tval" |
 *                             "registry:vocab"; or the
 *                             wildcard "registry:*"
 *                             for all of them. "registry:projection" says what a
 *                             projection DOES to terrain, floor objects and the
 *                             player - the behaviour half of adding a new
 *                             element. "registry:glyph" says what one character
 *                             of a room-template or vault layout means when the
 *                             level is drawn - the behaviour half of shipping a
 *                             vault with a symbol core never heard of.
 *                             "registry:ui-entry" says what a `combine:` or an
 *                             `entry-renderer:` `code:` MEANS on the second
 *                             character screen and the equip-comparison screen -
 *                             how a row's per-slot values reduce, and how a
 *                             value becomes a cell symbol and colour. Adding a
 *                             ui_entry ROW needs no capability; saying what its
 *                             combiner or renderer does needs this.
 *                             "registry:effect-info" says what the game PRINTS
 *                             about an effect - its menu row, its recall
 *                             sentence, the object properties an activation
 *                             summarises, the named subtypes it accepts and
 *                             which item it prompts for - the description half
 *                             of "registry:effect".
 *                             "registry:randart" reaches the random ARTIFACT
 *                             generator: what an ability does, what an item
 *                             class starts with, and whether an activation
 *                             is redundant. Distinct from shipping a FIXED
 *                             artifact, which needs no capability at all.
 *                             "registry:tval" reaches every question core asks
 *                             about an item CLASS - is it a weapon, can it be
 *                             worn or flavoured, is it good, what is it worth
 *                             unidentified. Distinct from shipping a new ITEM,
 *                             which needs no capability at all.
 *                             "registry:vocab" (W2.3) declares
 *                             NEW vocabulary (flags/stats/any kind). Distinct
 *                             from "command:add": that adds a command via the
 *                             act facade, this replaces what a command DOES (and
 *                             the effect/room/AI logic behind the game).
 *                             (The named-core-rule flags the bundled qol /
 *                             bug-fixes mods use, GameState.modRules, are a
 *                             DECLARATIVE manifest field - PackManifest.rules -
 *                             applied by the host, so they need no capability.)
 *                             "registry:menu" rewrites the semantic rows of
 *                             one stable front-end menu id. It is distinct from
 *                             a future full front-end selection capability.
 *                             "registry:tiles" supplies tiles for content the
 *                             loaded tile pack does not draw, which in practice
 *                             means content a mod added. Additive only, and it
 *                             cannot repaint what the pack or a pref file
 *                             already assigned: the fill door writes where
 *                             nothing has and refuses elsewhere.
 *  - "display:replace"     - become the game's FRONT END: everything the
 *                             player sees of the dungeon is drawn by this
 *                             plugin (ModPlugin.frontend). Its own kind
 *                             rather than a registry domain, and NOT
 *                             covered by "registry:*" - an override
 *                             wildcard grants every named game system,
 *                             which is not the same thing as owning the
 *                             screen.
 *  - "ui:<region>.replace" - draw ONE named part of the HUD instead of the
 *                             game (ModPlugin.hud): "ui:messages.replace" |
 *                             "ui:sidebar.replace" | "ui:status.replace", or
 *                             the wildcard "ui:*.replace" for all three.
 *                             Per REGION on purpose - a mod drawing hit points
 *                             as a bar should not have to ask for the message
 *                             line as well, and a player consenting to it
 *                             should be told which part of their screen is
 *                             changing hands. There is no "ui:map.replace":
 *                             the dungeon is "display:replace"'s, and one
 *                             region answering to two capabilities would be
 *                             two answers to "who draws this".
 *                             NOT covered by "display:replace" and it does not
 *                             cover it, in either direction: taking the map is
 *                             not taking the vitals.
 *  - "backup:folder"       - lets the mod write files into a folder the player
 *                             picks; the mod never learns the folder's real
 *                             path (the browser will not say), only that a
 *                             write to it succeeded or failed. Its own kind,
 *                             like "display:replace" - there is nothing to
 *                             range over, so it has no wildcard either.
 *  - "ui:region.create"    - ADD a rectangle of your own to the player's screen
 *                             (ModPlugin.regions), rather than take one of the
 *                             game's. The only "ui:" capability whose ACTION is
 *                             not "replace", and the distinction is the point:
 *                             every name above is something the game already
 *                             draws, so consenting to it is consenting to a
 *                             handover, while this one is new furniture
 *                             appearing. No wildcard - there is no set of
 *                             region names to range over, because the region
 *                             does not exist until the mod declares it. NOT
 *                             covered by "ui:*.replace", which is why
 *                             `grantCovers` compares the action as well as the
 *                             region.
 *
 * This module only surfaces `nondeterministic` from the manifest. The
 * save's determinism ratchet itself - flipping a save from DETERMINISTIC to
 * NONDETERMINISTIC the first time such a mod is enabled, once and
 * irreversibly - lives in core/save (decisions 4/18/22), not here.
 */

import { hasFacet, type PackManifest } from "./manifest.js";

export class CapabilityError extends Error {}

/** A capability string parsed into its structured form. */
export type ParsedCapability =
  | { kind: "command"; action: "add" }
  | { kind: "event"; name: string }
  | { kind: "state"; domain: string; access: "read" }
  | { kind: "network"; host: string }
  | { kind: "registry"; domain: string }
  | { kind: "display"; action: "replace" }
  | { kind: "ui"; region: string; action: "replace" | "create" }
  | { kind: "backup"; action: "folder" };

const EVENT_RE = /^event:([a-z][a-z0-9-]*)$/;
/**
 * The parts of the interface a plugin may own, plus the "*" wildcard. `map` is
 * absent deliberately: the dungeon is display:replace's.
 *
 * The first three are HUD REGIONS, sold one at a time because they are three
 * answers to three questions. `menu` is not a region - it is every menu the game
 * asks, held by one presenter that declines the questions it has no better way
 * to ask. One grant rather than one per menu id, because ~50 capability strings
 * would be a consent list nobody could read (`menu-runtime.ts` states the whole
 * argument). `screen` is the same bargain for the full-screen views - the
 * inventory listing, the character sheet, the knowledge browser. `ui:*.replace`
 * covers them all, as it covers the regions.
 */
const UI_RE = /^ui:(\*|messages|sidebar|status|menu|screen)\.replace$/;
/**
 * `ui:region.create` - ADD a rectangle of your own to the screen, rather than
 * take one of the game's.
 *
 * A SEPARATE ACTION, NOT A SEVENTH REGION NAME, and that distinction is the
 * whole reason this is its own pattern. Every string `UI_RE` matches names
 * something that already exists and is currently drawn by the game; consenting
 * to one is consenting to a HANDOVER. This one names nothing - the region does
 * not exist until the mod declares it - so what the player is consenting to is
 * new furniture appearing, which is a different sentence and deserves a
 * different string.
 *
 * THERE IS NO WILDCARD, deliberately. `ui:*.replace` is a wildcard over WHICH
 * region changes hands, and it means something because the set of regions is
 * closed and known. There is no set to range over here: a mod either may add
 * regions or it may not.
 *
 * AND `ui:*.replace` MUST NOT COVER IT. That is enforced in `grantCovers` by
 * comparing `action`, and it is the reason that comparison exists at all - see
 * the note there.
 */
const UI_CREATE_RE = /^ui:region\.create$/;
const STATE_RE = /^state:(\*|[a-z][a-z0-9-]*)\.read$/;
const NETWORK_RE = /^network:(\*|[a-zA-Z0-9.-]+)$/;
/** The override domains ModRegistryHost gates, plus the "*" wildcard. */
const REGISTRY_RE =
  /^registry:(\*|effect-info|effect|room|profile|blow|store|command|monster|projection|ui-entry|glyph|randart|rune|tval|vocab|menu|message|tiles)$/;

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
  /* NOT a registry domain, deliberately. A registry:* grant means "override
   * one named game system among many"; this one means "everything the player
   * sees of the dungeon is drawn by this mod." It is the display OWNER, so it
   * has no domain to name and no wildcard to sit under - `registry:*` must not
   * carry it, which is exactly what a separate kind buys. */
  if (cap === "display:replace") {
    return { kind: "display", action: "replace" };
  }
  /* "backup:folder": lets the mod write files into a folder the player picks;
   * the mod never learns the folder's real path (the browser will not say),
   * only that a write to it succeeded or failed. Its own kind, not a registry
   * domain: there is nothing to range over, same reasoning as display:replace. */
  if (cap === "backup:folder") {
    return { kind: "backup", action: "folder" };
  }
  const ui = UI_RE.exec(cap);
  if (ui) {
    return { kind: "ui", region: ui[1] as string, action: "replace" };
  }
  /* `region` is the region NAME here as much as `sidebar` is in the line above:
   * it is the literal the author wrote, kept so that one `kind: "ui"` arm has
   * one shape rather than two. What distinguishes it is `action`. */
  if (UI_CREATE_RE.test(cap)) {
    return { kind: "ui", region: "region", action: "create" };
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
    case "display":
      /* Exact match only. See parseCapability: `registry:*` does not reach
       * here, so a mod holding the override wildcard still cannot take the
       * display without asking for it by name. */
      return grant.kind === "display";
    case "backup":
      /* Exact match only, same reasoning as "display" - there is exactly one
       * backup capability and no wildcard grant could ever cover it. */
      return grant.kind === "backup";
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
      `this plugin needs capability "${cap}"; add it to pack.json capabilities`,
    );
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
