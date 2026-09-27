/** The enabled host list, with only manifest-approved rule values. */
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";

export function publicModList(
  enabled: readonly string[],
  manifests: ReadonlyMap<string, PackManifest>,
  loaded: ReadonlySet<string>,
  flags: ReadonlyMap<string, Readonly<Record<string, boolean>>>,
) {
  return Object.freeze(enabled.flatMap((id) => {
    const manifest = manifests.get(id);
    if (!loaded.has(id) || !manifest) return [];
    const declared = manifest.publicFlags ?? [];
    const current = flags.get(id) ?? {};
    return [Object.freeze({
      id, version: manifest.version,
      ...(declared.length ? { flags: Object.freeze(Object.fromEntries(declared.map((flag) => [flag, current[flag] ?? false]))) } : {}),
    })];
  }));
}
