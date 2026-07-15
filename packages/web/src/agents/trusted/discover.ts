/**
 * Discover bundled trusted in-process plugins (W2.2).
 *
 * A trusted plugin lives at packages/web/mods/<id>/trusted.ts (default-exporting
 * a TrustedPlugin) with a shape:"plugin" manifest.json declaring its registry:*
 * capabilities. Unlike a scripted plugin (sandbox/discover.ts, compiled as a
 * ?worker), it is imported as an ordinary module and runs in the host - so the
 * glob has no ?worker query and yields the module's default export directly.
 *
 * Disabled by default; the host launches one via ?trusted=<id>. The full mod
 * manager UI (enable/consent/reorder) is W2.4.
 */

import type { PackManifest } from "@neo-angband/mod-sdk";
import type { TrustedPlugin } from "./runtime";

// Each trusted.ts is imported as a plain module (its default export).
const pluginGlob = import.meta.glob("../../../mods/*/trusted.ts", {
  eager: true,
  import: "default",
}) as Record<string, TrustedPlugin>;

const manifestGlob = import.meta.glob("../../../mods/*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

/** A discovered trusted plugin: its manifest plus the loaded module. */
export interface DiscoveredTrustedPlugin {
  manifest: PackManifest;
  plugin: TrustedPlugin;
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

/** modId -> discovered trusted plugin, for every mod that ships a trusted.ts. */
export function discoverTrustedPlugins(): Map<string, DiscoveredTrustedPlugin> {
  const byId = new Map<string, DiscoveredTrustedPlugin>();

  const manifests = new Map<string, unknown>();
  for (const [key, val] of Object.entries(manifestGlob)) {
    const m = /\/mods\/([^/]+)\/manifest\.json$/.exec(key);
    if (m && m[1]) manifests.set(m[1], val);
  }

  for (const [key, plugin] of Object.entries(pluginGlob)) {
    const m = /\/mods\/([^/]+)\/trusted\.ts$/.exec(key);
    if (!m || !m[1]) continue;
    const id = m[1];
    const rawManifest = manifests.get(id);
    if (!rawManifest) {
      console.warn(`[trusted] ${id}/trusted.ts has no manifest.json; skipping`);
      continue;
    }
    const manifest = toManifest(rawManifest);
    if (manifest.shape !== "plugin") {
      console.warn(
        `[trusted] ${id} ships trusted.ts but manifest shape is "${manifest.shape}"; skipping`,
      );
      continue;
    }
    byId.set(id, { manifest, plugin });
  }

  return byId;
}
