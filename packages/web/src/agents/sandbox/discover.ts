/**
 * Discover bundled scripted-plugin mods (MOD_INTEGRATION_PLAN.md Wave 2, W2.1).
 *
 * A scripted plugin lives at packages/web/mods/<id>/ with a plugin.ts entry and
 * a shape:"plugin" manifest.json declaring its capabilities. Vite compiles each
 * plugin.ts as its own module worker (the "?worker" glob query), so the host
 * gets a Worker constructor per plugin and never has to dynamically import
 * untrusted code by URL. The manifest supplies the capability grant the host
 * turns into a CapabilitySet.
 *
 * Disabled by default; the host launches one via ?plugin=<id>. The full mod
 * manager UI (enable/consent/reorder) is W2.4.
 */

import type { PackManifest } from "@neo-angband/mod-sdk";

// Each plugin.ts becomes a module-Worker constructor (Vite ?worker).
const workerGlob = import.meta.glob("../../../mods/*/plugin.ts", {
  eager: true,
  query: "?worker",
  import: "default",
}) as Record<string, new () => Worker>;

const manifestGlob = import.meta.glob("../../../mods/*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

/** A discovered scripted plugin: its manifest plus a worker factory. */
export interface DiscoveredPlugin {
  manifest: PackManifest;
  /** Instantiate a fresh module worker for this plugin. */
  createWorker: () => Worker;
}

function toManifest(raw: unknown): PackManifest {
  const m = raw as Partial<PackManifest> & { id?: string };
  return {
    id: m.id ?? "plugin",
    name: m.name ?? m.id ?? "plugin",
    version: m.version ?? "0.0.0",
    shape: m.shape ?? "plugin",
    ...(m.engine ? { engine: m.engine } : {}),
    ...(m.dependencies ? { dependencies: m.dependencies } : {}),
    ...(m.capabilities ? { capabilities: m.capabilities } : {}),
    ...(m.nondeterministic ? { nondeterministic: m.nondeterministic } : {}),
  };
}

/** modId -> discovered plugin, for every mod that ships a plugin.ts. */
export function discoverPlugins(): Map<string, DiscoveredPlugin> {
  const byId = new Map<string, DiscoveredPlugin>();

  const manifests = new Map<string, unknown>();
  for (const [key, val] of Object.entries(manifestGlob)) {
    const m = /\/mods\/([^/]+)\/manifest\.json$/.exec(key);
    if (m && m[1]) manifests.set(m[1], val);
  }

  for (const [key, ctor] of Object.entries(workerGlob)) {
    const m = /\/mods\/([^/]+)\/plugin\.ts$/.exec(key);
    if (!m || !m[1]) continue;
    const id = m[1];
    const rawManifest = manifests.get(id);
    if (!rawManifest) {
      console.warn(`[plugins] ${id}/plugin.ts has no manifest.json; skipping`);
      continue;
    }
    const manifest = toManifest(rawManifest);
    if (manifest.shape !== "plugin") {
      console.warn(`[plugins] ${id} ships plugin.ts but manifest shape is "${manifest.shape}"; skipping`);
      continue;
    }
    byId.set(id, { manifest, createWorker: () => new ctor() });
  }

  return byId;
}
