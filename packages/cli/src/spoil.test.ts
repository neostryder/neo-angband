/**
 * Spoiler-generator guard - asserts the four wiz-spoil.c ports produce stable,
 * meaningful output. It checks STRUCTURAL invariants (headers, section titles,
 * a few well-known rows) rather than snapshotting the whole dump, which would
 * be brittle against any content tweak. It also pins determinism: the spoilers
 * are pure data dumps, so two runs must be byte-identical.
 */

import { describe, expect, it } from "vitest";
import { loadGamePack } from "./pack";
import {
  spoilArtifact,
  spoilMonDesc,
  spoilMonInfo,
  spoilObjDesc,
} from "./spoilers";
import { renderSpoiler } from "./main-spoil";

const pack = loadGamePack();

describe("spoil_obj_desc (basic items)", () => {
  const text = spoilObjDesc(pack);

  it("has the file header and column header", () => {
    expect(text.startsWith("Spoiler File -- Basic Items (")).toBe(true);
    expect(text).toContain("Description");
    expect(text).toContain("Dam/AC");
    expect(text).toContain("Cost");
  });

  it("emits the categorized section titles", () => {
    for (const title of ["Ammo", "Bows", "Weapons", "Rings", "Potions", "Scrolls"]) {
      expect(text).toContain(`\n\n${title}\n\n`);
    }
  });

  it("lists known base items", () => {
    expect(text).toContain("Dagger");
    expect(text).toContain("Ring of");
    expect(text).toMatch(/Potion of/);
  });

  it("is deterministic", () => {
    expect(spoilObjDesc(pack)).toBe(text);
  });
});

describe("spoil_artifact (artifact descriptions)", () => {
  const text = spoilArtifact(pack);

  it("has the underlined header and randart seed line", () => {
    expect(text.startsWith("Artifact Spoilers for ")).toBe(true);
    expect(text).toMatch(/^=+$/m);
    expect(text).toContain("Randart seed is");
  });

  it("emits artifact group titles", () => {
    for (const title of ["Edged Weapons", "Light Sources", "Rings", "Amulets"]) {
      expect(text).toContain(title);
    }
  });

  it("describes a well-known artifact with its stat line", () => {
    // The Phial of Galadriel is the archetypal early light-source artifact.
    expect(text).toContain("Phial");
    expect(text).toContain("of Galadriel");
    expect(text).toMatch(/Min Level \d+, Max Level \d+, Generation chance \d+, Power -?\d+, \d+\.\d+ lbs/);
  });

  it("is deterministic", () => {
    expect(spoilArtifact(pack)).toBe(text);
  });
});

describe("spoil_mon_desc (brief monster table)", () => {
  const text = spoilMonDesc(pack);

  it("has the header and column labels", () => {
    expect(text.startsWith("Monster Spoilers for ")).toBe(true);
    expect(text).toContain("Visual Info");
    expect(text).toMatch(/Name\s+Lev\s+Rar\s+Spd/);
  });

  it("includes uniques ([U]), questors ([Q]) and ordinary monsters", () => {
    expect(text).toContain("[U] Farmer Maggot");
    // Morgoth is a QUESTOR (that check precedes UNIQUE), so he is tagged [Q].
    expect(text).toContain("[Q] Morgoth, Lord of Darkness");
    expect(text).toMatch(/The .*(urchin|cat|kobold)/i);
  });

  it("is sorted by depth (first data row is a very shallow monster)", () => {
    const lines = text.split("\n");
    // First few data rows are level <= a couple; Morgoth (deepest) is far below.
    const morgothIdx = lines.findIndex((l) => l.includes("Morgoth"));
    const urchinIdx = lines.findIndex((l) => l.includes("urchin"));
    expect(urchinIdx).toBeGreaterThan(0);
    expect(morgothIdx).toBeGreaterThan(urchinIdx);
  });

  it("is deterministic", () => {
    expect(spoilMonDesc(pack)).toBe(text);
  });
});

describe("spoil_mon_info (full monster lore)", () => {
  const text = spoilMonInfo(pack);

  it("has the header", () => {
    expect(text.startsWith("Monster Spoilers for ")).toBe(true);
  });

  it("emits a per-monster stat line and lore body", () => {
    expect(text).toMatch(/=== Num:\d+ {2}Lev:\d+ {2}Rar:\d+ {2}Spd:[+-]\d+ {2}Hp:\d+ {2}Ac:\d+ {2}Exp:\d+/);
    expect(text).toContain("[Q] Morgoth, Lord of Darkness");
  });

  it("is deterministic", () => {
    expect(spoilMonInfo(pack)).toBe(text);
  });
});

describe("renderSpoiler(all)", () => {
  it("concatenates the four sections in order", () => {
    const all = renderSpoiler(pack, "all");
    const parts = [
      spoilObjDesc(pack),
      spoilArtifact(pack),
      spoilMonDesc(pack),
      spoilMonInfo(pack),
    ];
    expect(all).toBe(parts.join(""));
    // Each section's distinctive header is present.
    expect(all).toContain("Spoiler File -- Basic Items");
    expect(all).toContain("Artifact Spoilers for");
    expect(all).toContain("Monster Spoilers for");
  });

  it("selects a single kind", () => {
    expect(renderSpoiler(pack, "obj")).toBe(spoilObjDesc(pack));
    expect(renderSpoiler(pack, "mon-info")).toBe(spoilMonInfo(pack));
  });
});
