/**
 * Which tier a mod belongs to, and which of its permissions it actually holds.
 *
 * A tier is worked out from facts the game measured, never from anything a
 * manifest says about itself:
 *
 *   - first-party: the mod was fetched from a repository on FIRST_PARTY_ORIGINS
 *     (baked into this build), its id is the one that repository publishes, and
 *     every installed file still hashes to the digest recorded when it arrived;
 *   - reviewed: needs approval of the installed commit and payload. The current
 *     registry has no release approval records, so this tier is not assigned;
 *   - listed: a community entry on the default registry, including one whose
 *     reviewed label names only a repository;
 *   - sideloaded: everything else. A mods folder, a session-only mod, a zip, a
 *     repository typed by address, and an install record too old to say where
 *     it came from all land here.
 *
 * The execution tier is separate and also measured: what the pack ships
 * (mod-code.ts executionOf), not what its manifest calls itself.
 *
 * A mod's grants are the capabilities it declared, less those its tier may not
 * hold, less those the player refused. The tier never narrows what code in the
 * page may do in the game. The only capabilities it withholds are the ones
 * SEAM_POLICY names (`manage`, which can install or turn on other code), what a
 * Worker runtime does not provide, and strings the vocabulary does not know. No
 * wildcard ever covers a `manage` or `truth` capability.
 */

import {
  CapabilitySet,
  matchCapability,
  type CapabilityEntry,
  type CapabilityTier,
  type InstallListing,
} from "@rpgm-tools/neo-angband-mod-sdk";

/** How far the game trusts a mod, from where it came from. */
export type ModTrust = "first-party" | "reviewed" | "listed" | "sideloaded";

/** What a mod's payload makes it: no code, a Worker, or code in the page. */
export type ModExecution = "data" | "worker" | "in-process";

/** Where the pack the game is using was read from. */
export type ModSource = "installed" | "folder" | "session";

/** One of the game's own mods: the repository it is published from and its id. */
export interface FirstPartyOrigin {
  readonly id: string;
  readonly repo: string;
  /**
   * The first-party-only capabilities this mod may hold. Anything not named
   * here is refused even to this mod.
   */
  readonly seams: readonly string[];
  /**
   * First-party-only capabilities that mark every character played while the
   * mod holds them, the way the game's debug commands do.
   */
  readonly marksSave?: readonly string[];
}

/** The hidden-map capability: the only one in the `truth` namespace. */
export const TRUTH_MAP = "state:map-actual.read";

/**
 * The game's own mods. A repository here counts as first-party only when the
 * installed bytes still match what was fetched from it.
 */
export const FIRST_PARTY_ORIGINS: readonly FirstPartyOrigin[] = Object.freeze([
  {
    id: "anybandui",
    repo: "neostryder/neo-angband-mod-anybandui",
    seams: ["screens:manage", "session:control", "profiles:manage", "mod:install", "options:manage", TRUTH_MAP],
    marksSave: [TRUTH_MAP],
  },
  { id: "borg", repo: "neostryder/neo-angband-mod-borg", seams: [TRUTH_MAP, "profiles:manage"] },
  { id: "squire", repo: "neostryder/neo-angband-mod-squire", seams: ["profiles:manage"] },
  { id: "forge", repo: "neostryder/neo-angband-mod-forge", seams: ["mod:session", "mod:install", "mod:authoring"] },
  { id: "qol", repo: "neostryder/neo-angband-mod-qol", seams: [] },
  { id: "bug-fixes", repo: "neostryder/neo-angband-mod-bug-fixes", seams: [] },
  { id: "linoleum", repo: "neostryder/neo-angband-mod-linoleum", seams: [] },
  { id: "upstream-catchup", repo: "neostryder/neo-angband-mod-upstream-catchup", seams: [] },
  { id: "feature-restoration", repo: "neostryder/neo-angband-mod-feature-restoration", seams: [] },
].map((origin) => Object.freeze(origin)));

/** The first-party entry for a repository, matched without regard to case. */
export function firstPartyOrigin(repo: string): FirstPartyOrigin | undefined {
  const key = repo.toLowerCase();
  return FIRST_PARTY_ORIGINS.find((origin) => origin.repo === key);
}

/** What the game measured about one mod, which is all a tier is worked out from. */
export interface ModTierFacts {
  readonly id: string;
  readonly source: ModSource;
  readonly execution: ModExecution;
  /** For an installed mod: the repository its record names. */
  readonly repo?: string;
  /** For an installed mod: how it reached the game, when the record says. */
  readonly listing?: InstallListing;
  /** For an installed mod: the commit its tag resolved to at install, when known. */
  readonly sha?: string;
  /** For an installed mod: the id of a mod that asked for it to be installed. */
  readonly installedByModId?: string;
  /** Every installed file still matches its recorded digest. False when unchecked. */
  readonly digestsMatch?: boolean;
  /** A lab build was told to treat this folder mod as first-party (lab-trust.ts). */
  readonly labTrusted?: boolean;
}

/** A mod's tier, with the reason in words for the manager. */
export interface ModTier {
  readonly trust: ModTrust;
  readonly execution: ModExecution;
  /** The vocabulary tier its capabilities are checked against. */
  readonly capabilityTier: CapabilityTier;
  /** The first-party-only capabilities this build allows it; empty unless first-party. */
  readonly seams: readonly string[];
  /** Of those, the ones that mark the save. */
  readonly marksSave: readonly string[];
  /** Why the tier is what it is. */
  readonly why: string;
}

/**
 * Whether the bytes were fetched from the repository the record names.
 *
 * A zip records whatever repository its manifest claims, so only a record
 * that says it was fetched counts. A record older than the `listing` field is
 * counted as fetched when it holds a commit, which only the repository path
 * ever writes.
 */
function fetchedFromRepo(facts: ModTierFacts): boolean {
  if (facts.installedByModId !== undefined) return false;
  if (facts.listing !== undefined) return facts.listing !== "file";
  return facts.sha !== undefined;
}

/** The tier the facts support. */
export function assignTier(facts: ModTierFacts): ModTier {
  const trustAndWhy = ((): { trust: ModTrust; why: string; origin?: FirstPartyOrigin } => {
    if (facts.source === "folder") {
      const origin = facts.labTrusted === true ? FIRST_PARTY_ORIGINS.find((o) => o.id === facts.id) : undefined;
      if (origin) return { trust: "first-party", why: "loaded from a mods folder and trusted by this lab build", origin };
      return { trust: "sideloaded", why: "loaded from a mods folder" };
    }
    if (facts.source === "session") return { trust: "sideloaded", why: "loaded for this session only" };
    const origin = facts.repo === undefined ? undefined : firstPartyOrigin(facts.repo);
    if (origin && fetchedFromRepo(facts)) {
      if (origin.id !== facts.id) {
        return { trust: "sideloaded", why: `${origin.repo} publishes "${origin.id}", not "${facts.id}"` };
      }
      if (facts.digestsMatch === true) return { trust: "first-party", why: `installed from ${origin.repo}`, origin };
      return {
        trust: "sideloaded",
        why: `its files no longer match what was installed from ${origin.repo}`,
      };
    }
    /* The current registry has repository labels, without release approvals. */
    if (facts.listing === "reviewed") return { trust: "listed", why: "listed without approval of this release's commit and payload" };
    if (facts.listing === "community") return { trust: "listed", why: "listed on the game's registry" };
    if (facts.listing === "file") return { trust: "sideloaded", why: "installed from a file" };
    if (facts.listing === "address") return { trust: "sideloaded", why: "installed from a repository address" };
    if (facts.installedByModId !== undefined) {
      return { trust: "sideloaded", why: `installed by the mod "${facts.installedByModId}"` };
    }
    return { trust: "sideloaded", why: "the install record does not say where it came from" };
  })();
  const origin = trustAndWhy.origin;
  return Object.freeze({
    trust: trustAndWhy.trust,
    execution: facts.execution,
    capabilityTier: capabilityTierFor(trustAndWhy.trust, facts.execution),
    seams: origin ? origin.seams : [],
    marksSave: origin ? origin.marksSave ?? [] : [],
    why: trustAndWhy.why,
  });
}

/**
 * The vocabulary tier for a trust level and payload. A first-party mod keeps
 * its tier wherever it runs; any other mod running in a Worker is checked as a
 * Worker; and in-process code nobody reviewed is checked as sideloaded, whether
 * or not the registry lists it.
 */
export function capabilityTierFor(trust: ModTrust, execution: ModExecution): CapabilityTier {
  if (trust === "first-party") return "first-party";
  if (execution === "worker") return "worker";
  if (trust === "reviewed") return "reviewed";
  return "sideloaded";
}

/** True when a mod's listings should carry the "unreviewed" badge. */
export function isUnreviewed(tier: Pick<ModTier, "trust" | "execution">): boolean {
  return tier.trust === "sideloaded" || (tier.trust === "listed" && tier.execution === "in-process");
}

/** The tier for a mod nothing has been measured about. */
export const UNKNOWN_TIER: ModTier = assignTier({ id: "", source: "folder", execution: "in-process" });

/** A capability the tier will not let a mod hold, and why. */
export interface TierRefusal {
  readonly capability: string;
  readonly why: string;
}

/** The player's recorded decisions for one mod. */
export interface ConsentDecisions {
  readonly granted: readonly string[];
  readonly refused: readonly string[];
}

/** What a mod holds, and what it asked for and does not. */
export interface ModGrants {
  /** Exactly what the mod is handed. */
  readonly granted: readonly string[];
  /** Declared, and not something a mod of its tier may hold. */
  readonly refusedByTier: readonly TierRefusal[];
  /** Declared, and refused by the player. */
  readonly refusedByPlayer: readonly string[];
  /** Declared, allowed for the tier, and not decided yet. */
  readonly undecided: readonly string[];
  /** Refused or undecided capabilities the mod cannot start without. */
  readonly blocking: readonly string[];
}

const TIER_WORDS: Readonly<Record<CapabilityTier, string>> = {
  "first-party": "first-party",
  reviewed: "reviewed",
  sideloaded: "unreviewed",
  worker: "Worker",
};

/** Who may hold the capabilities of one namespace outside the public one. */
interface SeamRule {
  /** Any mod running code in the page may hold it, with the player's consent. */
  readonly inProcess: boolean;
  /** A first-party mod whose FIRST_PARTY_ORIGINS entry names the capability may hold it. */
  readonly firstPartyListed: boolean;
  /**
   * The player confirms it on its own Core-drawn question, separately from
   * the other permissions, because it can install or turn on other code.
   */
  readonly confirm: boolean;
}

/**
 * THE SEAM POLICY, in one table. This policy is under revision.
 *
 * What an in-process mod may do in the game is not narrowed by its tier:
 * review, the unreviewed notice and the Worker sandbox are where safety comes
 * from. The one exception is a capability that is an escape route out of the
 * mod's own reach: `manage` can install or turn on other code, so it stays with
 * the game's own mods, each named for it in FIRST_PARTY_ORIGINS, and is
 * confirmed on its own Core-drawn question. `truth` (the real map) goes to any
 * in-process mod the player allows; its consent sentence says the mod sees what
 * the character has not found. A Worker mod gets either only when it is a
 * listed first-party mod. A namespace missing from this table is held by nobody.
 */
const SEAM_POLICY: Readonly<Record<string, SeamRule>> = Object.freeze({
  manage: Object.freeze({ inProcess: false, firstPartyListed: true, confirm: true }),
  truth: Object.freeze({ inProcess: true, firstPartyListed: true, confirm: false }),
});

/** The vocabulary entry for a capability string, or undefined when it does not know it. */
function entryOf(capability: string): CapabilityEntry | undefined {
  try {
    return matchCapability(capability)?.entry;
  } catch {
    return undefined;
  }
}

/** Why the seam policy keeps `capability` from a mod of this tier, or null when it does not. */
function seamRefusal(entry: CapabilityEntry, capability: string, tier: ModTier): string | null {
  if (entry.namespace === "manage" && tier.execution !== "in-process") return "Only in-process first-party mods can manage the game.";
  const rule = SEAM_POLICY[entry.namespace];
  if (!rule) return "only the game's own mods can have it";
  if (rule.inProcess && tier.execution === "in-process") return null;
  if (!rule.firstPartyListed || tier.trust !== "first-party") return "only the game's own mods can have it";
  if (!tier.seams.includes(capability)) return "this version of the game does not give it to this mod";
  return null;
}

/**
 * Whether the player confirms `capability` on its own Core-drawn question
 * before it is granted (SEAM_POLICY `confirm`).
 */
export function needsOwnConfirmation(capability: string): boolean {
  const entry = entryOf(capability);
  return entry !== undefined && SEAM_POLICY[entry.namespace]?.confirm === true;
}

/**
 * Why a mod of this tier may not hold `capability`, or null when it may.
 *
 * A capability the vocabulary does not know is never granted. One outside the
 * public namespace follows SEAM_POLICY. A public capability is never withheld
 * from code in the page; a Worker mod is held to the vocabulary's Worker tier,
 * which is what its runtime provides.
 */
export function tierRefusal(capability: string, tier: ModTier): string | null {
  if (capability === "engine:access" && tier.execution === "worker") return "Worker mods cannot have live engine access";
  const entry = entryOf(capability);
  if (!entry) return "the game does not know this permission";
  if (entry.namespace !== "public") return seamRefusal(entry, capability, tier);
  if (tier.execution !== "worker") return null;
  if (!entry.tiers.includes(tier.capabilityTier)) {
    return `${TIER_WORDS[tier.capabilityTier]} mods cannot have it`;
  }
  return null;
}

/** Whether the mod still starts with this capability refused. */
export function canRunWithout(capability: string): boolean {
  try {
    return matchCapability(capability)?.entry.canRunWithout ?? true;
  } catch {
    return true;
  }
}

/**
 * What a mod built into the game holds after the player's refusals. Built-in
 * mods have no install to measure, so no tier refuses anything; only the
 * player does. `start` is false while a capability is undecided, or when one
 * the mod cannot start without was refused.
 */
export function playerHeld(
  declared: readonly string[],
  decisions: ConsentDecisions,
): { readonly held: readonly string[]; readonly start: boolean } {
  const refused = new Set(decisions.refused);
  const granted = new Set(decisions.granted);
  const held = declared.filter((cap) => granted.has(cap) && !refused.has(cap) && !overridesRefusal(cap, decisions.refused));
  const start = declared.every((cap) => (refused.has(cap) || overridesRefusal(cap, decisions.refused) ? canRunWithout(cap) : granted.has(cap)));
  return { held, start };
}

/** A broad grant cannot undo a decision the player made about a narrower one. */
function overridesRefusal(capability: string, refused: readonly string[]): boolean {
  if (!capability.includes("*") || refused.length === 0) return false;
  const caps = CapabilitySet.fromManifest({ id: "", name: "", version: "", shape: "plugin", capabilities: [capability] });
  return refused.some((cap) => entryOf(cap) !== undefined && caps.has(cap));
}

/**
 * Split a mod's declared capabilities into what it holds and what it does not.
 *
 * A refusal wins over a grant when a merged store holds both. A capability a
 * tier refuses is never left waiting for the player: there is nothing they
 * could answer that would grant it.
 */
export function effectiveGrants(
  declared: readonly string[],
  tier: ModTier,
  decisions: ConsentDecisions,
): ModGrants {
  const granted: string[] = [];
  const refusedByTier: TierRefusal[] = [];
  const refusedByPlayer: string[] = [];
  const undecided: string[] = [];
  const blocking: string[] = [];
  const yes = new Set(decisions.granted);
  const no = new Set(decisions.refused);
  for (const capability of new Set(declared)) {
    if (capability === "engine:access" && tier.trust === "first-party" && tier.execution === "in-process") {
      granted.push(capability);
      continue;
    }
    const why = tierRefusal(capability, tier);
    if (why !== null) {
      refusedByTier.push({ capability, why });
      if (!canRunWithout(capability)) blocking.push(capability);
      continue;
    }
    if (no.has(capability) || overridesRefusal(capability, decisions.refused)) {
      refusedByPlayer.push(capability);
      if (!canRunWithout(capability)) blocking.push(capability);
    } else if (yes.has(capability)) {
      granted.push(capability);
    } else {
      undecided.push(capability);
      blocking.push(capability);
    }
  }
  return Object.freeze({ granted, refusedByTier, refusedByPlayer, undecided, blocking });
}

/**
 * Whether every installed file hashes to the digest recorded for it.
 *
 * False when the record has no digests, when a listed file is missing or has
 * no digest, or when any hash differs: a first-party claim needs all of them.
 */
export async function installedDigestsMatch(
  meta: { readonly id: string; readonly files: readonly string[]; readonly digests?: Readonly<Record<string, string>> },
  read: (id: string, path: string) => Promise<Uint8Array | null>,
  hash: (bytes: Uint8Array) => Promise<string>,
): Promise<boolean> {
  const digests = meta.digests;
  if (!digests || meta.files.length === 0) return false;
  for (const path of meta.files) {
    const expected = digests[path];
    if (expected === undefined) return false;
    const bytes = await read(meta.id, path);
    if (!bytes) return false;
    if ((await hash(bytes)).toLowerCase() !== expected.toLowerCase()) return false;
  }
  return true;
}

/**
 * How a repository install reached the game, from the default registry's lists.
 * A curated pick is "curated"; a community entry is "community", or "reviewed"
 * when its entry carries the reviewed label; anything else came by address.
 */
export function installListing(
  repo: string,
  curated: boolean,
  registry: { readonly community: readonly { readonly repo: string }[]; readonly reviewed?: readonly string[] } | null,
): InstallListing {
  if (curated) return "curated";
  const key = repo.toLowerCase();
  if (registry?.reviewed?.some((r) => r.toLowerCase() === key)) return "reviewed";
  if (registry?.community.some((r) => r.repo.toLowerCase() === key)) return "community";
  return "address";
}

/* --- The latch ---------------------------------------------------------------
 *
 * Tiers are measured once per look at the mod sources (main.ts
 * rediscoverModSources), because the digest check reads storage and the
 * loaders that need the answer are synchronous.
 */

let tiers: ReadonlyMap<string, ModTier> = new Map();
let grants: ReadonlyMap<string, ModGrants> = new Map();

/** Install the measured tiers (the boot path, and tests). */
export function setModTiers(next: ReadonlyMap<string, ModTier>): void {
  tiers = next;
}

/** Install the grants the loader settled (the boot path, and tests). */
export function setModGrants(next: ReadonlyMap<string, ModGrants>): void {
  grants = next;
}

/** Forget every tier and grant (tests). */
export function resetModTiers(): void {
  tiers = new Map();
  grants = new Map();
}

/** A mod's measured tier; a mod nothing was measured about is sideloaded. */
export function modTier(id: string): ModTier {
  return tiers.get(id) ?? UNKNOWN_TIER;
}

/** Every measured tier, by mod id. */
export function modTiers(): ReadonlyMap<string, ModTier> {
  return tiers;
}

/** The seams outside the public API the API 2 host may build for a mod (SEAM_POLICY). The name predates the policy. */
export interface FirstPartyAllowlist {
  readonly manage?: boolean;
  readonly truth?: boolean;
  readonly presentation?: boolean;
}

/** What a runtime needs to start one mod: its tier, what it holds, and its first-party seams. */
export interface ModStartGrants {
  readonly tier: ModTier;
  /** Exactly the capabilities the mod is handed. Empty for a mod the loader did not settle. */
  readonly granted: readonly string[];
  /** Present only for a mod that holds a seam capability: `truth` for any mod granted the real map, `manage` for a first-party one. */
  readonly firstParty?: FirstPartyAllowlist;
}

/**
 * The single answer a runtime asks for before starting a mod: its tier, the
 * capabilities it holds, and which seams outside the public API it may have.
 */
export function modStartGrants(id: string): ModStartGrants {
  const tier = modTier(id);
  const granted = grants.get(id)?.granted ?? [];
  /* The loader granted only what SEAM_POLICY allows this tier, so holding the
   * capability is the whole test; `manage` is first-party only by that policy. */
  const truth = granted.includes(TRUTH_MAP);
  const manage = tier.trust === "first-party" && tier.execution === "in-process" && granted.some((cap) => tier.seams.includes(cap) && entryOf(cap)?.namespace === "manage");
  const presentation = tier.trust === "first-party" && tier.execution === "in-process";
  if (!truth && !manage && !presentation) return Object.freeze({ tier, granted });
  return Object.freeze({ tier, granted, firstParty: Object.freeze({ ...(manage ? { manage } : {}), ...(truth ? { truth } : {}), ...(presentation ? { presentation } : {}) }) });
}

/** Whether any loaded mod holds a capability that marks the save. */
export function saveMarkingGrantHeld(): boolean {
  for (const [id, held] of grants) {
    const marks = modTier(id).marksSave;
    if (held.granted.some((cap) => marks.includes(cap))) return true;
  }
  return false;
}
