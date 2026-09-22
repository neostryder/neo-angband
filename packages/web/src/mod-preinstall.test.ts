/**
 * The pre-install summary (docs/modding/MOD_LIFECYCLE.md's paste-a-URL design):
 * what a candidate mod adds, patches, replaces and removes against the
 * player's current load order, its capabilities in plain language, and any
 * declared conflict with what is already enabled.
 */

import { describe, expect, it } from "vitest";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { DiscoveredMod } from "./mod-discover";
import {
  buildPreInstallSummary,
  candidateContentTouches,
  type ContentTouches,
} from "./mod-preinstall";

function manifest(id: string, extra: Partial<PackManifest> = {}): PackManifest {
  return { id, name: id, version: "1.0.0", shape: "content", ...extra };
}

function mod(over: Partial<DiscoveredMod> = {}): DiscoveredMod {
  return {
    repo: "somebody/neo-angband-mod-frost",
    tag: "v1.0.0",
    tags: ["v1.0.0"],
    id: "frost",
    name: "Frost Pack",
    author: "somebody",
    version: "1.0.0",
    description: "Cold things.",
    engine: ">=0.18.0",
    screenshots: [],
    compatible: true,
    engineNote: null,
    channelHeld: null,
    engineHeld: null,
    payload: [{ kind: "file", path: "manifest.json" }],
    bytes: 100,
    guessedPayload: false,
    ...over,
  };
}

/** A fake `readRepoFile`, keyed by path, that throws for anything not listed. */
function fakeReader(files: Record<string, string>): (repo: string, tag: string, path: string) => Promise<string> {
  return async (_repo, _tag, path) => {
    const body = files[path];
    if (body === undefined) throw new Error(`${path}: not there (HTTP 404)`);
    return body;
  };
}

describe("candidateContentTouches", () => {
  it("counts new records, per content file", async () => {
    const read = fakeReader({
      "manifest.json": "{}",
      "monster.json": JSON.stringify({ records: [{ name: "frost-wyrm" }, { name: "frost-imp" }] }),
      "item.json": JSON.stringify({ records: [{ name: "frost-brand" }] }),
    });
    const m = mod({
      payload: [
        { kind: "file", path: "manifest.json" },
        { kind: "file", path: "monster.json" },
        { kind: "file", path: "item.json" },
      ],
    });
    const touches = await candidateContentTouches(m, new Set(), read);
    expect(touches.adds).toEqual(
      expect.arrayContaining([
        { file: "monster.json", count: 2 },
        { file: "item.json", count: 1 },
      ]),
    );
    expect(touches.patches).toEqual([]);
    expect(touches.replaces).toEqual([]);
    expect(touches.removes).toEqual([]);
    expect(touches.unreadable).toEqual([]);
  });

  it("reports a patched, replaced and removed ref, with its owner", async () => {
    const read = fakeReader({
      "manifest.json": "{}",
      "monster.json": JSON.stringify({
        patches: { "core:kobold": { hp: 20 } },
        replaces: { "core:jelly": { name: "Jelly, but worse" } },
        removes: ["core:newt"],
      }),
    });
    const m = mod({
      payload: [
        { kind: "file", path: "manifest.json" },
        { kind: "file", path: "monster.json" },
      ],
    });
    const touches = await candidateContentTouches(m, new Set(), read);
    expect(touches.patches).toEqual([
      { ref: "core:kobold", file: "monster.json", owner: "core", ownerEnabled: true },
    ]);
    expect(touches.replaces).toEqual([
      { ref: "core:jelly", file: "monster.json", owner: "core", ownerEnabled: true },
    ]);
    expect(touches.removes).toEqual([
      { ref: "core:newt", file: "monster.json", owner: "core", ownerEnabled: true },
    ]);
  });

  it("flags a touched record whose owning mod is not currently enabled", async () => {
    const read = fakeReader({
      "manifest.json": "{}",
      "monster.json": JSON.stringify({ patches: { "other-mod:kobold": { hp: 30 } } }),
    });
    const m = mod({
      payload: [
        { kind: "file", path: "manifest.json" },
        { kind: "file", path: "monster.json" },
      ],
    });
    const enabledElsewhere = await candidateContentTouches(m, new Set(["other-mod"]), read);
    expect(enabledElsewhere.patches[0]?.ownerEnabled).toBe(true);

    const notEnabled = await candidateContentTouches(m, new Set(), read);
    expect(notEnabled.patches).toEqual([
      { ref: "other-mod:kobold", file: "monster.json", owner: "other-mod", ownerEnabled: false },
    ]);
  });

  it("folds a section's own patches/replaces/removes into the same file", async () => {
    const read = fakeReader({
      "manifest.json": "{}",
      "monster.json": JSON.stringify({
        sections: {
          "kobold-rebalance": { patches: { "core:kobold": { hp: 25 } } },
        },
      }),
    });
    const m = mod({
      payload: [
        { kind: "file", path: "manifest.json" },
        { kind: "file", path: "monster.json" },
      ],
    });
    const touches = await candidateContentTouches(m, new Set(), read);
    expect(touches.patches).toEqual([
      { ref: "core:kobold", file: "monster.json", owner: "core", ownerEnabled: true },
    ]);
  });

  it("skips manifest.json and load-order.json, and archive payload entries", async () => {
    let calls = 0;
    const read = async (): Promise<string> => {
      calls++;
      return "{}";
    };
    const m = mod({
      payload: [
        { kind: "file", path: "manifest.json" },
        { kind: "file", path: "load-order.json" },
        { kind: "archive", path: "tiles.zip" },
      ],
    });
    await candidateContentTouches(m, new Set(), read);
    expect(calls).toBe(0);
  });

  it("reports an unreadable content file rather than silently under-reporting", async () => {
    const read = fakeReader({ "manifest.json": "{}" }); // monster.json is NOT listed
    const m = mod({
      payload: [
        { kind: "file", path: "manifest.json" },
        { kind: "file", path: "monster.json" },
      ],
    });
    const touches = await candidateContentTouches(m, new Set(), read);
    expect(touches.unreadable).toEqual([{ file: "monster.json", problem: expect.stringContaining("404") }]);
    expect(touches.patches).toEqual([]);
  });

  it("reports invalid JSON as unreadable rather than throwing", async () => {
    const read = fakeReader({ "manifest.json": "{}", "monster.json": "not json {" });
    const m = mod({
      payload: [
        { kind: "file", path: "manifest.json" },
        { kind: "file", path: "monster.json" },
      ],
    });
    const touches = await candidateContentTouches(m, new Set(), read);
    expect(touches.unreadable).toHaveLength(1);
    expect(touches.unreadable[0]?.file).toBe("monster.json");
  });
});

describe("buildPreInstallSummary", () => {
  it("describes requested capabilities in capability-describe.ts's own words", async () => {
    const m = mod({ capabilities: ["command:add", "network:*"] });
    const summary = await buildPreInstallSummary(m, [], fakeReader({}));
    expect(summary.capabilities).toEqual([
      { cap: "command:add", text: "Add new player commands", elevated: false },
      {
        cap: "network:*",
        text: "Send network requests to ANY host (your data could leave this device)",
        elevated: true,
      },
    ]);
  });

  it("carries the manifest's license through untouched", async () => {
    const m = mod({ license: "CC-BY-4.0" });
    const summary = await buildPreInstallSummary(m, [], fakeReader({}));
    expect(summary.license).toBe("CC-BY-4.0");
  });

  it("says nothing about a license when the manifest states none", async () => {
    const m = mod({ license: null });
    const summary = await buildPreInstallSummary(m, [], fakeReader({}));
    expect(summary.license).toBeNull();
  });

  it("finds a conflict the CANDIDATE declares against an already-enabled mod", async () => {
    const m = mod({
      id: "frost",
      compat: [{ with: "flame", claim: "conflicts", because: "both rewrite fire damage types" }],
    });
    const enabled = [manifest("flame")];
    const summary = await buildPreInstallSummary(m, enabled, fakeReader({}));
    expect(summary.conflicts).toEqual([
      { packId: "frost", with: "flame", because: "both rewrite fire damage types" },
    ]);
  });

  it("finds a conflict an ALREADY-ENABLED mod declares against the candidate", async () => {
    const m = mod({ id: "frost", compat: [] });
    const enabled = [
      manifest("flame", {
        compat: [{ with: "frost", claim: "conflicts", because: "both rewrite fire damage types" }],
      }),
    ];
    const summary = await buildPreInstallSummary(m, enabled, fakeReader({}));
    expect(summary.conflicts).toEqual([
      { packId: "flame", with: "frost", because: "both rewrite fire damage types" },
    ]);
  });

  it("reports no conflict when the named mod is not actually enabled", async () => {
    const m = mod({
      id: "frost",
      compat: [{ with: "flame", claim: "conflicts", because: "both rewrite fire damage types" }],
    });
    const summary = await buildPreInstallSummary(m, [], fakeReader({}));
    expect(summary.conflicts).toEqual([]);
  });

  it("combines content touches with capabilities and conflicts in one summary", async () => {
    const read = fakeReader({
      "manifest.json": "{}",
      "monster.json": JSON.stringify({
        records: [{ name: "frost-wyrm" }],
        patches: { "core:kobold": { hp: 20 } },
      }),
    });
    const m = mod({
      id: "frost",
      capabilities: ["event:turn-start"],
      payload: [
        { kind: "file", path: "manifest.json" },
        { kind: "file", path: "monster.json" },
      ],
    });
    const summary = await buildPreInstallSummary(m, [], read);
    const content: ContentTouches = summary.content;
    expect(content.adds).toEqual([{ file: "monster.json", count: 1 }]);
    expect(content.patches).toEqual([
      { ref: "core:kobold", file: "monster.json", owner: "core", ownerEnabled: true },
    ]);
    expect(summary.capabilities).toEqual([
      { cap: "event:turn-start", text: 'Observe the "turn-start" game event', elevated: false },
    ]);
  });
});
