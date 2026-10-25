import type { SaveModList } from "@rpgm-tools/neo-angband-mod-sdk";
import { selectFromMenu, showTextScreen } from "../overlay";
import type { GridSurface, GridPointerInput } from "../term";
import type { ModManagerDeps } from "./classic-types";
import { classicManager } from "./classic-service";
import { drawPendingManagementConfirmation } from "./classic-confirmation";
import { wrapped } from "./classic-mod-views";
import { sameModList } from "./mod-lists";
import { UI_BAD } from "../ui-colors";

export async function restoreModListScreen(term: GridSurface & GridPointerInput, deps: ModManagerDeps, list: SaveModList): Promise<boolean> {
  const { service, core } = classicManager(deps);
  const result = await service.planRestoreModList(list);
  if (result.status !== "ok") {
    if (result.status === "refused") await showTextScreen(term, "Restore my mods", wrapped(result.reason, term.size().cols - 2));
    return false;
  }
  const plan = result.value;
  for (const mod of plan.unavailable) {
    const pick = await selectFromMenu(term, "core:restore-save-mods", "Restore my mods", [
      { label: `${mod.name} - continue without it` }, { label: "Cancel" },
    ], "[ a/b or tap; ESC cancels ]");
    if (pick !== 0) return false;
  }
  const pending = service.applyModListPlan(plan.id, plan.unavailable.map((m) => m.id));
  if (pending.status !== "confirmation") return false;
  const applied = await drawPendingManagementConfirmation(term, service, core);
  if (applied.status !== "ok") {
    if (applied.status === "refused") await showTextScreen(term, "Restore my mods", wrapped(applied.reason, term.size().cols - 2));
    return false;
  }
  if (list.name.trim()) deps.modLists?.save(list);
  return true;
}

export async function prepareSaveModList(term: GridSurface & GridPointerInput, deps: ModManagerDeps, saved: SaveModList | undefined, transactionNotice?: string | null): Promise<{ readonly load: boolean; readonly allowOverwrite: boolean }> {
  if (transactionNotice) await showTextScreen(term, {
    id: "core:mod-transaction-notice", title: "Mods", footer: "[ Press ESC to return ]",
    blocks: [{ kind: "text", paragraphs: [[{ text: transactionNotice }]], color: UI_BAD }],
  });
  if (!saved) return { load: true, allowOverwrite: false };
  const { service } = classicManager(deps);
  const current = await service.captureModList();
  if (sameModList(saved, current)) return { load: true, allowOverwrite: false };
  const choice = await selectFromMenu(term, "core:restore-save-mods", "This character used different mods", [
    { label: "Restore my mods" }, { label: "Continue with current mods" }, { label: "Cancel" },
  ], "[ a/b/c or tap; ESC cancels ]");
  if (choice === null || choice === 2) return { load: false, allowOverwrite: false };
  if (choice === 0 && !(await restoreModListScreen(term, deps, saved))) return { load: false, allowOverwrite: false };
  if (service.state.staged) return { load: true, allowOverwrite: false };
  const after = await service.captureModList();
  if (sameModList(saved, after)) return { load: true, allowOverwrite: false };
  const overwrite = await selectFromMenu(term, "core:mod-set-overwrite", "Save with different mods?", [
    { label: "Continue and keep the last good save" }, { label: "Continue and allow saves with these mods" }, { label: "Cancel" },
  ], "[ a/b/c or tap; ESC cancels ]");
  return { load: overwrite === 0 || overwrite === 1, allowOverwrite: overwrite === 1 };
}
