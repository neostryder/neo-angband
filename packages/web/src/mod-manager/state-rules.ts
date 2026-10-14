import type { DeclaredConflict, PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { capabilitiesNotYetGranted, type CatalogMod, type ModStore } from "../mod-store";

/** Every `conflicts` claim whose named pack is actually enabled. */
export function declaredConflicts(
  manifests: readonly PackManifest[],
): DeclaredConflict[] {
  const enabled = new Set(manifests.map((m) => m.id));
  const out: DeclaredConflict[] = [];
  for (const m of manifests) {
    for (const c of m.compat ?? []) {
      if (c.claim !== "conflicts" || !enabled.has(c.with)) continue;
      out.push({
        packId: m.id,
        with: c.with,
        because: c.because,
        ...(c.scope ? { scope: [...c.scope] } : {}),
      });
    }
  }
  return out;
}

/** True exactly while enabling `m` needs the one-time score warning. */
export function needsGameplayNoscoreWarning(m: CatalogMod, modNoscore: boolean): boolean {
  return m.affectsGameplay && !modNoscore;
}

/** The capabilities the player decides about: declared, less what the mod's tier refuses. */
export function decidableCapabilities(m: CatalogMod): readonly string[] {
  const byTier = new Set((m.tierRefused ?? []).map((r) => r.capability));
  return m.capabilities.filter((cap) => !byTier.has(cap));
}

/** The decidable capabilities the player has neither allowed nor refused. */
export function undecidedCapabilities(m: CatalogMod): readonly string[] {
  return capabilitiesNotYetGranted(decidableCapabilities(m), [...m.granted, ...(m.refused ?? [])]);
}

/**
 * Whether `m` needs the unreviewed notice before it is turned on: an unreviewed
 * mod that runs code, whose notice the player has not read yet. Shown once per mod.
 */
export function unreviewedNoticeDue(m: CatalogMod, store: Pick<ModStore, "sawUnreviewedNotice">): boolean {
  return m.unreviewed === true && m.tier !== undefined && m.tier.execution !== "data" && !store.sawUnreviewedNotice(m.id);
}
