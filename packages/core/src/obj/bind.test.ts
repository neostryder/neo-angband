import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELEM, KF, OBJ_MOD, OF, TV } from "../generated";
import { ObjRegistry, objDescNameFormat, tvalFindIdx } from "./bind";
import type {
  ArtifactRecordJson,
  Curse,
  EgoRecordJson,
  ObjectKindRecordJson,
  ObjPackJson,
} from "./types";
import { EL_INFO_IGNORE, NO_MINIMUM, TV_MAX } from "./types";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

export function loadPack(): ObjPackJson {
  return {
    objectBase: load("object_base"),
    object: load("object"),
    egoItem: load("ego_item"),
    artifact: load("artifact"),
    curse: load("curse"),
    brand: load("brand"),
    slay: load("slay"),
    activation: load("activation"),
    objectProperty: load("object_property"),
    flavor: load("flavor"),
  } as ObjPackJson;
}

const pack = loadPack();
const reg = new ObjRegistry(pack);

describe("ObjRegistry counts", () => {
  it("binds the full 4.2.6 pack", () => {
    // 34 object_base records bind; "gold" is nameless upstream
    // (object_base.txt has `name:gold` with no display field), so only
    // 33 carry a display name. Count real bases by their graphics attr.
    expect(reg.bases.filter((b) => b.attr !== "").length).toBe(34);
    expect(reg.bases.filter((b) => b.name !== "").length).toBe(33);
    expect(reg.bases.length).toBe(TV_MAX);
    expect(reg.ordinaryKindCount).toBe(375);
    expect(reg.egos.length).toBe(107);
    expect(reg.artifacts.length - 1).toBe(138);
    expect(reg.curses.length - 1).toBe(27);
    expect(reg.brands.length - 1).toBe(10);
    expect(reg.slays.length - 1).toBe(11);
    expect(reg.activations.length - 1).toBe(163);
    expect(reg.properties.length - 1).toBe(79);
  });

  it("appends one INSTA_ART dummy kind per special artifact", () => {
    const specials = pack.artifact.records.filter((r) => r.graphics).length;
    expect(specials).toBe(14);
    expect(reg.kinds.length).toBe(reg.ordinaryKindCount + specials);
    for (let i = reg.ordinaryKindCount; i < reg.kinds.length; i++) {
      const kind = reg.kinds[i];
      expect(kind?.kindFlags.has(KF.INSTA_ART)).toBe(true);
    }
  });

  it("keeps the upstream reverse ordering for 1-based lists", () => {
    /* finish_parse_* walks the prepended list: index 1 = last record. */
    const lastCurse = pack.curse.records[pack.curse.records.length - 1];
    expect((reg.curses[1] as Curse).name).toBe(lastCurse?.name);
    const lastBrand = pack.brand.records[pack.brand.records.length - 1];
    expect(reg.brands[1]?.code).toBe(lastBrand?.code);
    const lastSlay = pack.slay.records[pack.slay.records.length - 1];
    expect(reg.slays[1]?.code).toBe(lastSlay?.code);
    const lastAct =
      pack.activation.records[pack.activation.records.length - 1];
    expect(reg.activations[1]?.name).toBe(lastAct?.name);
    /* Properties are 1-based in FILE order (idx counts down upstream). */
    expect(reg.properties[1]?.name).toBe(pack.objectProperty.records[0]?.name);
  });
});

describe("tval and sval lookups", () => {
  it("tval_find_idx resolves names, numbers, and armour spelling", () => {
    expect(tvalFindIdx("sword")).toBe(TV.SWORD);
    expect(tvalFindIdx("light")).toBe(TV.LIGHT);
    expect(tvalFindIdx("dragon armour")).toBe(TV.DRAG_ARMOR);
    expect(tvalFindIdx("hard armor")).toBe(TV.HARD_ARMOR);
    expect(tvalFindIdx("Sword")).toBe(TV.SWORD);
    expect(tvalFindIdx("9")).toBe(9);
    expect(tvalFindIdx("none")).toBe(0);
    expect(tvalFindIdx("bogus")).toBe(-1);
    expect(tvalFindIdx("999")).toBe(-1);
  });

  it("obj_desc_name_format strips markers", () => {
    expect(objDescNameFormat("& Broad Sword~")).toBe("Broad Sword");
    expect(objDescNameFormat("& Kni|fe|ves|~")).toBe("Knife");
    expect(objDescNameFormat("copper")).toBe("copper");
  });

  it("lookup_sval finds kinds by formatted name, case-insensitively", () => {
    const sval = reg.lookupSval(TV.SWORD, "Broad Sword");
    expect(sval).toBeGreaterThan(0);
    expect(reg.lookupSval(TV.SWORD, "broad sword")).toBe(sval);
    expect(reg.lookupSval(TV.SWORD, "3")).toBe(3);
    expect(reg.lookupSval(TV.SWORD, "No Such Sword")).toBe(-1);
  });

  it("svals are assigned in file order within each tval", () => {
    const swords = pack.object.records.filter((r) => r.type === "sword");
    for (let i = 0; i < swords.length; i++) {
      const name = objDescNameFormat((swords[i] as { name: string }).name);
      expect(reg.lookupSval(TV.SWORD, name)).toBe(i + 1);
    }
  });
});

describe("kind binding", () => {
  it("binds the Broad Sword exactly as object.txt declares it", () => {
    const kind = reg.lookupKind(TV.SWORD, reg.lookupSval(TV.SWORD, "Broad Sword"));
    expect(kind).not.toBeNull();
    expect(kind?.name).toBe("& Broad Sword~");
    expect(kind?.dd).toBe(2);
    expect(kind?.ds).toBe(5);
    expect(kind?.weight).toBe(150);
    expect(kind?.cost).toBe(300);
    expect(kind?.level).toBe(10);
    expect(kind?.ac).toBe(0);
    expect(kind?.allocProb).toBe(20);
    expect(kind?.allocMin).toBe(10);
    expect(kind?.allocMax).toBe(100);
    expect(kind?.toH).toEqual({ base: 0, dice: 0, sides: 0, mBonus: 0 });
    expect(kind?.dChar).toBe("|");
    expect(kind?.base).toBe(reg.bases[TV.SWORD]);
  });

  it("kinds inherit base kind flags and element hates", () => {
    /* Sword base: HATES_ACID | SHOW_DICE per object_base.txt. */
    const base = reg.bases[TV.SWORD];
    expect(base?.kindFlags.has(KF.SHOW_DICE)).toBe(true);
    const kind = reg.lookupKind(TV.SWORD, 1);
    expect(kind?.kindFlags.has(KF.SHOW_DICE)).toBe(true);
    expect(base?.maxStack).toBe(40);
  });

  it("binds kind values, slays, and curses", () => {
    const blade = reg.lookupKind(
      TV.SWORD,
      reg.lookupSval(TV.SWORD, "Blade of Chaos"),
    );
    expect(blade?.elInfo[ELEM.CHAOS]?.resLevel).toBe(1);

    const mace = reg.lookupKind(
      TV.HAFTED,
      reg.lookupSval(TV.HAFTED, "Mace of Disruption"),
    );
    const undead3 = reg.lookupSlay("UNDEAD_3");
    expect(undead3).toBeGreaterThan(0);
    expect(mace?.slays?.[undead3]).toBe(true);

    const teleRing = reg.lookupKind(
      TV.RING,
      reg.lookupSval(TV.RING, "Teleportation"),
    );
    const teleCurse = reg.lookupCurse("teleportation");
    expect(teleCurse).toBeGreaterThan(0);
    expect(teleRing?.curses?.[teleCurse]).toBe(100);
    /* values: SPEED[2] carries a random value with base 2. */
    expect(teleRing?.modifiers[OBJ_MOD.SPEED]).toEqual({
      base: 2,
      dice: 0,
      sides: 0,
      mBonus: 0,
    });
  });

  it("resolves the generic object-like kinds", () => {
    expect(reg.pileKind?.name).toBe("<pile>");
    expect(reg.unknownItemKind?.name).toBe("<unknown item>");
    expect(reg.unknownGoldKind?.name).toBe("<unknown treasure>");
    expect(reg.curseObjectKind?.name).toBe("<curse object>");
  });
});

describe("ego binding", () => {
  it("binds 'of Resist Lightning' faithfully", () => {
    const ego = reg.findEgo("of Resist Lightning");
    expect(ego).not.toBeNull();
    expect(ego?.cost).toBe(400);
    expect(ego?.rating).toBe(10);
    expect(ego?.allocProb).toBe(100);
    expect(ego?.allocMin).toBe(1);
    expect(ego?.allocMax).toBe(30);
    /* values: RES_ELEC[1]; flags: IGNORE_ELEC. */
    expect(ego?.elInfo[ELEM.ELEC]?.resLevel).toBe(1);
    expect((ego?.elInfo[ELEM.ELEC]?.flags ?? 0) & EL_INFO_IGNORE).toBe(
      EL_INFO_IGNORE,
    );
    /* min-combat: 255 0 0 -> to-hit has no minimum. */
    expect(ego?.minToH).toBe(NO_MINIMUM);
    expect(ego?.minToD).toBe(0);
    expect(ego?.minToA).toBe(0);
    /* type: soft armor covers every soft armor kind; item: adds the
     * six listed hard armors. */
    for (const kind of reg.kinds) {
      if (kind.tval === TV.SOFT_ARMOR) {
        expect(ego?.possItems.has(kind.kidx)).toBe(true);
      }
    }
    const scale = reg.lookupKind(
      TV.HARD_ARMOR,
      reg.lookupSval(TV.HARD_ARMOR, "Metal Scale Mail"),
    );
    expect(scale).not.toBeNull();
    expect(ego?.possItems.has((scale as { kidx: number }).kidx)).toBe(true);
  });

  it("wires ego brands, slays, and random-value modifiers", () => {
    const acid = reg.findEgo("of Acid");
    expect(acid?.brands?.[reg.lookupBrand("ACID_3")]).toBe(true);
    expect(acid?.elInfo[ELEM.ACID]?.resLevel).toBe(1);

    const holy = reg.findEgo("(Holy Avenger)");
    expect(holy?.slays?.[reg.lookupSlay("EVIL_2")]).toBe(true);
    expect(holy?.slays?.[reg.lookupSlay("UNDEAD_3")]).toBe(true);
    expect(holy?.slays?.[reg.lookupSlay("DEMON_3")]).toBe(true);
    /* values: WIS[d4] -> random value 0+1d4. */
    expect(holy?.modifiers[OBJ_MOD.WIS]).toEqual({
      base: 0,
      dice: 1,
      sides: 4,
      mBonus: 0,
    });
    expect(holy?.kindFlags.has(KF.RAND_SUSTAIN)).toBe(true);

    const everburning = reg.findEgo("(Everburning)");
    expect(everburning?.flags.has(OF.NO_FUEL)).toBe(true);
    expect(everburning?.flagsOff.has(OF.TAKES_FUEL)).toBe(true);
  });
});

describe("artifact binding", () => {
  it("binds Ringil exactly as artifact.txt declares it", () => {
    const art = reg.findArtifact("'Ringil'");
    expect(art).not.toBeNull();
    expect(art?.tval).toBe(TV.SWORD);
    expect(art?.sval).toBe(reg.lookupSval(TV.SWORD, "Long Sword"));
    expect(art?.level).toBe(40);
    expect(art?.weight).toBe(130);
    expect(art?.cost).toBe(300000);
    expect(art?.allocProb).toBe(1);
    expect(art?.allocMin).toBe(20);
    expect(art?.allocMax).toBe(127);
    expect(art?.dd).toBe(4);
    expect(art?.ds).toBe(5);
    expect(art?.toH).toBe(22);
    expect(art?.toD).toBe(25);
    expect(art?.ac).toBe(0);
    expect(art?.toA).toBe(0);
    for (const f of [
      OF.PROT_FEAR,
      OF.BLESSED,
      OF.FREE_ACT,
      OF.SEE_INVIS,
      OF.SLOW_DIGEST,
      OF.REGEN,
    ]) {
      expect(art?.flags.has(f)).toBe(true);
    }
    expect(art?.modifiers[OBJ_MOD.SPEED]).toBe(10);
    expect(art?.modifiers[OBJ_MOD.LIGHT]).toBe(1);
    expect(art?.elInfo[ELEM.COLD]?.resLevel).toBe(1);
    expect(art?.elInfo[ELEM.LIGHT]?.resLevel).toBe(1);
    /* All base elements are ignored on artifacts. */
    for (const e of [ELEM.ACID, ELEM.ELEC, ELEM.FIRE, ELEM.COLD]) {
      expect((art?.elInfo[e]?.flags ?? 0) & EL_INFO_IGNORE).toBe(
        EL_INFO_IGNORE,
      );
    }
    expect(art?.brands?.[reg.lookupBrand("COLD_3")]).toBe(true);
    for (const code of ["EVIL_2", "UNDEAD_3", "TROLL_3", "DEMON_5"]) {
      expect(art?.slays?.[reg.lookupSlay(code)]).toBe(true);
    }
    expect(art?.activation).toBe(reg.findActivation("COLD_BALL100"));
    expect(art?.time).toEqual({ base: 40, dice: 0, sides: 0, mBonus: 0 });
  });

  it("creates dummy kinds for special artifacts", () => {
    const sval = reg.lookupSval(TV.LIGHT, "Phial");
    expect(sval).toBeGreaterThan(0);
    const kind = reg.lookupKind(TV.LIGHT, sval);
    expect(kind).not.toBeNull();
    expect(kind?.kindFlags.has(KF.INSTA_ART)).toBe(true);
    expect(kind?.kidx).toBeGreaterThanOrEqual(reg.ordinaryKindCount);
    /* parse_artifact_weight/cost write through to the special kind. */
    expect(kind?.weight).toBe(10);
    expect(kind?.cost).toBe(10000);
    expect(kind?.dChar).toBe("~");
    /* Special light activations land on the kind, not the artifact. */
    const art = reg.findArtifact("of Galadriel");
    expect(art?.activation).toBeNull();
    expect(kind?.activation).toBe(reg.findActivation("ILLUMINATION"));
  });
});

describe("curse binding", () => {
  it("binds teleportation with conflicts and effects", () => {
    const idx = reg.lookupCurse("teleportation");
    const curse = reg.curses[idx] as Curse;
    for (const tv of [TV.HELM, TV.CROWN, TV.AMULET, TV.RING]) {
      expect(curse.poss[tv]).toBe(true);
    }
    expect(curse.poss[TV.SWORD]).toBe(false);
    expect(curse.conflict).toBe("|anti-teleportation|");
    expect(curse.conflictFlags.has(OF.NO_TELEPORT)).toBe(true);
    expect(curse.obj.time).toEqual({ base: 0, dice: 1, sides: 100, mBonus: 0 });
    expect(curse.obj.effect?.[0]?.eff).toBe("TELEPORT");
    expect(curse.obj.effectMsg).toBe("Space warps around you.");
  });

  it("binds vulnerability combat penalties and flags", () => {
    const idx = reg.lookupCurse("vulnerability");
    const curse = reg.curses[idx] as Curse;
    expect(curse.obj.toA).toBe(-50);
    expect(curse.obj.flags.has(OF.AGGRAVATE)).toBe(true);
    expect(curse.poss[TV.SHIELD]).toBe(true);
  });
});

describe("flavors and activations", () => {
  it("binds flavor entries with kind glyphs and fixed svals", () => {
    expect(reg.flavors.length).toBeGreaterThan(100);
    const ringFlavors = reg.flavors.filter((f) => f.tval === TV.RING);
    expect(ringFlavors.length).toBeGreaterThan(30);
    expect(ringFlavors.every((f) => f.dChar === "=")).toBe(true);
    const one = ringFlavors.find((f) => f.text === "Plain Gold");
    expect(one?.sval).toBe(reg.lookupSval(TV.RING, "Ring of Power"));
  });

  it("binds activations with aim and effects", () => {
    const act = reg.findActivation("CURE_POISON");
    expect(act?.aim).toBe(false);
    expect(act?.level).toBe(5);
    expect(act?.power).toBe(1);
    expect(act?.effect?.[0]?.eff).toBe("CURE");
    expect(act?.desc).toBe("neutralizes poison");
  });
});

describe("moddability", () => {
  it("binds mod records appended in the same shape as pack data", () => {
    const modded = loadPack();
    const kindRec: ObjectKindRecordJson = {
      name: "& Test Blade~",
      type: "sword",
      graphics: { glyph: "|", color: "w" },
      level: 5,
      weight: 100,
      cost: 10,
      alloc: { common: 20, minmax: "1 to 20" },
      attack: { hd: "3d4", "to-h": "0", "to-d": "0" },
      armor: { ac: 0, "to-a": "0" },
      flags: ["SEE_INVIS | IGNORE_ACID"],
      values: ["STR[1]"],
      slay: ["EVIL_2"],
    };
    const egoRec: EgoRecordJson = {
      name: "of Modding",
      info: { cost: 100, rating: 5 },
      alloc: { common: 10, minmax: "1 to 50" },
      type: ["sword"],
      flags: ["IGNORE_ACID"],
      values: ["STEALTH[d2]"],
      brand: ["ACID_3"],
    };
    const artRec: ArtifactRecordJson = {
      name: "of Testing",
      "base-object": { tval: "sword", sval: "Test Blade" },
      level: 10,
      weight: 100,
      cost: 1000,
      alloc: { common: 50, minmax: "5 to 100" },
      attack: { hd: "3d4", "to-h": 5, "to-d": 5 },
      armor: { ac: 0, "to-a": 0 },
      values: ["STR[2]"],
      slay: ["EVIL_2"],
      desc: ["A modded artifact."],
    };
    modded.object.records.push(kindRec);
    modded.egoItem.records.push(egoRec);
    modded.artifact.records.push(artRec);

    const modReg = new ObjRegistry(modded);
    expect(modReg.ordinaryKindCount).toBe(376);
    expect(modReg.egos.length).toBe(108);
    expect(modReg.artifacts.length - 1).toBe(139);

    const sval = modReg.lookupSval(TV.SWORD, "Test Blade");
    expect(sval).toBeGreaterThan(0);
    const kind = modReg.lookupKind(TV.SWORD, sval);
    expect(kind?.dd).toBe(3);
    expect(kind?.ds).toBe(4);
    expect(kind?.flags.has(OF.SEE_INVIS)).toBe(true);
    expect((kind?.elInfo[ELEM.ACID]?.flags ?? 0) & EL_INFO_IGNORE).toBe(
      EL_INFO_IGNORE,
    );
    expect(kind?.modifiers[OBJ_MOD.STR]?.base).toBe(1);
    expect(kind?.slays?.[modReg.lookupSlay("EVIL_2")]).toBe(true);

    const ego = modReg.findEgo("of Modding");
    expect(ego?.possItems.has((kind as { kidx: number }).kidx)).toBe(true);
    expect(ego?.brands?.[modReg.lookupBrand("ACID_3")]).toBe(true);
    expect(ego?.modifiers[OBJ_MOD.STEALTH]).toEqual({
      base: 0,
      dice: 1,
      sides: 2,
      mBonus: 0,
    });

    const art = modReg.findArtifact("of Testing");
    expect(art?.tval).toBe(TV.SWORD);
    expect(art?.sval).toBe(sval);
    expect(art?.modifiers[OBJ_MOD.STR]).toBe(2);
    /* No graphics: -> ordinary base object, no dummy kind added. */
    expect(modReg.kinds.length).toBe(modReg.ordinaryKindCount + 14);
  });
});
