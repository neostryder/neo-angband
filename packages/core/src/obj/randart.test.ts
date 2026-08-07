import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELEM, KF, OF } from "../generated/index.js";
import { ObjRegistry } from "./bind.js";
import type { ObjPackJson } from "./types.js";
import { buildCurseTimedFoil } from "./object.js";
import { doRandart, artifactGenName, RANDART_LOG, RANDNAME_TOLKIEN } from "./randart.js";
import { HostDir, NULL_HOST } from "../host/io.js";
import type { HostIo, WriteOutcome } from "../host/io.js";
import {
  EFPROP,
  removeContradictory,
  removeContradictoryActivation,
} from "./randart-build.js";
import { buildProb } from "./randname.js";
import { collectArtifactData, artifactPower } from "./randart-data.js";
import { Rng } from "../rng.js";
import type { Artifact } from "./types.js";

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
    const a = doRandart(reg, 4242, false);
    const b = doRandart(reg, 4242, false);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("is seed-sensitive: different seeds yield different sets", () => {
    const reg = makeReg();
    const a = doRandart(reg, 1, false);
    const b = doRandart(reg, 999999, false);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("never mutates the registry's standard artifacts", () => {
    const reg = makeReg();
    const before = reg.artifacts.map((a) => (a ? `${a.name}|${a.toH}|${a.toD}` : "null"));
    doRandart(reg, 777, false);
    const after = reg.artifacts.map((a) => (a ? `${a.name}|${a.toH}|${a.toD}` : "null"));
    expect(after).toEqual(before);
  });

  it("returns a full set of valid artifacts on valid base items", () => {
    const reg = makeReg();
    const arts = doRandart(reg, 55, false);
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
    const arts = doRandart(reg, 31337, false);
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
    const withCorpus = doRandart(reg, 4242, false, loadTolkienWords());
    const withoutCorpus = doRandart(reg, 4242, false);
    const names = (arts: (Artifact | null)[]) =>
      arts.filter((a): a is Artifact => !!a).map((a) => a.name);
    /* Faithful names appear only on the corpus path. */
    expect(names(withCorpus)).not.toEqual(names(withoutCorpus));
    /* And the corpus path is itself deterministic. */
    expect(names(doRandart(reg, 4242, false, loadTolkienWords()))).toEqual(
      names(withCorpus),
    );
  });
});

describe("collect_artifact_data (obj-randart.c L1059)", () => {
  it("measures the standard set into a sane power profile", () => {
    const reg = makeReg();
    const data = collectArtifactData(
      reg,
      reg.artifacts,
      new Rng(1, { quick: true }),
    );
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
    expect(artifactPower(reg, art, "test")).toBeGreaterThan(0);
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

/**
 * The log lines the add_* family emits quote names looked up out of
 * object_property.txt and projection.txt. A lookup that misses degrades to
 * "(unknown)" rather than crashing, which means a WRONG table produces a
 * perfectly well-formed log full of nothing. The census test cannot see that -
 * it reads source text - so run a real generation against the real content
 * pack and read what came out.
 */
describe("randart.log names things, on a real run (PORT_TODO 5.5)", () => {
  function runAndReadLog(seed: number): string {
    const files = new Map<string, string>();
    const io = {
      ...NULL_HOST,
      displayPath: (dir: HostDir, name: string) => `${dir}/${name}`,
      exists: (dir: HostDir, name: string) =>
        dir === HostDir.USER && files.has(name),
      read: (dir: HostDir, name: string) =>
        dir === HostDir.USER ? (files.get(name) ?? null) : null,
      write: (dir: HostDir, name: string, text: string) => {
        if (dir !== HostDir.USER) return "create-failed" as WriteOutcome;
        files.set(name, text);
        return "ok" as WriteOutcome;
      },
    } as unknown as HostIo;
    doRandart(makeReg(), seed, false, undefined, undefined, io);
    return files.get(RANDART_LOG) ?? "";
  }

  const log = runAndReadLog(0x5eed);

  it("produced a log at all", () => {
    /* Without this the two assertions below pass for free on an empty string. */
    expect(log.length).toBeGreaterThan(10_000);
    expect(log).toContain("Adding ability:");
  });

  it("never falls back to (unknown) - every lookup resolves", () => {
    const bad = log
      .split("\n")
      .filter((l) => l.includes("(unknown)"))
      .slice(0, 5);
    expect(bad).toEqual([]);
  });

  it("quotes real property and element names, not codes", () => {
    /* One from object_property.txt and one from projection.txt. Codes would be
     * "OF_FEATHER_FALL" and "ELEC"; a table copied from list-elements.h would
     * produce the latter. */
    expect(log).toMatch(/Adding resistance to (acid|lightning|fire|cold|poison)/);
    expect(log).not.toMatch(/Adding resistance to [A-Z_]+$/m);
  });

  /*
   * do_randart measures TWICE (obj-randart.c L3175-L3186): the standard set
   * before generation, and the finished set after. The second pass has no
   * return value anyone reads - the log IS its output - so nothing else in this
   * suite can notice whether it ran.
   */
  describe("the second measurement pass", () => {
    /** store_base_power's summary block: its whole output, in log order. */
    const statBlocks = (): string[][] => {
      const lines = log
        .split("\n")
        .filter((l) => /^(Max power is|Mean is|Power for tval )/.test(l));
      const heads = lines.flatMap((l, i) =>
        l.startsWith("Max power is") ? [i] : [],
      );
      return heads.map((h, n) => lines.slice(h, heads[n + 1] ?? lines.length));
    };

    it("runs parse_frequencies twice, not once", () => {
      expect(log.split("****** BEGINNING GENERATION OF FREQUENCIES").length - 1).toBe(2);
    });

    it("runs store_base_power twice, not once", () => {
      expect(statBlocks().length).toBe(2);
    });

    it("measures the GENERATED set the second time, not the standard set again", () => {
      /* The counts above are satisfied by calling the pass with the WRONG array
       * - reg.artifacts twice over - which is the easy mistake, because
       * upstream never passes the set at all (create_artifact_set overwrites
       * the a_info global in place, so "the artifacts" silently means something
       * different the second time). Two passes over one set emit identical
       * statistics; two passes over different sets cannot. */
      const [first = [], second = []] = statBlocks();
      expect(first.length).toBeGreaterThan(3); /* not two empty blocks */
      expect(second).not.toEqual(first);
    });
  });
});

describe("the second measurement pass changes nothing (obj-randart.c L3181)", () => {
  /* It runs AFTER generation, so it cannot alter the returned set by ordinary
   * means - but only if it neither draws from the RNG (which would desync a
   * caller sharing the Rng) nor writes to the artifacts it is reading. */
  it("draws no RNG", () => {
    const reg = makeReg();
    const used = new Rng(99, { quick: true });
    collectArtifactData(reg, reg.artifacts, used);
    const fresh = new Rng(99, { quick: true });
    const drawUsed = Array.from({ length: 8 }, () => used.randint0(1_000_000));
    const drawFresh = Array.from({ length: 8 }, () => fresh.randint0(1_000_000));
    expect(drawUsed).toEqual(drawFresh);
  });

  it("does not modify the artifacts it measures", () => {
    const reg = makeReg();
    const arts = doRandart(reg, 20260807, false);
    const before = fingerprint(arts);
    collectArtifactData(reg, arts, new Rng(1, { quick: true }));
    expect(fingerprint(arts)).toBe(before);
  });
});
