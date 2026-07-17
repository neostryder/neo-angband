import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELEM, OF } from "../generated";
import { ObjRegistry } from "./bind";
import type {
  ActivationSummarizerDeps,
  RawTimedRecord,
} from "./effects-info";
import { makeActivationSummarizer } from "./effects-info";
import { EFPROP, removeContradictoryActivation } from "./randart-build";
import type { Artifact, EffectRecordJson, ObjPackJson } from "./types";

/*
 * effect_summarize_properties (effects-info.c L843-L1087), the summarizer that
 * lets remove_contradictory_activation (obj-randart.c L2420) strip a randart
 * activation duplicating an intrinsic property.
 */

/* Representative player_timed records (subset of pack.player.timed), taken
 * verbatim from player_timed.json:
 *  - HERO: flag-synonym PROT_FEAR (non-exact -> EFPROP_OBJECT_FLAG).
 *  - BOLD: flag-synonym PROT_FEAR (exact -> EFPROP_OBJECT_FLAG_EXACT).
 *  - OPP_FIRE: resist FIRE, fail VULN FIRE (temp_resist window shifts).
 *  - ATT_FIRE: brand FIRE_3. ATT_EVIL: slay EVIL_2.
 *  - AFRAID: flag-synonym AFRAID exact + fail OBJECT PROT_FEAR (a cure grants
 *    the blocking flag).
 *  - POISONED: fail RESIST POIS + fail TIMED OPP_POIS (the TIMED fail cannot be
 *    summarized -> unsummarized on a cure). */
const TIMED_RECORDS: RawTimedRecord[] = [
  { name: "HERO", "flag-synonym": [{ code: "PROT_FEAR", exact: 0 }] },
  { name: "BOLD", "flag-synonym": [{ code: "PROT_FEAR", exact: 1 }] },
  { name: "OPP_FIRE", resist: "FIRE", fail: [{ code: 3, flag: "FIRE" }] },
  { name: "ATT_FIRE", brand: ["FIRE_3"] },
  { name: "ATT_EVIL", slay: ["EVIL_2"] },
  {
    name: "AFRAID",
    "flag-synonym": [{ code: "AFRAID", exact: 1 }],
    fail: [{ code: 1, flag: "PROT_FEAR" }],
  },
  {
    name: "POISONED",
    fail: [
      { code: 2, flag: "POIS" },
      { code: 5, flag: "OPP_POIS" },
    ],
  },
];

const BRANDS = [null, { code: "FIRE_3" }];
const SLAYS = [null, { code: "EVIL_2" }];
const BRAND_FIRE = 1;
const SLAY_EVIL = 1;

const DEPS: ActivationSummarizerDeps = {
  timedRecords: TIMED_RECORDS,
  brands: BRANDS,
  slays: SLAYS,
  ofIndex: (n) => (OF as Record<string, number>)[n] ?? 0,
  elemIndex: (n) => (ELEM as Record<string, number>)[n] ?? -1,
};

const summarize = makeActivationSummarizer(DEPS);

const chain = (...records: EffectRecordJson[]): EffectRecordJson[] => records;

describe("effect_summarize_properties (effects-info.c L898)", () => {
  it("summarizes a non-exact flag synonym as EFPROP_OBJECT_FLAG (L968-976)", () => {
    const { props, unsummarizedCount } = summarize(
      chain({ eff: "TIMED_INC", type: "HERO", dice: "10+d10" }),
    );
    expect(unsummarizedCount).toBe(0);
    expect(props).toEqual([
      { kind: EFPROP.OBJECT_FLAG, idx: OF.PROT_FEAR, reslevelMin: 0, reslevelMax: 0 },
    ]);
  });

  it("summarizes an exact flag synonym as EFPROP_OBJECT_FLAG_EXACT (L973-974)", () => {
    const { props } = summarize(
      chain({ eff: "TIMED_INC", type: "BOLD", dice: "10+d10" }),
    );
    expect(props).toEqual([
      {
        kind: EFPROP.OBJECT_FLAG_EXACT,
        idx: OF.PROT_FEAR,
        reslevelMin: 0,
        reslevelMax: 0,
      },
    ]);
  });

  it("summarizes a temp resist and shifts its window by a VULN fail (L977-995)", () => {
    /* OPP_FIRE grants resist FIRE; its fail is VULN on FIRE (idx == temp_resist)
     * so rmin becomes MAX(-1, 0) = 0, leaving the window [0, 1]. The VULN fail is
     * not re-added as a conflict because f.idx == temp_resist (L1017). */
    const { props, unsummarizedCount } = summarize(
      chain({ eff: "TIMED_INC", type: "OPP_FIRE", dice: "20+d20" }),
    );
    expect(unsummarizedCount).toBe(0);
    expect(props).toEqual([
      { kind: EFPROP.RESIST, idx: ELEM.FIRE, reslevelMin: 0, reslevelMax: 1 },
    ]);
  });

  it("summarizes a temp brand and a temp slay (L1032-1043)", () => {
    expect(
      summarize(chain({ eff: "TIMED_INC", type: "ATT_FIRE", dice: "d20" })).props,
    ).toEqual([
      { kind: EFPROP.BRAND, idx: BRAND_FIRE, reslevelMin: 0, reslevelMax: 0 },
    ]);
    expect(
      summarize(chain({ eff: "TIMED_INC", type: "ATT_EVIL", dice: "d20" })).props,
    ).toEqual([
      { kind: EFPROP.SLAY, idx: SLAY_EVIL, reslevelMin: 0, reslevelMax: 0 },
    ]);
  });

  it("TELEPORT effects conflict with OF_NO_TELEPORT (L1060-1065)", () => {
    for (const eff of ["TELEPORT", "TELEPORT_TO", "TELEPORT_LEVEL"]) {
      const { props } = summarize(chain({ eff }));
      expect(props).toEqual([
        {
          kind: EFPROP.CONFLICT_FLAG,
          idx: OF.NO_TELEPORT,
          reslevelMin: 0,
          reslevelMax: 0,
        },
      ]);
    }
  });

  it("a cure grants the flag/resist that blocks it (summarize_cure L868-885)", () => {
    /* CURE:AFRAID -> the PROT_FEAR OBJECT fail becomes EFPROP_CURE_FLAG. */
    const afraid = summarize(chain({ eff: "CURE", type: "AFRAID" }));
    expect(afraid.unsummarizedCount).toBe(0);
    expect(afraid.props).toEqual([
      { kind: EFPROP.CURE_FLAG, idx: OF.PROT_FEAR, reslevelMin: 0, reslevelMax: 0 },
    ]);

    /* CURE:POISONED -> RESIST fail -> EFPROP_CURE_RESIST, and the TIMED fail is
     * unsummarizable (L881-882). */
    const poison = summarize(chain({ eff: "CURE", type: "POISONED" }));
    expect(poison.unsummarizedCount).toBe(1);
    expect(poison.props).toEqual([
      { kind: EFPROP.CURE_RESIST, idx: ELEM.POIS, reslevelMin: -1, reslevelMax: 0 },
    ]);
  });

  it("TIMED_SET with a non-positive value acts as a cure (L943-954)", () => {
    /* A zero-max value makes TIMED_SET:AFRAID equivalent to CURE:AFRAID. */
    const { props } = summarize(
      chain({ eff: "TIMED_SET", type: "AFRAID", dice: "0" }),
    );
    expect(props).toEqual([
      { kind: EFPROP.CURE_FLAG, idx: OF.PROT_FEAR, reslevelMin: 0, reslevelMax: 0 },
    ]);
  });

  it("TIMED_SET with a positive value acts like TIMED_INC (fall-through L955)", () => {
    const { props } = summarize(
      chain({ eff: "TIMED_SET", type: "HERO", dice: "10" }),
    );
    expect(props).toEqual([
      { kind: EFPROP.OBJECT_FLAG, idx: OF.PROT_FEAR, reslevelMin: 0, reslevelMax: 0 },
    ]);
  });

  it("SET_VALUE dice is remembered for a later timed effect (L920-926, L944)", () => {
    /* SET_VALUE(0) then TIMED_SET:AFRAID with its own positive dice: the
     * remembered 0 wins, so it is treated as a cure, not an increase. */
    const { props } = summarize(
      chain(
        { eff: "SET_VALUE", dice: "0" },
        { eff: "TIMED_SET", type: "AFRAID", dice: "50" },
      ),
    );
    expect(props).toEqual([
      { kind: EFPROP.CURE_FLAG, idx: OF.PROT_FEAR, reslevelMin: 0, reslevelMax: 0 },
    ]);
  });

  it("a non-property effect increments the unsummarized count (default L1076-1081)", () => {
    const { props, unsummarizedCount } = summarize(
      chain({ eff: "DAMAGE", dice: "10d10" }),
    );
    expect(props).toEqual([]);
    expect(unsummarizedCount).toBe(1);
  });

  it("RANDOM/SELECT wrappers are stepped over, not summarized (L909-918)", () => {
    const { props, unsummarizedCount } = summarize(
      chain(
        { eff: "RANDOM", dice: "1" },
        { eff: "TIMED_INC", type: "HERO", dice: "10" },
      ),
    );
    expect(unsummarizedCount).toBe(0);
    expect(props).toEqual([
      { kind: EFPROP.OBJECT_FLAG, idx: OF.PROT_FEAR, reslevelMin: 0, reslevelMax: 0 },
    ]);
  });
});

describe("remove_contradictory_activation via the real summarizer (obj-randart.c L2420)", () => {
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

  /** A summarizer bound to the live registry, exactly as the session wires it. */
  function realSummarizer(reg: ObjRegistry) {
    const timedPack = loadJson<{ records: RawTimedRecord[] }>("player_timed");
    return makeActivationSummarizer({
      timedRecords: timedPack.records,
      brands: reg.brands,
      slays: reg.slays,
      ofIndex: (n) => (OF as Record<string, number>)[n] ?? 0,
      elemIndex: (n) => (ELEM as Record<string, number>)[n] ?? -1,
    });
  }

  function actArt(reg: ObjRegistry): Artifact {
    const art = reg.artifacts.find(
      (a): a is Artifact => a !== null && a.activation !== null,
    );
    if (!art) throw new Error("no activated artifact in pack");
    return art;
  }

  it("strips an activation whose effect only duplicates an intrinsic flag", () => {
    const reg = makeReg();
    /* Replace the artifact's activation with a single TIMED_INC:AFRAID (grants
     * PROT_FEAR, which is exact and conflicts with nothing else). Give the
     * artifact PROT_FEAR intrinsically -> the activation is redundant. */
    const art = actArt(reg);
    art.activation = {
      ...art.activation!,
      effect: [{ eff: "TIMED_INC", type: "BOLD", dice: "10+d10" }],
    };
    art.flags.on(OF.PROT_FEAR);
    removeContradictoryActivation(reg, art, realSummarizer(reg));
    expect(art.activation).toBeNull();
  });

  it("keeps that activation when the artifact lacks the flag", () => {
    const reg = makeReg();
    const art = actArt(reg);
    art.activation = {
      ...art.activation!,
      effect: [{ eff: "TIMED_INC", type: "BOLD", dice: "10+d10" }],
    };
    art.flags.off(OF.PROT_FEAR);
    removeContradictoryActivation(reg, art, realSummarizer(reg));
    expect(art.activation).not.toBeNull();
  });

  it("keeps an activation that also does something unsummarizable", () => {
    const reg = makeReg();
    const art = actArt(reg);
    art.activation = {
      ...art.activation!,
      effect: [
        { eff: "TIMED_INC", type: "BOLD", dice: "10+d10" },
        { eff: "DAMAGE", dice: "10d10" },
      ],
    };
    art.flags.on(OF.PROT_FEAR);
    removeContradictoryActivation(reg, art, realSummarizer(reg));
    expect(art.activation).not.toBeNull();
  });
});
