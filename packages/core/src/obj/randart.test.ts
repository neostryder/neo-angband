import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELEM, KF, OF } from "../generated";
import { ObjRegistry } from "./bind";
import type { ObjPackJson } from "./types";
import { buildCurseTimedFoil } from "./object";
import { doRandart, artifactGenName, RANDNAME_TOLKIEN } from "./randart";
import {
  EFPROP,
  removeContradictory,
  removeContradictoryActivation,
} from "./randart-build";
import { buildProb } from "./randname";
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

/**
 * The RANDNAME_TOLKIEN corpus (names.txt section 1), as compiled into the
 * content pack. build_prob is order-insensitive, so the parser's list reversal
 * is irrelevant here.
 */
interface NamesJson {
  records: { section: number; word: string[] }[];
}
function loadTolkienWords(): string[] {
  const names = loadJson<NamesJson>("names");
  const sec = names.records.find((r) => r.section === RANDNAME_TOLKIEN);
  return sec ? sec.word : [];
}

describe("artifact_gen_name (obj-randart.c L2713)", () => {
  /*
   * Golden vectors from an INDEPENDENT Python oracle
   * (scratchpad/oracle.py: a from-scratch reimplementation of the quick LCRNG
   * z-rand.c, build_prob + randname_make randname.c, my_strcap + one_in_(3)
   * obj-randart.c) fed the same names.json section-1 corpus. Matching these
   * byte-for-byte cross-verifies that artifactGenName reproduces upstream's
   * artifact_gen_name for a given RNG state and the real Tolkien word list.
   */
  const GOLDEN: Record<number, string[]> = {
    1: ["'Dolmir'", "of Alarn", "of Eruth", "'Borost'", "'Nedrin'", "of Mithil", "of Aerufin", "'Aldir'"],
    42: ["of Garyar", "of Calannar", "'Glair'", "of Amardorim", "'Duinas'", "of Istar", "of Tirya", "of Rastir"],
    4242: ["of Turthalda", "of Calaiad", "of Lantand", "'Gormelob'", "of Mendiryar", "of Nelmablur", "of Vanwe", "of Maren"],
    31337: ["'Galen'", "'Ondambar'", "'Norim'", "'Gwede'", "of Glirith", "of Narevori", "of Hallos", "of Finangor"],
    777: ["'Loste'", "of Naran", "of Arament", "'Nienya'", "of Ekkas", "of Huros", "of Hunel", "of Amoros"],
  };

  it("has the expected corpus size (names.txt section 1)", () => {
    expect(loadTolkienWords().length).toBe(601);
  });

  it("matches the independent oracle for the real Tolkien corpus", () => {
    const probs = buildProb(loadTolkienWords());
    for (const [seedStr, expected] of Object.entries(GOLDEN)) {
      const rng = new Rng(Number(seedStr), { quick: true });
      const got = expected.map(() => artifactGenName(rng, probs));
      expect(got, `seed ${seedStr}`).toEqual(expected);
    }
  });

  it("wraps names as \"'Word'\" or \"of Word\" with a capitalized first letter", () => {
    const probs = buildProb(loadTolkienWords());
    const rng = new Rng(12345, { quick: true });
    for (let i = 0; i < 50; i++) {
      const name = artifactGenName(rng, probs);
      const m = /^(?:'([A-Z][a-z]*)'|of ([A-Z][a-z]*))$/.exec(name);
      expect(m, name).not.toBeNull();
      const word = (m![1] ?? m![2]) as string;
      expect(word.length).toBeGreaterThanOrEqual(5);
      expect(word.length).toBeLessThanOrEqual(9);
    }
  });

  it("is corpus-driven: passing the corpus changes the generated set", () => {
    const reg = makeReg();
    const withCorpus = doRandart(reg, 4242, loadTolkienWords());
    const withoutCorpus = doRandart(reg, 4242);
    const names = (arts: (Artifact | null)[]) =>
      arts.filter((a): a is Artifact => !!a).map((a) => a.name);
    /* Faithful names appear only on the corpus path. */
    expect(names(withCorpus)).not.toEqual(names(withoutCorpus));
    /* And the corpus path is itself deterministic. */
    expect(names(doRandart(reg, 4242, loadTolkienWords()))).toEqual(
      names(withCorpus),
    );
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

describe("artifact curse TIMED_INC foil (obj-curse.c L267-296, gap 3.3)", () => {
  const foil = buildCurseTimedFoil([
    { name: "PARALYZED", fail: [{ code: 1, flag: "FREE_ACT" }] },
    { name: "POISONED", fail: [{ code: 2, flag: "POIS" }] },
  ]);

  function cursedArt(reg: ObjRegistry, curseName: string): Artifact {
    const art = reg.artifacts.find((a): a is Artifact => a !== null)!;
    const idx = reg.curses.findIndex((c) => c?.name === curseName);
    expect(idx).toBeGreaterThan(0);
    art.curses = new Array<number>(reg.curses.length).fill(0);
    art.curses[idx] = 10;
    return art;
  }

  it("remove_contradictory strips a paralysis curse from a FREE_ACT artifact", () => {
    const reg = makeReg();
    const art = cursedArt(reg, "paralysis");
    art.flags.on(OF.FREE_ACT);
    removeContradictory(reg, art, foil);
    /* check_artifact_curses freed the now-empty curse array. */
    expect(art.curses).toBeNull();
  });

  it("remove_contradictory strips a poison curse from a poison-resisting artifact", () => {
    const reg = makeReg();
    const art = cursedArt(reg, "poison");
    art.flags.off(OF.FREE_ACT);
    art.elInfo[ELEM.POIS]!.resLevel = 1;
    removeContradictory(reg, art, foil);
    expect(art.curses).toBeNull();
  });

  it("keeps the curse when nothing foils it", () => {
    const reg = makeReg();
    const art = cursedArt(reg, "paralysis");
    art.flags.off(OF.FREE_ACT);
    const idx = reg.curses.findIndex((c) => c?.name === "paralysis");
    removeContradictory(reg, art, foil);
    expect(art.curses?.[idx]).toBe(10);
  });

  it("without the foil tables the old (pre-gap-3.3) keep behaviour holds", () => {
    const reg = makeReg();
    const art = cursedArt(reg, "paralysis");
    art.flags.on(OF.FREE_ACT);
    const idx = reg.curses.findIndex((c) => c?.name === "paralysis");
    removeContradictory(reg, art);
    expect(art.curses?.[idx]).toBe(10);
  });
});

describe("remove_contradictory_activation (obj-randart.c L2420, gap 3.8)", () => {
  function actArt(reg: ObjRegistry): Artifact {
    const art = reg.artifacts.find(
      (a): a is Artifact => a !== null && a.activation !== null,
    );
    if (!art) throw new Error("no activated artifact in pack");
    return art;
  }

  const prop = (kind: number, idx: number, min = 0, max = 0) => ({
    kind,
    idx,
    reslevelMin: min,
    reslevelMax: max,
  });

  it("keeps the activation when there is no summarizer (conservative)", () => {
    const reg = makeReg();
    const art = actArt(reg);
    removeContradictoryActivation(reg, art);
    expect(art.activation).not.toBeNull();
  });

  it("keeps the activation when a sub-effect is unsummarizable (L2431-2436)", () => {
    const reg = makeReg();
    const art = actArt(reg);
    removeContradictoryActivation(reg, art, () => ({
      props: [],
      unsummarizedCount: 1,
    }));
    expect(art.activation).not.toBeNull();
  });

  it("strips an activation that only duplicates an object flag (CONFLICT_FLAG)", () => {
    const reg = makeReg();
    const art = actArt(reg);
    art.flags.on(OF.FREE_ACT);
    removeContradictoryActivation(reg, art, () => ({
      props: [prop(EFPROP.CONFLICT_FLAG, OF.FREE_ACT)],
      unsummarizedCount: 0,
    }));
    expect(art.activation).toBeNull();
  });

  it("keeps a flag-granting activation when the artifact lacks the flag", () => {
    const reg = makeReg();
    const art = actArt(reg);
    art.flags.off(OF.FREE_ACT);
    removeContradictoryActivation(reg, art, () => ({
      props: [prop(EFPROP.OBJECT_FLAG_EXACT, OF.FREE_ACT)],
      unsummarizedCount: 0,
    }));
    expect(art.activation).not.toBeNull();
  });

  it("EFPROP_OBJECT_FLAG (flag plus more) is never redundant (L2480-2490)", () => {
    const reg = makeReg();
    const art = actArt(reg);
    art.flags.on(OF.FREE_ACT);
    removeContradictoryActivation(reg, art, () => ({
      props: [prop(EFPROP.OBJECT_FLAG, OF.FREE_ACT)],
      unsummarizedCount: 0,
    }));
    expect(art.activation).not.toBeNull();
  });

  it("resist window: in-window res_level keeps, out-of-window strips (L2469-2478)", () => {
    const reg = makeReg();
    const kept = actArt(reg);
    kept.elInfo[ELEM.FIRE]!.resLevel = 1; /* within [-1, 1] */
    removeContradictoryActivation(reg, kept, () => ({
      props: [prop(EFPROP.RESIST, ELEM.FIRE, -1, 1)],
      unsummarizedCount: 0,
    }));
    expect(kept.activation).not.toBeNull();

    const reg2 = makeReg();
    const stripped = actArt(reg2);
    stripped.elInfo[ELEM.FIRE]!.resLevel = 3; /* outside [-1, 1] */
    removeContradictoryActivation(reg2, stripped, () => ({
      props: [prop(EFPROP.RESIST, ELEM.FIRE, -1, 1)],
      unsummarizedCount: 0,
    }));
    expect(stripped.activation).toBeNull();
  });

  it("brand redundancy compares multipliers over shared resist flags (L2442-2454)", () => {
    const reg = makeReg();
    /* Two brands with the same resist flag and different multipliers. */
    let weak = -1;
    let strong = -1;
    for (let i = 1; i < reg.brands.length && strong < 0; i++) {
      for (let j = 1; j < reg.brands.length; j++) {
        if (i === j) continue;
        if (
          reg.brands[i]!.resistFlag === reg.brands[j]!.resistFlag &&
          reg.brands[i]!.multiplier < reg.brands[j]!.multiplier
        ) {
          weak = i;
          strong = j;
          break;
        }
      }
    }
    expect(strong).toBeGreaterThan(0);

    /* Artifact carries the stronger brand; a weaker branded activation is
     * redundant and stripped. */
    const art = actArt(reg);
    art.brands = new Array<boolean>(reg.brands.length).fill(false);
    art.brands[strong] = true;
    removeContradictoryActivation(reg, art, () => ({
      props: [prop(EFPROP.BRAND, weak)],
      unsummarizedCount: 0,
    }));
    expect(art.activation).toBeNull();

    /* Carrying only the weaker brand keeps a stronger branded activation. */
    const reg2 = makeReg();
    const art2 = actArt(reg2);
    art2.brands = new Array<boolean>(reg2.brands.length).fill(false);
    art2.brands[weak] = true;
    removeContradictoryActivation(reg2, art2, () => ({
      props: [prop(EFPROP.BRAND, strong)],
      unsummarizedCount: 0,
    }));
    expect(art2.activation).not.toBeNull();
  });
});
