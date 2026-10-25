import { selectFromMenu } from "../overlay";
import type { GridSurface, GridPointerInput } from "../term";
import type { ModManagerDeps } from "./classic-types";
import { classicManager } from "./classic-service";
import { drawPendingManagementConfirmation } from "./classic-confirmation";

export async function runLookChoice(term: GridSurface & GridPointerInput, deps: ModManagerDeps): Promise<void> {
  if (!deps.look) return;
  const pick = await selectFromMenu(term, "core:look-choice", "Choose your look", [
    { label: "Vanilla - Classic Angband presentation" },
    { label: "Neo Angband - AnybandUI presentation" },
  ], "[ a/b, arrows, or tap; Enter selects; ESC cancels ]");
  if (pick === null && deps.look.read().chosen) return;
  const before = deps.look.read().active;
  deps.look.choose(pick === 1 ? "Neo" : "Vanilla", deps.listCatalog().some((mod) => mod.id === "anybandui" && mod.enabled));
  const { service, core } = classicManager(deps);
  if (pick === 1) {
    service.refreshState();
    let mod = service.state.installed.find((row) => row.id === "anybandui");
    if (!mod && globalThis.navigator?.onLine !== false) {
      const catalog = await service.browse();
      if (catalog.status === "ok") {
        const entry = [...catalog.value.curated, ...catalog.value.community].find((row) => row.ok && row.mod.id === "anybandui");
        if (entry?.ok) {
          const plan = await service.planCatalogInstall([entry.ref]);
          if (plan.status === "ok" && service.applyPlan(plan.value.id).status === "confirmation") {
            await drawPendingManagementConfirmation(term, service, core);
          }
        }
      }
      service.refreshState();
      mod = service.state.installed.find((row) => row.id === "anybandui");
    }
    if (mod?.catalogMod.manifest.lookPreset) {
      deps.look.snapshot();
      const result = service.enable(mod.id);
      if (result.status === "confirmation") await drawPendingManagementConfirmation(term, service, core);
      deps.look.complete(mod.catalogMod.manifest, deps.listCatalog().some((row) => row.id === mod!.id && row.enabled));
    }
  }
  if (deps.look.read().active !== before) deps.requestReload();
}
