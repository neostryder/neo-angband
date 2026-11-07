import { advanceDeterminism, markNoscore, NOSCORE, type SaveManifest } from "@rpgm-tools/neo-angband-core";

type ControllerIdentity = NonNullable<SaveManifest["autoplayers"]>[number];

export function recordControllerUse(manifest: SaveManifest, player: { noscore: number }, identity: ControllerIdentity): void {
  player.noscore = markNoscore(player.noscore, NOSCORE.BORG);
  if (!(manifest.autoplayers ?? []).some((prior) => prior.id === identity.id && prior.digest === identity.digest && prior.version === identity.version && prior.firstParty === identity.firstParty && prior.name === identity.name)) {
    manifest.autoplayers = [...(manifest.autoplayers ?? []).slice(-31), { ...identity }];
  }
  if (!identity.firstParty) manifest.determinism = advanceDeterminism(manifest.determinism, true);
}
