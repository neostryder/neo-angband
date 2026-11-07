import { advanceDeterminism, markNoscore, NOSCORE, type CapabilityUseEntry, type SaveManifest } from "@rpgm-tools/neo-angband-core";

type ControllerIdentity = NonNullable<SaveManifest["autoplayers"]>[number];

export function recordCapabilityUse(manifest: SaveManifest, entry: CapabilityUseEntry): void {
  manifest.modNoscore = true;
  /* An older host must preserve a future summary without interpreting or replacing it. */
  if (manifest.capabilityUse && manifest.capabilityUse.schema !== 1) return;
  const summary = manifest.capabilityUse ??= { schema: 1, entries: [] };
  if (!summary.entries.some((prior) => prior.installation === entry.installation && prior.id === entry.id && prior.version === entry.version && prior.digest === entry.digest && prior.capability === entry.capability && prior.consequence === entry.consequence)) {
    summary.entries.push(structuredClone(entry));
  }
}

export function recordControllerUse(manifest: SaveManifest, player: { noscore: number }, identity: ControllerIdentity, provenance?: Pick<CapabilityUseEntry, "installation" | "activation">): void {
  player.noscore = markNoscore(player.noscore, NOSCORE.BORG);
  if (!(manifest.autoplayers ?? []).some((prior) => prior.id === identity.id && prior.digest === identity.digest && prior.version === identity.version && prior.firstParty === identity.firstParty && prior.name === identity.name)) {
    manifest.autoplayers = [...(manifest.autoplayers ?? []).slice(-31), { ...identity }];
  }
  manifest.determinism = advanceDeterminism(manifest.determinism, true);
  recordCapabilityUse(manifest, { installation: provenance?.installation ?? null, id: identity.id, version: identity.version, digest: identity.digest,
    capability: "input:controller", activation: provenance?.activation ?? null, consequence: "controller" });
}
