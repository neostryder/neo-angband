/**
 * Who draws each part of the HUD, and what happens when they stop.
 *
 * The map's version of this (`frontend-mod.node.test.ts`) has one slot and one
 * winner. Everything interesting here comes from there being three, so most of
 * these tests are about the seams BETWEEN regions: a mod holding one region does
 * not get the others, a mod faulting in one does not lose the rest, and two mods
 * drawing different regions are not in conflict at all.
 */

import { describe, expect, it, vi } from "vitest";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { screenRegions } from "./regions";
import {
  buildHudFrame,
  HUD_SECTION_NAMES,
  type HudFrame,
  type HudFrameParams,
  type HudSection,
  type HudSectionName,
  type HudSectionSink,
} from "./hud-view";
import {
  CORE_HUD_ID,
  coreHudCandidate,
  coreOnlyHud,
  hudCapability,
  hudClaimants,
  hudFrameSink,
  hudIsAllCore,
  hudRegionsClaimed,
  installHud,
  selectedHudPlugins,
  type HudPlugin,
} from "./hud-runtime";
import type { ModPluginContext } from "./mod-plugin";

/** A recorder standing in for core's terminal: what it was asked to draw. */
function coreSink(): HudSectionSink & { readonly drawn: HudSectionName[] } {
  const drawn: HudSectionName[] = [];
  return { drawn, present: (section) => void drawn.push(section.name) };
}

function manifest(id: string, capabilities: string[]): PackManifest {
  return { id, name: id, version: "1.0.0", shape: "plugin", capabilities };
}

const CONTEXT = (id: string): ModPluginContext => ({ id }) as unknown as ModPluginContext;

/** An 80x24 Left-sidebar screen, built by the producer main.ts uses. */
function frame(over: Partial<HudFrameParams> = {}): HudFrame {
  const cols = 80;
  const rows = 24;
  return buildHudFrame({
    layout: "left",
    cols,
    rows,
    sidebarWidth: 13,
    mapOriginX: 13,
    mapCols: cols - 13 - 1,
    vitals: [{ key: "hp", runs: [{ text: "HP 20/20", color: 4, css: "#0f0" }] }],
    placements: [{ key: "hp", row: 10 }],
    compactKeys: ["hp"],
    indicators: [{ key: "state", runs: [{ text: "Fed 89 % ", color: 1, css: "#fff" }] }],
    message: { text: "You have a mushroom.", css: "#fff" },
    regions: screenRegions({
      cols,
      rows,
      sidebar: "left",
      sidebarWidth: 13,
      mapOriginX: 13,
      mapTop: 1,
      mapCols: cols - 13 - 1,
      mapRows: rows - 2,
    }),
    ...over,
  });
}

describe("what a candidate is allowed to hold", () => {
  it("grants exactly the regions the manifest names", () => {
    const claimed = hudRegionsClaimed({
      id: "vitals",
      manifest: manifest("vitals", ["ui:sidebar.replace"]),
      plugin: { hud: () => ({}) },
    });
    expect(claimed).toEqual(["sidebar"]);
  });

  it("the wildcard grants all three, and display:replace grants NONE of them", () => {
    const wild = hudRegionsClaimed({
      id: "w",
      manifest: manifest("w", ["ui:*.replace"]),
      plugin: { hud: () => ({}) },
    });
    expect([...wild]).toEqual([...HUD_SECTION_NAMES]);

    /* THE ONE THAT MATTERS. Owning the dungeon is not owning the vitals: a mod
     * that took `display:replace` and then quietly drew over the hit points
     * would be using a consent the player gave for something else. */
    const faults: string[] = [];
    const mapOnly = hudRegionsClaimed(
      { id: "m", manifest: manifest("m", ["display:replace"]), plugin: { hud: () => ({}) } },
      (id, message) => faults.push(`${id}: ${message}`),
    );
    expect(mapOnly).toEqual([]);
    expect(faults[0]).toContain("ui:sidebar.replace");
  });

  it("reports a hud() with no ui capability ONCE, with the fix in the sentence", () => {
    const faults: string[] = [];
    const candidate: HudPlugin = {
      id: "ungated",
      manifest: manifest("ungated", ["registry:*"]),
      plugin: { hud: () => ({}) },
    };
    selectedHudPlugins([coreHudCandidate(coreSink()), candidate], (id, message) =>
      faults.push(`${id}: ${message}`),
    );
    /* Once, not once per region - three copies of "your mod is broken" reads as
     * three broken things. */
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain("declares hud() without");
    expect(faults[0]).toContain("add one of");
  });

  it("a candidate with no hud() at all claims nothing and is not a fault", () => {
    const faults: string[] = [];
    expect(
      hudRegionsClaimed(
        { id: "quiet", manifest: manifest("quiet", ["ui:*.replace"]), plugin: {} },
        (id, message) => faults.push(`${id}: ${message}`),
      ),
    ).toEqual([]);
    expect(faults).toEqual([]);
  });
});

describe("selecting each region's owner", () => {
  const core = () => coreHudCandidate(coreSink());

  it("the last claimant in load order wins, per region", () => {
    const early: HudPlugin = {
      id: "early",
      manifest: manifest("early", ["ui:*.replace"]),
      plugin: { hud: () => ({}) },
    };
    const late: HudPlugin = {
      id: "late",
      manifest: manifest("late", ["ui:sidebar.replace"]),
      plugin: { hud: () => ({}) },
    };
    const selected = selectedHudPlugins([core(), early, late]);
    expect(selected.get("sidebar")?.id).toBe("late");
    /* And the regions `late` did not ask for stay with `early` rather than
     * falling to core - the whole point of per-region ownership. */
    expect(selected.get("messages")?.id).toBe("early");
    expect(selected.get("status")?.id).toBe("early");
  });

  it("core holds every region nobody claimed", () => {
    const selected = selectedHudPlugins([core()]);
    for (const name of HUD_SECTION_NAMES) expect(selected.get(name)?.id).toBe(CORE_HUD_ID);
  });
});

describe("installing", () => {
  it("gives a mod only what it asked for, and leaves the rest drawing", () => {
    const term = coreSink();
    const sidebar: HudSectionSink = { present: () => undefined };
    const installed = installHud(
      [
        coreHudCandidate(term),
        {
          id: "vitals",
          manifest: manifest("vitals", ["ui:sidebar.replace"]),
          plugin: { hud: () => ({ sidebar }) },
        },
      ],
      CONTEXT,
      () => undefined,
    );
    expect(installed.owners.sidebar.id).toBe("vitals");
    expect(installed.owners.messages.id).toBe(CORE_HUD_ID);
    expect(installed.owners.status.id).toBe(CORE_HUD_ID);
    expect(hudIsAllCore(installed)).toBe(false);
  });

  it("REFUSES a sink for a region the manifest never asked for", () => {
    /* Without this the capability is advisory: nothing stops a returned object
     * having three keys when the manifest asked for one, and the player
     * consented to one part of their screen changing hands. */
    const faults: string[] = [];
    const sink: HudSectionSink = { present: () => undefined };
    const installed = installHud(
      [
        coreHudCandidate(coreSink()),
        {
          id: "greedy",
          manifest: manifest("greedy", ["ui:sidebar.replace"]),
          plugin: { hud: () => ({ sidebar: sink, status: sink, messages: sink }) },
        },
      ],
      CONTEXT,
      (id, message) => faults.push(`${id}: ${message}`),
    );
    expect(installed.owners.sidebar.id).toBe("greedy");
    expect(installed.owners.status.id).toBe(CORE_HUD_ID);
    expect(installed.owners.messages.id).toBe(CORE_HUD_ID);
    expect(faults).toHaveLength(2);
    expect(faults[0]).toContain(hudCapability("messages"));
  });

  it("calls hud() ONCE for a mod that wins two regions", () => {
    /* A mod's hud() may create DOM. Constructing it once per region it won would
     * leave a canvas nobody draws into, which is the defect select-before-invoke
     * exists to prevent, arriving by a different door. */
    const sink: HudSectionSink = { present: () => undefined };
    const hud = vi.fn(() => ({ sidebar: sink, status: sink }));
    installHud(
      [
        coreHudCandidate(coreSink()),
        { id: "two", manifest: manifest("two", ["ui:*.replace"]), plugin: { hud } },
      ],
      CONTEXT,
      () => undefined,
    );
    expect(hud).toHaveBeenCalledTimes(1);
  });

  it("never constructs a candidate that lost every region it claimed", () => {
    const sink: HudSectionSink = { present: () => undefined };
    const loser = vi.fn(() => ({ sidebar: sink }));
    installHud(
      [
        coreHudCandidate(coreSink()),
        { id: "early", manifest: manifest("early", ["ui:sidebar.replace"]), plugin: { hud: loser } },
        {
          id: "late",
          manifest: manifest("late", ["ui:sidebar.replace"]),
          plugin: { hud: () => ({ sidebar: sink }) },
        },
      ],
      CONTEXT,
      () => undefined,
    );
    expect(loser).not.toHaveBeenCalled();
  });

  it("a declined region goes to the GAME, not to the next claimant", () => {
    /* The documented consequence of selecting from manifests. Asserted rather
     * than left implicit, because the other answer is defensible and an author
     * reading only the code would have to guess which one this is. */
    const sink: HudSectionSink = { present: () => undefined };
    const installed = installHud(
      [
        coreHudCandidate(coreSink()),
        {
          id: "early",
          manifest: manifest("early", ["ui:sidebar.replace"]),
          plugin: { hud: () => ({ sidebar: sink }) },
        },
        {
          id: "late",
          manifest: manifest("late", ["ui:sidebar.replace"]),
          plugin: { hud: () => undefined },
        },
      ],
      CONTEXT,
      () => undefined,
    );
    expect(installed.owners.sidebar.id).toBe(CORE_HUD_ID);
  });

  it("a throwing hud() is that mod's fault and costs it nothing else", () => {
    const faults: string[] = [];
    const installed = installHud(
      [
        coreHudCandidate(coreSink()),
        {
          id: "boom",
          manifest: manifest("boom", ["ui:*.replace"]),
          plugin: {
            hud: () => {
              throw new Error("no document");
            },
          },
        },
      ],
      CONTEXT,
      (id, message) => faults.push(`${id}: ${message}`),
    );
    expect(hudIsAllCore(installed)).toBe(true);
    expect(faults[0]).toContain("boom: hud() failed");
  });

  it("refuses a candidate list that does not start with core", () => {
    expect(() => installHud([], CONTEXT, () => undefined)).toThrow(/candidate zero/u);
  });

  it("core wins through the same call as anyone else", () => {
    /* If the seam could not express the HUD the game already ships, "a mod can
     * replace the vitals" would be a claim about a shape nobody had built. */
    const term = coreSink();
    const installed = installHud([coreHudCandidate(term)], CONTEXT, () => undefined);
    expect(hudIsAllCore(installed)).toBe(true);
    hudFrameSink(installed, () => undefined).present(frame());
    expect(term.drawn).toEqual(["messages", "sidebar", "status"]);
  });
});

describe("routing a live frame", () => {
  it("hands each owner its own section, and the frame it came from", () => {
    const term = coreSink();
    const seen: { section: HudSection; frame: HudFrame }[] = [];
    const installed = installHud(
      [
        coreHudCandidate(term),
        {
          id: "vitals",
          manifest: manifest("vitals", ["ui:sidebar.replace"]),
          plugin: {
            hud: () => ({ sidebar: { present: (section, f) => void seen.push({ section, frame: f }) } }),
          },
        },
      ],
      CONTEXT,
      () => undefined,
    );

    hudFrameSink(installed, () => undefined).present(frame());

    expect(seen).toHaveLength(1);
    expect(seen[0]!.section.name).toBe("sidebar");
    expect(seen[0]!.section.entries[0]?.key).toBe("hp");
    /* The section it is handed IS the frame's own field, so a consumer may reach
     * it either way without the two disagreeing. */
    expect(seen[0]!.section).toBe(seen[0]!.frame.sidebar);
    /* Core kept the other two, and did NOT redraw the one it lost. */
    expect(term.drawn).toEqual(["messages", "status"]);
  });

  it("what crosses the boundary is frozen, so a retained frame cannot be mutated", () => {
    const kept: HudFrame[] = [];
    const installed = installHud(
      [
        coreHudCandidate(coreSink()),
        {
          id: "vitals",
          manifest: manifest("vitals", ["ui:sidebar.replace"]),
          plugin: { hud: () => ({ sidebar: { present: (_s, f) => void kept.push(f) } }) },
        },
      ],
      CONTEXT,
      () => undefined,
    );
    hudFrameSink(installed, () => undefined).present(frame());

    const held = kept[0]!;
    expect(Object.isFrozen(held)).toBe(true);
    expect(Object.isFrozen(held.sidebar)).toBe(true);
    expect(Object.isFrozen(held.sidebar!.entries[0])).toBe(true);
    expect(Object.isFrozen(held.sidebar!.entries[0]!.runs[0])).toBe(true);
    expect(held.sidebar!.entries[0]!.runs[0]!.color).toBe(4);
  });

  it("two owners of one frame get the SAME snapshot, built once", () => {
    const frames: HudFrame[] = [];
    const record: HudSectionSink = { present: (_s, f) => void frames.push(f) };
    const installed = installHud(
      [
        coreHudCandidate(coreSink()),
        {
          id: "two",
          manifest: manifest("two", ["ui:*.replace"]),
          plugin: { hud: () => ({ sidebar: record, status: record }) },
        },
      ],
      CONTEXT,
      () => undefined,
    );
    hudFrameSink(installed, () => undefined).present(frame());
    expect(frames).toHaveLength(2);
    expect(frames[0]).toBe(frames[1]);
  });

  it("a fault costs THAT region and no other, for the rest of the session", () => {
    /* The blast radius is the whole point. Losing your hit points because the
     * mod drawing the status line threw would be a bigger loss than the grant. */
    const term = coreSink();
    const faults: string[] = [];
    const good: HudSectionName[] = [];
    const installed = installHud(
      [
        coreHudCandidate(term),
        {
          id: "two",
          manifest: manifest("two", ["ui:*.replace"]),
          plugin: {
            hud: () => ({
              sidebar: { present: (s) => void good.push(s.name) },
              status: {
                present: () => {
                  throw new Error("bad draw");
                },
              },
            }),
          },
        },
      ],
      CONTEXT,
      () => undefined,
    );

    const sink = hudFrameSink(installed, (id, message) => faults.push(`${id}: ${message}`));
    sink.present(frame());
    sink.present(frame());

    /* Reported ONCE and recovered permanently: a sink rebuilt every repaint
     * would re-enter the throwing mod - and re-report it - on every frame. */
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain("drawing the status failed");
    /* The sidebar kept working across the fault, and core drew the status both
     * times: the failing frame's own repaint, then every one after it. */
    expect(good).toEqual(["sidebar", "sidebar"]);
    expect(term.drawn).toEqual(["messages", "status", "messages", "status"]);
  });

  it("the unmodded path is core's, unwrapped", () => {
    const term = coreSink();
    const installed = coreOnlyHud(term);
    expect(hudIsAllCore(installed)).toBe(true);
    hudFrameSink(installed, () => undefined).present(frame());
    expect(term.drawn).toEqual(["messages", "sidebar", "status"]);
  });

  it("a region the layout does not have is nobody's to draw", () => {
    /* Under the None sidebar mode there is no vitals section at all, and an
     * owner being called with an empty one would be the "quiet vs absent"
     * confusion the frame exists to avoid. */
    const called: string[] = [];
    const installed = installHud(
      [
        coreHudCandidate(coreSink()),
        {
          id: "vitals",
          manifest: manifest("vitals", ["ui:sidebar.replace"]),
          plugin: { hud: () => ({ sidebar: { present: (s) => void called.push(s.name) } }) },
        },
      ],
      CONTEXT,
      () => undefined,
    );
    hudFrameSink(installed, () => undefined).present(frame({ layout: "none" }));
    expect(called).toEqual([]);
  });
});

describe("who is contesting what", () => {
  it("two mods on different regions are not in conflict", () => {
    const claimants = hudClaimants([
      coreHudCandidate(coreSink()),
      {
        id: "vitals",
        manifest: manifest("vitals", ["ui:sidebar.replace"]),
        plugin: { hud: () => ({}) },
      },
      {
        id: "ticker",
        manifest: manifest("ticker", ["ui:status.replace"]),
        plugin: { hud: () => ({}) },
      },
    ]);
    const byRegion = new Map(claimants.map((c) => [c.region, c.ids]));
    expect(byRegion.get("sidebar")).toEqual([CORE_HUD_ID, "vitals"]);
    expect(byRegion.get("status")).toEqual([CORE_HUD_ID, "ticker"]);
    expect(byRegion.get("messages")).toEqual([CORE_HUD_ID]);
  });

  it("a refused claim is not a contender", () => {
    /* Counting it would tell the player two mods are fighting over the vitals
     * when only one of them can ever hold them. */
    const claimants = hudClaimants([
      coreHudCandidate(coreSink()),
      { id: "ungated", manifest: manifest("ungated", []), plugin: { hud: () => ({}) } },
    ]);
    for (const { ids } of claimants) expect(ids).toEqual([CORE_HUD_ID]);
  });
});
