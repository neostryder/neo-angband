import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KF } from "../generated";
import { ObjRegistry } from "./bind";
import type { ObjPackJson } from "./types";
import { doRandart } from "./randart";
import { collectArtifactData, artifactPower } from "./randart-data";
import { Rng } from "../rng";
import type { Artifact } from "./types";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

function makeReg(): ObjRegistry {
  return new ObjRegistry({
    objectBase: loadJson("object_base"),
    object: loadJson("object"),
    egoItem: loadJson("ego_item"),
    artifact: loadJson("artifact"),
    curse: loadJson("curse"),
    brand: loadJson("brand"),
    slay: loadJson("slay"),
    activation: loadJson("activation"),
    objectProperty: loadJson("object_property"),
    flavor: loadJson("flavor"),
  } as ObjPackJson);
}

/** A comparable fingerprint of a generated artifact set (order-sensitive). */
function fingerprint(arts: (Artifact | null)[]): string {
  return arts
    .map((a) =>
      a
        ? [
            a.name,
            a.tval,
            a.sval,
            a.toH,
            a.toD,
            a.toA,
            a.ac,
            a.dd,
            a.ds,
            a.allocProb,
            a.allocMin,
            a.allocMax,
            a.modifiers.join(","),
            a.flags.count(),
          ].join("|")
        : "null",
    )
    .join("\n");
}

describe("do_randart (obj-randart.c L3154)", () => {
  it("is deterministic: the same seed yields the same artifact set", () => {
    const reg = makeReg();
    const a = doRandart(reg, 4242);
    const b = doRandart(reg, 4242);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("is seed-sensitive: different seeds yield different sets", () => {
    const reg = makeReg();
    const a = doRandart(reg, 1);
    const b = doRandart(reg, 999999);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("never mutates the registry's standard artifacts", () => {
    const reg = makeReg();
    const before = reg.artifacts.map((a) => (a ? `${a.name}|${a.toH}|${a.toD}` : "null"));
    doRandart(reg, 777);
    const after = reg.artifacts.map((a) => (a ? `${a.name}|${a.toH}|${a.toD}` : "null"));
    expect(after).toEqual(before);
  });

  it("returns a full set of valid artifacts on valid base items", () => {
    const reg = makeReg();
    const arts = doRandart(reg, 55);
    expect(arts.length).toBe(reg.artifacts.length);
    expect(arts[0]).toBeNull();

    let designed = 0;
    for (let i = 1; i < arts.length; i++) {
      const a = arts[i];
      if (!a) continue;
      /* Every artifact sits on a real base kind... */
      const kind = reg.lookupKind(a.tval, a.sval);
      expect(kind, `artifact ${i} (${a.name}) has a base kind`).toBeTruthy();
      /* Fixed artifacts (The One Ring, quest artifacts) are skipped by
       * design_artifact and keep their original alloc values; only assert the
       * rarity bounds on the freshly designed ones. */
      const fixed =
        a.name.includes("One Ring") ||
        (kind !== null && kind.kindFlags.has(KF.QUEST_ART));
      if (fixed) continue;
      designed++;
      expect(a.allocProb).toBeGreaterThanOrEqual(1);
      expect(a.allocProb).toBeLessThanOrEqual(99);
      expect(a.allocMax).toBeLessThanOrEqual(127);
    }
    /* The bulk of the set was actually redesigned. */
    expect(designed).toBeGreaterThan(reg.artifacts.length / 2);
  });

  it("preserves fixed artifacts (The One Ring keeps its name)", () => {
    const reg = makeReg();
    const oneRing = reg.artifacts.find((a) => a?.name.includes("One Ring"));
    if (!oneRing) return; /* pack without it: nothing to assert */
    const arts = doRandart(reg, 31337);
    expect(arts.some((a) => a?.name.includes("One Ring"))).toBe(true);
  });
});

describe("collect_artifact_data (obj-randart.c L1059)", () => {
  it("measures the standard set into a sane power profile", () => {
    const reg = makeReg();
    const data = collectArtifactData(reg, new Rng(1, { quick: true }));
    /* The standard set spans a real power range. */
    expect(data.maxPower).toBeGreaterThan(data.minPower);
    expect(data.avgPower).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);
    /* base_power is filled for every artifact index. */
    for (let i = 1; i < reg.artifacts.length; i++) {
      if (reg.artifacts[i]) {
        expect(Number.isFinite(data.basePower[i])).toBe(true);
      }
    }
  });

  it("artifact_power rates a real artifact positively", () => {
    const reg = makeReg();
    const art = reg.artifacts.find((a) => a) as Artifact;
    expect(artifactPower(reg, art)).toBeGreaterThan(0);
  });
});
