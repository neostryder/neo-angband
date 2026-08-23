/**
 * One conflict report over every composition layer.
 *
 * WHAT WAS WRONG. `computeConflictReport` (conflicts.ts) walks `pack.files`, so
 * it sees CONTENT RECORDS and nothing else. Four other layers collided in
 * complete silence:
 *
 *  - GRAPHICS: two mods claiming one grafID. Nothing said so, and until
 *    2026-08-01 the loser was the LATER mod, backwards from every other layer.
 *  - BEHAVIOUR: two mods contributing the same ModHooks member. For a
 *    last-answer hook the earlier mod's rule simply never runs, and until
 *    2026-08-02 it was the LATER mod's that did not, backwards from the row the
 *    player reads.
 *  - RULES: two mods declaring the same flag string. `resolveModRules` is a flat
 *    last-wins namespace, so one mod silently reads the other's toggle.
 *  - CONTROLLER: two mods shipping an autoplayer. There is one slot; the second
 *    install wins and the first is not told.
 *
 * A report that sees one layer of five cannot be the substrate for author-
 * declared conflict resolution, which is what this whole model needs it to be.
 *
 * WHY THE FOLD IS PART OF THE ANSWER. The layers do not resolve the same way and
 * pretending they do would be the RimWorld trap - XML, then xpath, then C#, each
 * with its own effective precedence, so "load order" quietly means three
 * different things. Here the report NAMES the fold, because "these two combine"
 * and "one of these is being ignored" are different news for the player and only
 * one of them needs acting on.
 *
 * DERIVED, NOT DECLARED. Every claim is observed from what a mod actually
 * contributes - the refs in its files, the hooks its factory returned, the
 * grafIDs its manifest claims, the controller it handed over. A `touches` field
 * in the manifest would have been easier and would drift the first time an
 * author forgot to update it, which is the failure this report exists to catch.
 */

/** Which composition layer a contested slot belongs to. */
export type ContestedLayer =
  | "record" // a content record's field
  | "graphics" // a grafID (a Graphics-menu row)
  | "behaviour" // a ModHooks member
  | "rule" // a player-facing flag name
  | "controller" // the single autoplayer slot
  | "frontend" // the single selected display sink
  | "hud" // one named HUD region's selected sink
  | "menu" // the single selected menu presenter
  | "screen"; // the single selected screen presenter

/**
 * How a layer resolves several claims on one slot.
 *
 * EVERY ONE OF THESE IS "THE LATER MOD WINS", which is the point: the mod
 * manager promises the player one lever ("Move later (loads last, wins
 * conflicts)"), and a lever that means five different things is not a lever. The
 * folds differ only in whether there is anything for a winner to win.
 *
 * The three that DISCARD a claim - `last-wins`, `last-answer`, `single-slot` -
 * are the ones worth a player's attention; the rest combine, and are reported so
 * the picture is complete rather than because anything is wrong.
 */
export type Fold =
  | "last-wins" // the last claim in load order takes effect; earlier ones are overwritten
  | "last-answer" // the last claim with an opinion decides; earlier ones are never asked
  | "single-slot" // only one may hold it; a later claim displaces the earlier silently
  | "all-must-agree" // every claim runs and any refusal decides
  | "chained" // each claim transforms the previous one's result, so the last speaks last
  | "any-yes" // one claim asking is enough
  | "all-observe"; // a notification: every claim is told, and none of them answers

/** Whether a fold silently drops somebody's contribution. */
export function foldDiscards(fold: Fold): boolean {
  return fold === "last-wins" || fold === "last-answer" || fold === "single-slot";
}

/** One mod's claim on one slot. */
export interface Claim {
  /** The pack that contributed. */
  packId: string;
  /** The section it came from, when the pack attributed it to one. */
  sectionId?: string;
  /**
   * Set when a section's band moved this claim away from its pack's own
   * position, so the report can explain an order the load list does not show.
   */
  band?: string;
}

/** One thing more than one mod contributed to. */
export interface ContestedSlot {
  layer: ContestedLayer;
  /** Stable identity, for deduping and tests: "core:kobold.speed", "graphics:2". */
  key: string;
  /** What a player would call it: "kobold's speed", "the Graphics row for mode 2". */
  what: string;
  /** How this layer resolves the claims, and therefore whether one is discarded. */
  fold: Fold;
  /** Every claim, in load order. */
  claims: Claim[];
  /** The pack whose claim takes effect, when the fold picks one. */
  winner?: string;
}

/** A pack's display name, for lines a player reads; falls back to the id. */
export type NameOf = (packId: string) => string;

/** "frost", "frost and runes", "frost, runes and mist". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "frost" or "frost (kobold rebalance)" when the claim named a section. */
function claimName(claim: Claim, nameOf: NameOf): string {
  const base = nameOf(claim.packId);
  return claim.sectionId ? `${base} (${claim.sectionId})` : base;
}

/**
 * One plain-language line per contested slot.
 *
 * Written so the sentence tells the player whether to DO anything: a discarding
 * fold names the loser and the lever that changes it, a combining fold says the
 * contributions stack. A line that just says "conflict" is what makes players
 * stop reading conflict lists.
 */
export function describeContested(slot: ContestedSlot, nameOf: NameOf = (id) => id): string {
  const names = slot.claims.map((c) => claimName(c, nameOf));
  const who = joinNames(names);
  const winner = slot.winner ? nameOf(slot.winner) : undefined;
  /* A band that repositioned the winning claim is the one thing the load-order
   * list cannot show, so it is worth a clause of its own. */
  const winning = slot.claims.find((c) => c.packId === slot.winner);
  const banded =
    winning?.band && winning.band !== "normal"
      ? ` (its "${winning.sectionId}" part is set to load ${winning.band})`
      : "";

  switch (slot.fold) {
    case "last-wins":
      return `${who} all change ${slot.what}; ${winner} wins${banded} because it loads last.`;
    case "last-answer":
      return `${who} all handle ${slot.what}; only ${winner} runs${banded} because it loads last - the rest never get asked.`;
    case "single-slot":
      return `${who} each provide ${slot.what}, and there is room for one; ${winner} takes it${banded} and the others do nothing.`;
    case "all-must-agree":
      return `${who} all have a say in ${slot.what}; every one of them has to agree, so any single refusal decides.`;
    case "chained":
      return `${who} all change ${slot.what}, in load order, each one seeing the last one's result.`;
    case "any-yes":
      return `${who} all ask for ${slot.what}; one asking is enough, so they do not conflict.`;
    case "all-observe":
      return `${who} are all told about ${slot.what}; none of them answers, so they do not conflict.`;
  }
}

/**
 * Build the contested slots for one layer from a flat list of claims.
 *
 * `claims` is every claim on every key of that layer, IN LOAD ORDER. Keys with a
 * single claimant are dropped - one mod changing something is not a conflict,
 * and listing it would bury the ones that are.
 *
 * Two claims from the SAME pack on one key do not contest each other: a pack
 * whose base contributions and one of its own sections both touch a field has
 * made one decision in two places, and the pack's own order settles it.
 */
export function contestedSlots(
  layer: ContestedLayer,
  fold: Fold,
  claims: readonly { key: string; what: string; claim: Claim }[],
): ContestedSlot[] {
  const byKey = new Map<string, { what: string; claims: Claim[] }>();
  for (const entry of claims) {
    const slot = byKey.get(entry.key) ?? { what: entry.what, claims: [] };
    slot.claims.push(entry.claim);
    byKey.set(entry.key, slot);
  }

  const out: ContestedSlot[] = [];
  for (const [key, slot] of byKey) {
    const packs = new Set(slot.claims.map((c) => c.packId));
    if (packs.size < 2) continue;
    /* Every discarding fold now picks the SAME claim - the last one - which is
     * the property this whole model is for. Kept as a `foldDiscards` test rather
     * than collapsed into "last unless undefined", so adding a fold that picks
     * differently has to come here and say so. */
    const winner = foldDiscards(fold)
      ? slot.claims[slot.claims.length - 1]?.packId
      : undefined;
    out.push({
      layer,
      key,
      what: slot.what,
      fold,
      claims: slot.claims,
      ...(winner === undefined ? {} : { winner }),
    });
  }
  return out;
}

/**
 * An author's `conflicts` claim that applies to the current mod set.
 *
 * Carried separately from the contested slots because it is a DECLARATION rather
 * than an observation: nobody measured a collision, an author stated one. It is
 * shown with their reason attached and it never blocks - ratified decision 18,
 * the engine labels and does not forbid, and a third-party author does not get a
 * veto over the player's setup.
 */
export interface DeclaredConflict {
  /** The pack making the claim. */
  packId: string;
  /** The pack it names. */
  with: string;
  /** The claimant's own sections the claim is about, if it scoped itself. */
  scope?: string[];
  /** The author's stated reason. */
  because: string;
}

/** The warning line for a declared conflict. */
export function describeDeclaredConflict(
  conflict: DeclaredConflict,
  nameOf: NameOf = (id) => id,
): string {
  const where = conflict.scope?.length ? ` over ${conflict.scope.join(", ")}` : "";
  return `${nameOf(conflict.packId)} says it conflicts with ${nameOf(conflict.with)}${where}: ${conflict.because}`;
}
