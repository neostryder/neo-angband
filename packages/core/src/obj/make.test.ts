import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { KF } from "../generated";
import { Rng } from "../rng";
import { ObjRegistry } from "./bind";
import type { Artifact, ObjPackJson } from "./types";
import {
  ArtifactState,
  makeArtifact,
  makeArtifactSpecial,
  makeObject,
  objectPrep,
} from "./make";
import { ObjAllocState } from "./make";
import type { MakeDeps, MakeObjectRating } from "./make";
import { objectValueReal } from "./value";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const objPack: ObjPackJson = {
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
} as ObjPackJson;

const reg = new ObjRegistry(objPack);
const constants = bindConstants(loadJson("constants"));

function freshDeps(noArtifacts = false): MakeDeps {
  return {
    reg,
    alloc: new ObjAllocState(reg, constants),
    constants,
    artifacts: new ArtifactState(reg.artifacts.length),
    noArtifacts,
  };
}

/** Non-null artifacts in aidx order. */
function allArts(): Artifact[] {
  return reg.artifacts.filter((a): a is Artifact => a !== null);
}

/** Whether an artifact's base kind is a special (INSTA_ART) kind. */
function isSpecial(art: Artifact): boolean {
  const kind = reg.lookupKind(art.tval, art.sval);
  return !!kind && kind.kindFlags.has(KF.INSTA_ART);
}

/**
 * A normal (non-special) artifact whose (tval, sval) is unique across the
 * whole artifact list, so a promotion/created test can isolate exactly that
 * artifact from an object of its base kind.
 */
function uniqueNormalArt(): Artifact {
  const arts = allArts();
  const found = arts.find((art) => {
    if (isSpecial(art)) return false;
    if (!reg.lookupKind(art.tval, art.sval)) return false;
    const sameBase = arts.filter(
      (o) => o.tval === art.tval && o.sval === art.sval,
    );
    return sameBase.length === 1;
  });
  if (!found) throw new Error("no unique-base normal artifact in pack");
  return found;
}

describe("make_artifact (apply_magic promotion)", () => {
  it("promotes a matching base item to its artifact and marks it created", () => {
    const art = uniqueNormalArt();
    const kind = reg.lookupKind(art.tval, art.sval)!;
    const depth = art.allocMin; /* in [allocMin, allocMax], no OOD roll */

    /* Find a seed on which the rarity roll passes (deterministic once found). */
    let winSeed = -1;
    for (let s = 1; s < 500 && winSeed < 0; s++) {
      const deps = freshDeps();
      const rng = new Rng(s);
      const obj = objectPrep(rng, reg, constants, kind, depth, "randomise");
      if (makeArtifact(rng, deps, obj, depth)) winSeed = s;
    }
    expect(winSeed).toBeGreaterThan(0);

    const deps = freshDeps();
    const rng = new Rng(winSeed);
    const obj = objectPrep(rng, reg, constants, kind, depth, "randomise");
    const ok = makeArtifact(rng, deps, obj, depth);

    expect(ok).toBe(true);
    expect(obj.artifact?.aidx).toBe(art.aidx);
    expect(deps.artifacts.isCreated(art.aidx)).toBe(true);
    /* copy_artifact_data copied the artifact's fixed combat data. */
    expect(obj.toA).toBe(art.toA);
    expect(obj.toH).toBe(art.toH);
    expect(obj.toD).toBe(art.toD);
    expect(obj.ac).toBe(art.ac);
  });

  it("does not regenerate an already-created artifact", () => {
    const art = uniqueNormalArt();
    const kind = reg.lookupKind(art.tval, art.sval)!;
    const depth = art.allocMin;

    const deps = freshDeps();
    deps.artifacts.markCreated(art.aidx, true);

    /* Its (tval, sval) is unique, so with it created there is no candidate at
     * all: every seed must fail, drawing no OOD/rarity roll for it. */
    for (let s = 1; s < 40; s++) {
      const rng = new Rng(s);
      const obj = objectPrep(rng, reg, constants, kind, depth, "randomise");
      const before = JSON.stringify(rng.getState());
      const ok = makeArtifact(rng, deps, obj, depth);
      expect(ok).toBe(false);
      expect(obj.artifact).toBeNull();
      /* No RNG consumed: the created guard precedes the OOD/rarity draws. */
      expect(JSON.stringify(rng.getState())).toBe(before);
    }
  });

  it("returns false with zero RNG when birth_no_artifacts is set", () => {
    const art = uniqueNormalArt();
    const kind = reg.lookupKind(art.tval, art.sval)!;
    const deps = freshDeps(true);
    const rng = new Rng(3);
    const obj = objectPrep(rng, reg, constants, kind, art.allocMin, "randomise");
    const before = JSON.stringify(rng.getState());
    expect(makeArtifact(rng, deps, obj, art.allocMin)).toBe(false);
    expect(JSON.stringify(rng.getState())).toBe(before);
  });

  it("returns false with zero RNG in town (depth <= 0)", () => {
    const art = uniqueNormalArt();
    const kind = reg.lookupKind(art.tval, art.sval)!;
    const deps = freshDeps();
    const rng = new Rng(3);
    const obj = objectPrep(rng, reg, constants, kind, art.allocMin, "randomise");
    const before = JSON.stringify(rng.getState());
    expect(makeArtifact(rng, deps, obj, 0)).toBe(false);
    expect(JSON.stringify(rng.getState())).toBe(before);
  });

  it("does not promote a stack (number != 1)", () => {
    const art = uniqueNormalArt();
    const kind = reg.lookupKind(art.tval, art.sval)!;
    const deps = freshDeps();
    const rng = new Rng(3);
    const obj = objectPrep(rng, reg, constants, kind, art.allocMin, "randomise");
    obj.number = 2;
    const before = JSON.stringify(rng.getState());
    expect(makeArtifact(rng, deps, obj, art.allocMin)).toBe(false);
    expect(JSON.stringify(rng.getState())).toBe(before);
  });
});

describe("make_artifact_special (make_object special roll)", () => {
  it("creates a special artifact and marks it created", () => {
    const special = allArts().find(
      (a) => isSpecial(a) && !!reg.lookupKind(a.tval, a.sval),
    );
    if (!special) throw new Error("no special artifact in pack");
    const depth = Math.max(special.allocMin, 1);

    /* Restrict the scan to this special's tval and find a passing seed. */
    let winSeed = -1;
    for (let s = 1; s < 800 && winSeed < 0; s++) {
      const deps = freshDeps();
      const rng = new Rng(s);
      const obj = makeArtifactSpecial(rng, deps, depth, special.tval);
      if (obj && obj.artifact) winSeed = s;
    }
    expect(winSeed).toBeGreaterThan(0);

    const deps = freshDeps();
    const rng = new Rng(winSeed);
    const obj = makeArtifactSpecial(rng, deps, depth, special.tval);
    expect(obj).not.toBeNull();
    expect(obj!.artifact).not.toBeNull();
    expect(isSpecial(obj!.artifact!)).toBe(true);
    expect(deps.artifacts.isCreated(obj!.artifact!.aidx)).toBe(true);
  });

  it("returns null with zero RNG when birth_no_artifacts / town", () => {
    const deps1 = freshDeps(true);
    const rng1 = new Rng(5);
    const b1 = JSON.stringify(rng1.getState());
    expect(makeArtifactSpecial(rng1, deps1, 50, 0)).toBeNull();
    expect(JSON.stringify(rng1.getState())).toBe(b1);

    const deps2 = freshDeps();
    const rng2 = new Rng(5);
    const b2 = JSON.stringify(rng2.getState());
    expect(makeArtifactSpecial(rng2, deps2, 0, 0)).toBeNull();
    expect(JSON.stringify(rng2.getState())).toBe(b2);
  });
});

describe("make_object special-artifact path", () => {
  it("a deep, good make_object can roll a special artifact", () => {
    /* good=true makes the special attempt one_in(10); scan seeds until one
     * make_object returns a special artifact via make_artifact_special. */
    let hit = false;
    for (let s = 1; s < 4000 && !hit; s++) {
      const deps = freshDeps();
      const rng = new Rng(s);
      const obj = makeObject(rng, deps, 100, true, false, false, 0, 100);
      if (obj && obj.artifact && isSpecial(obj.artifact)) {
        hit = true;
        expect(deps.artifacts.isCreated(obj.artifact.aidx)).toBe(true);
      }
    }
    expect(hit).toBe(true);
  });
});

describe("make_object *value out-parameter (obj-make.c L1211-1231, item #74)", () => {
  it("is untouched when the caller passes nothing (no extra work)", () => {
    const deps = freshDeps();
    const rng = new Rng(11);
    const obj = makeObject(rng, deps, 10, false, false, false, 0, 10);
    expect(obj).not.toBeNull();
  });

  it("special artifacts set outValue.value via object_value_real(obj, 1)", () => {
    /* Mirrors the special-artifact scan above; the special path returns
     * before the OOD boost, using quantity 1 (obj-make.c L1173). */
    let hit = false;
    for (let s = 1; s < 4000 && !hit; s++) {
      const deps = freshDeps();
      const rng = new Rng(s);
      const rating: MakeObjectRating = { value: -1 };
      const obj = makeObject(rng, deps, 100, true, false, false, 0, 100, rating);
      if (obj && obj.artifact && isSpecial(obj.artifact)) {
        hit = true;
        expect(rating.value).toBe(objectValueReal(deps.reg, obj, 1));
      }
    }
    expect(hit).toBe(true);
  });

  it("boosts the value 20% per level OOD for uncursed objects, matching the exact clamp arithmetic", () => {
    /* Depth 0 guarantees kind.allocMin > depth for any kind with a positive
     * allocMin, which is common; scan seeds for such a draw. */
    const deps = freshDeps();
    let checked = false;
    for (let seed = 1; seed < 500 && !checked; seed++) {
      const rng = new Rng(seed);
      const rating: MakeObjectRating = { value: 0 };
      const obj = makeObject(rng, deps, 5, false, false, false, 0, 0, rating);
      if (!obj || obj.artifact) continue; /* skip the special-artifact path */
      if (obj.curses) continue;
      if (obj.kind.allocMin <= 0) continue;

      const base = objectValueReal(deps.reg, obj, obj.number);
      const ood = obj.kind.allocMin; /* - depth(0) */
      const frac = Math.trunc(Math.max(base, 0) / 5);
      expect(rating.value).toBe(base + ood * frac);
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it("skips the OOD boost for a cursed object even when allocMin > depth", () => {
    /* Wearables can be cursed (rng.oneIn(20)); scan for one, at depth 0 so
     * the boost condition (allocMin > depth) would otherwise fire. */
    const deps = freshDeps();
    let checked = false;
    for (let seed = 1; seed < 4000 && !checked; seed++) {
      const rng = new Rng(seed);
      const rating: MakeObjectRating = { value: 0 };
      const obj = makeObject(rng, deps, 5, false, false, false, 0, 0, rating);
      if (!obj || obj.artifact || !obj.curses) continue;
      if (obj.kind.allocMin <= 0) continue;
      expect(rating.value).toBe(objectValueReal(deps.reg, obj, obj.number));
      checked = true;
    }
    expect(checked).toBe(true);
  });
});

describe("ArtifactState persistence", () => {
  it("snapshot/restore round-trips created flags", () => {
    const s = new ArtifactState(reg.artifacts.length);
    s.markCreated(3, true);
    s.markCreated(7, true);
    const restored = ArtifactState.restore(s.snapshot());
    expect(restored.isCreated(3)).toBe(true);
    expect(restored.isCreated(7)).toBe(true);
    expect(restored.isCreated(4)).toBe(false);
    restored.reset();
    expect(restored.isCreated(3)).toBe(false);
  });
});
