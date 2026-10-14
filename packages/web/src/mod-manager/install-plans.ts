import { satisfies, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { declaredConflicts } from "./state-rules";
import { installBlocked } from "../mod-consent";
import { originConflict } from "../mod-source";
import type { BrowseEntry } from "./browse-types";
import type { CatalogMod } from "../mod-store";
import type { ModOrigin } from "../mod-consent";
import type { InstalledModMeta } from "../mod-install";
import { permissionConfirmation, refused } from "./confirmation";
import type { InstallPlan, ManagerResult, ModManagerEnvironment, PlannedDownload } from "./types";

export async function resolveInstallPlan(
  env: ModManagerEnvironment,
  roots: readonly { readonly entry: BrowseEntry; readonly origin: ModOrigin }[],
  catalog: readonly CatalogMod[],
  metadata: readonly InstalledModMeta[],
  id: number,
  operation: InstallPlan["operation"],
): Promise<ManagerResult<InstallPlan>> {
  if (!env.readManifest) return refused("unavailable", "The host cannot read mod manifests.");
  const downloads = new Map<string, PlannedDownload>();
  const visiting = new Set<string>();
  const rootIds = new Set(roots.filter((r) => r.entry.ok).map((r) => r.entry.ok ? r.entry.mod.id : ""));
  const visit = async (entry: BrowseEntry, origin: ModOrigin): Promise<ManagerResult> => {
    if (!entry.ok) return refused("discovery", entry.problem);
    const mod = entry.mod;
    if (!mod.compatible) return refused("engine", mod.engineNote ?? "This mod will not run on this version of the game.");
    const blocked = installBlocked(origin, env.consent?.read() ?? false);
    if (blocked) return refused("consent", blocked);
    const pin = originConflict(metadata.find((m) => m.id === mod.id) ?? null, mod.repo);
    if (pin) return refused("origin", pin);
    if (visiting.has(mod.id)) return refused("dependency-cycle", "The required mods have a dependency cycle.");
    const existing = downloads.get(mod.id);
    if (existing) {
      if (existing.mod.tag !== mod.tag || existing.mod.repo.toLowerCase() !== mod.repo.toLowerCase()) {
        return refused("dependency-version", "The required mods need different versions of the same mod.");
      }
      return { status: "ok", value: null };
    }
    visiting.add(mod.id);
    const manifest = await env.readManifest!(mod);
    if (manifest.id !== mod.id || manifest.version !== mod.version) {
      return refused("manifest", "The manifest changed after discovery.");
    }
    downloads.set(mod.id, {
      mod, manifest, origin, bytes: mod.bytes,
      files: mod.payload.map((file) => file.path),
    });
    for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
      if (dependency === "core") continue;
      const installed = catalog.find((m) => m.id === dependency && !m.missing);
      const planned = downloads.get(dependency);
      if (!rootIds.has(dependency) && !planned && installed && satisfies(installed.version, range)) continue;
      const root = roots.find((r) => r.entry.ok && r.entry.mod.id === dependency);
      if (root) {
        const result = await visit(root.entry, root.origin);
        if (result.status !== "ok") return result;
      } else if (!planned) {
        if (!env.resolveDependency) return refused("dependency", "A required mod has no repository to download from.");
        const result = await visit(await env.resolveDependency(dependency, range), "third-party");
        if (result.status !== "ok") return result;
      } else if (visiting.has(dependency)) {
        return refused("dependency-cycle", "The required mods have a dependency cycle.");
      }
      if (!satisfies(downloads.get(dependency)!.manifest.version, range)) {
        return refused("dependency-version", "A required mod does not satisfy its version constraint.");
      }
    }
    visiting.delete(mod.id);
    return { status: "ok", value: null };
  };
  for (const root of roots) {
    const result = await visit(root.entry, root.origin);
    if (result.status !== "ok") return result;
  }
  const order: PlannedDownload[] = [];
  const ordered = new Set<string>();
  const append = (download: PlannedDownload): void => {
    if (ordered.has(download.mod.id)) return;
    ordered.add(download.mod.id);
    for (const dependency of Object.keys(download.manifest.dependencies ?? {})) {
      const found = downloads.get(dependency);
      if (found) append(found);
    }
    order.push(download);
  };
  downloads.forEach(append);
  const manifests: PackManifest[] = catalog.filter((m) => m.enabled && !downloads.has(m.id)).map((m) => m.manifest);
  manifests.push(...order.map((d) => d.manifest));
  const newGrants = order.flatMap(({ mod, manifest }) => {
    const decided = env.store.getDecisions(mod.id);
    return (manifest.capabilities ?? []).filter((cap) => !decided.granted.includes(cap) && !decided.refused.includes(cap))
      .map((cap) => permissionConfirmation(mod.id, cap));
  });
  return { status: "ok", value: { id, operation, downloads: order, newGrants, conflicts: declaredConflicts(manifests) } };
}
