import { type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { ModStore, type CatalogMod } from "../mod-store";
import { type ModManagerDeps } from "./classic-types";
import { type DelveMod } from "../mod-delve";
import { installedMods } from "../mod-install";
import { performDelveSyncWrite, delveSyncDeviceLabel } from "../mod-delve-sync";
import { ENGINE_VERSION, t } from "@rpgm-tools/neo-angband-core";

/* ------------------------------------------------------------------ *
 * Save a Delve... / Load a Delve... (docs/MOD_PROFILES.md, #87): a portable,
 * shareable snapshot of the enabled mod set, its flag choices, and
 * (optionally) game/birth options.
 * ------------------------------------------------------------------ */

/**
 * Every flag name a mod's own manifest declares - a rule's `flag`, or a
 * section's `flag` (defaulting to its `id`) - the same "one vocabulary for
 * both" `PackRule`/`PackSection` already share (manifest.ts).
 */
export function delveFlagNamesFor(manifest: Pick<PackManifest, "rules" | "sections">): Map<string, "rule" | "section"> {
  const out = new Map<string, "rule" | "section">();
  for (const rule of manifest.rules ?? []) out.set(rule.flag, "rule");
  for (const section of manifest.sections ?? []) out.set(section.flag ?? section.id, "section");
  return out;
}

/**
 * A mod's own flag choices, read for export.
 *
 * DRIFT FROM THE DESIGN DOC, NOTED HERE RATHER THAN SILENTLY FOLLOWED: the
 * doc's field table says `ModStore.getRuleChoices()` alone "covers both
 * PackRule.flag and PackSection.flag... the two vocabularies feed the same
 * map." Current `mod-store.ts` keeps them in two separate stores instead -
 * `getRuleChoices()` (flat, `RULE_CHOICES_KEY`) and `getSectionChoices()`
 * (nested `modId -> sectionId -> boolean`, `SECTION_CHOICES_KEY`) - so this
 * reads both and folds them into the one flat map the file format wants,
 * rather than trusting the doc's premise that one read already covers it.
 */
export function delveExportFlags(
  manifest: Pick<PackManifest, "rules" | "sections">,
  modId: string,
  ruleChoices: Readonly<Record<string, boolean>>,
  sectionChoicesByMod: Readonly<Record<string, Readonly<Record<string, boolean>>>>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const rule of manifest.rules ?? []) {
    if (rule.flag in ruleChoices) out[rule.flag] = ruleChoices[rule.flag] as boolean;
  }
  const sectionChoices = sectionChoicesByMod[modId] ?? {};
  for (const section of manifest.sections ?? []) {
    if (section.id in sectionChoices) {
      out[section.flag ?? section.id] = sectionChoices[section.id] as boolean;
    }
  }
  return out;
}

/**
 * Apply one mod's Delve flags back, routing each flag to whichever store
 * currently owns it (see `delveExportFlags`'s own note on why this cannot be
 * one pooled call regardless of mod, the way the design doc describes it -
 * the two stores mean a flag's OWNING mod has to be known to apply it
 * correctly). A flag naming neither a current rule nor a current section
 * (the mod changed shape since the Delve was made) is left unset rather than
 * written somewhere inert - the same "apply what is still understood"
 * degrade-not-refuse spirit the doc's version-mismatch section states.
 */
export function applyDelveFlags(
  manifest: Pick<PackManifest, "rules" | "sections">,
  modId: string,
  flags: Readonly<Record<string, boolean>>,
  store: ModStore,
): void {
  const owners = delveFlagNamesFor(manifest);
  for (const [flag, value] of Object.entries(flags)) {
    const owner = owners.get(flag);
    if (owner === "rule") store.setRuleChoice(flag, value);
    else if (owner === "section") store.setSectionChoice(modId, flag, value);
  }
}

/** One enabled, installed (repository-sourced) mod, ready to become a Delve entry. */
export async function saveDelveCandidates(
  deps: ModManagerDeps,
): Promise<{ readonly mod: CatalogMod; readonly entry: DelveMod }[]> {
  const catalog = deps.listCatalog().filter((m) => m.enabled && !m.missing && !m.session);
  const metaById = new Map((await installedMods(globalThis)).map((m) => [m.id, m] as const));
  const ruleChoices = deps.store.getRuleChoices();
  const sectionChoicesByMod = deps.store.getSectionChoices();
  const out: { mod: CatalogMod; entry: DelveMod }[] = [];
  for (const m of catalog) {
    /* A mod with no InstalledModMeta record - loaded from a folder, or staged
     * for this session only - has no repository this build can hand to
     * another install, so it has nothing to be exported AS: the design's own
     * field table sources every field from InstalledModMeta plus the
     * manifest, and a folder mod has neither an entry to read repo/tag from. */
    const meta = metaById.get(m.id);
    if (!meta) continue;
    out.push({
      mod: m,
      entry: {
        id: m.id,
        name: m.name,
        repo: meta.repo,
        tag: meta.tag,
        version: m.version,
        ...(meta.sha !== undefined ? { sha: meta.sha } : {}),
        enabled: true,
        flags: delveExportFlags(m.manifest, m.id, ruleChoices, sectionChoicesByMod),
        consents: deps.store.getConsent(m.id),
      },
    });
  }
  return out;
}

/**
 * Write this install's current mod set to its remembered sync folder (#158),
 * from the "Apply changes and reload" checkpoint (`applyModChanges`) - never
 * from a toggle. Reuses `saveDelveCandidates`, the same read Save-a-Delve
 * itself uses, so the synced snapshot and a manual export never disagree
 * about what "the current set" means. Never throws and never blocks the
 * reload it is called from: `deps.delveSync` absent, no folder chosen, or
 * nothing enabled worth exporting all fall out of `performDelveSyncWrite`
 * as a plain no-op, and any other failure (a lapsed permission, a full
 * disk) is swallowed here the same way - sync is opportunistic, and must
 * never be the reason applying a mod change appears to fail.
 */
export async function syncDelveOnApply(deps: ModManagerDeps): Promise<void> {
  if (!deps.delveSync) return;
  try {
    const candidates = await saveDelveCandidates(deps);
    const effectiveEnabled = deps.listCatalog().filter((m) => m.enabled).map((m) => m.id);
    await performDelveSyncWrite({
      folder: deps.delveSync,
      candidates: candidates.map((c) => c.entry),
      storedEnabled: deps.store.getEnabled(),
      effectiveEnabled,
      originDevice: delveSyncDeviceLabel(),
      engineVersion: ENGINE_VERSION,
      delveName: t("modsScreen.delve.sync.autoName", "Mod profile sync"),
    });
  } catch {
    /* Opportunistic: a write failure here must never surface as a reload failure. */
  }
}
