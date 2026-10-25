import { t } from "@rpgm-tools/neo-angband-core";
import { buildCatalog, type CatalogMod, type ConsentRecord } from "../mod-store";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { SCREEN_FOOTER } from "../screen-view";
import { selectFromMenu, showTextScreen, type ScreenLine } from "../overlay";
import type { GridPointerInput, GridSurface } from "../term";
import { UI_GOLD, UI_TEXT, UI_DIM } from "../ui-colors";
import { refused } from "./confirmation";
import { decidePermissions } from "./classic-permissions";
import type { CoreModManager, ModManagerService } from "./service";
import type { ManagerResult } from "./types";

export async function drawPendingManagementConfirmation(
  term: GridSurface & GridPointerInput,
  service: ModManagerService,
  core: CoreModManager,
): Promise<ManagerResult<unknown>> {
  const pending = service.state.pendingConfirmation;
  if (!pending) return refused("confirmation", "There is no pending mod confirmation.");
  const title = pending.operation === "restore" ? "Restore my mods" : pending.mods.map((mod) => `${mod.name} v${mod.version}`).join(", ") || t("modBrowse.consent.allowConfirm", "Allow third-party mods?");
  /* One mod already names itself in the title, so its first line would only repeat it. */
  const lines: ScreenLine[] = pending.mods.flatMap((mod) => [
    ...(pending.operation !== "restore" && pending.mods.length === 1 ? [] : [{ text: `${mod.name} v${mod.version}`, color: UI_TEXT }]),
    ...(mod.repository ? [{ text: mod.repository, color: UI_DIM }] : []),
    ...(mod.commit ? [{ text: mod.commit, color: UI_DIM }] : []),
    ...Object.entries(mod.digests ?? {}).map(([path, digest]) => ({ text: `${path}: ${digest}`, color: UI_DIM })),
  ]);
  lines.push(...(pending.downloads ?? []).map((mod) => ({ text: `Download: ${mod.name} v${mod.version}${mod.bytes === null ? "" : ` (${mod.bytes} bytes)`}`, color: UI_TEXT })));
  lines.push(...pending.riskNotice.map((text) => ({ text, color: UI_GOLD })));
  lines.push(...pending.conflicts.map((conflict) => ({ text: conflict.because, color: UI_GOLD })));
  await showTextScreen(term, { id: "core:mod-manage-confirm", title, footer: SCREEN_FOOTER, blocks: [{ kind: "lines", lines }] });
  const pick = await selectFromMenu(term, "core:mod-manage-confirm", title, [
    { label: t("modBrowse.consent.iUnderstand", "Yes, I understand"), color: UI_GOLD },
    { label: t("modsScreen.common.no.cancel", "No, cancel"), color: UI_TEXT },
  ], t("modsScreen.common.footer.abTapEsc", "[ a/b or tap; ESC cancels ]"));
  if (pick !== 0) return core.resolveConfirmation(pending.id, { accepted: false });
  const permissions: Record<string, ConsentRecord> = {};
  if (pending.permissions.length > 0) {
    const catalog = structuredClone(service.state.installed.map((mod) => mod.catalogMod)) as CatalogMod[];
    const downloads = service.state.pendingPlans.filter((plan) => pending.planId === undefined || plan.id === pending.planId).flatMap((plan) => plan.downloads);
    const asks = pending.mods.flatMap((subject) => {
      const caps = pending.permissions.filter((permission) => permission.modId === subject.id).map((permission) => permission.capability);
      if (caps.length === 0) return [];
      let mod = catalog.find((row) => row.id === subject.id);
      const download = downloads.find((row) => row.mod.id === subject.id);
      if (download) {
        mod = buildCatalog({ content: [], sandbox: [], trusted: [structuredClone(download.manifest) as PackManifest], enabled: [], consents: {} })[0];
      }
      return mod ? [{ mod, caps }] : [];
    });
    const decisions = await decidePermissions(term, asks, { core });
    if (!decisions) return core.resolveConfirmation(pending.id, { accepted: false });
    for (const [id, choices] of decisions) permissions[id] = choices;
  }
  return core.resolveConfirmation(pending.id, { accepted: true, permissions });
}
