import { describe, expect, it } from "vitest";
import { coreOnlyManifest, NOSCORE } from "@rpgm-tools/neo-angband-core";
import { recordControllerUse } from "./mod-controller-record";

const identity = { id: "mandos", name: "Mandos", version: "1.0.0", digest: "a".repeat(64), firstParty: false };

describe("host-owned controller attribution", () => {
  it("keeps names and trust levels distinct and retains only the newest 32 identities", () => {
    const manifest = coreOnlyManifest(); const player = { noscore: 0 };
    recordControllerUse(manifest, player, { ...identity, firstParty: true });
    recordControllerUse(manifest, player, identity);
    recordControllerUse(manifest, player, { ...identity, name: "Another name" });
    expect(manifest.autoplayers).toHaveLength(3);
    for (let index = 0; index < 33; index++) recordControllerUse(manifest, player, { ...identity, version: String(index) });
    expect(manifest.autoplayers).toHaveLength(32);
    expect(manifest.autoplayers?.[0]?.version).toBe("1");
    expect(manifest.autoplayers?.[31]?.version).toBe("32");
  });
  it("marks third-party control nondeterministic and records the measured identity", () => {
    const manifest = coreOnlyManifest(); const player = { noscore: 0 };
    recordControllerUse(manifest, player, identity);
    expect(manifest.determinism).toBe("nondeterministic");
    expect(player.noscore & NOSCORE.BORG).not.toBe(0);
    expect(manifest.autoplayers).toEqual([identity]);
    identity.name = "Changed after recording";
    expect(manifest.autoplayers?.[0]?.name).toBe("Mandos");
    identity.name = "Mandos";
    recordControllerUse(manifest, player, identity);
    expect(manifest.autoplayers).toHaveLength(1);
    recordControllerUse(manifest, player, { ...identity, digest: "b".repeat(64) });
    expect(manifest.autoplayers).toHaveLength(2);
  });

  it("marks first-party control nondeterministic and never clears earlier marks", () => {
    const manifest = coreOnlyManifest(); const player = { noscore: 0 };
    recordControllerUse(manifest, player, { ...identity, firstParty: true });
    expect(manifest.determinism).toBe("nondeterministic");
    expect(manifest.modNoscore).toBe(true);
    recordControllerUse(manifest, player, identity);
    recordControllerUse(manifest, player, { ...identity, firstParty: true });
    expect(manifest.determinism).toBe("nondeterministic");
    expect(player.noscore & NOSCORE.BORG).not.toBe(0);
  });

  it("retains permanent first-use provenance after controller history truncates", () => {
    const manifest = coreOnlyManifest(); const player = { noscore: 0 };
    const provenance = { installation: "measured-installation", activation: { turn: 12, depth: 3 } };
    recordControllerUse(manifest, player, identity, provenance);
    provenance.activation.turn = 99;
    recordControllerUse(manifest, player, identity, provenance);
    for (let index = 0; index < 40; index++) recordControllerUse(manifest, player, { ...identity, version: String(index) });
    expect(manifest.autoplayers).toHaveLength(32);
    expect(manifest.capabilityUse?.entries).toHaveLength(41);
    expect(manifest.capabilityUse?.entries[0]).toEqual({ installation: "measured-installation", id: identity.id, version: identity.version, digest: identity.digest,
      capability: "input:controller", activation: { turn: 12, depth: 3 }, consequence: "controller" });
  });

  it("preserves a future summary while applying existing score and determinism marks", () => {
    const manifest = coreOnlyManifest(); const player = { noscore: 0 };
    manifest.capabilityUse = { schema: 2, entries: [] };
    const before = structuredClone(manifest.capabilityUse);
    recordControllerUse(manifest, player, identity);
    expect(manifest.capabilityUse).toEqual(before);
    expect(manifest.modNoscore).toBe(true);
    expect(manifest.determinism).toBe("nondeterministic");
    expect(player.noscore & NOSCORE.BORG).not.toBe(0);
  });
});
