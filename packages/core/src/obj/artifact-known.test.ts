import { describe, expect, it } from "vitest";
import {
  artifactIsKnown,
  findArtifact,
  liveObjectIsKnownArtifact,
  type ArtifactKnownEnv,
} from "./artifact-known";
import { OBJ_NOTICE } from "./knowledge";
import type { GameObject } from "./object";
import type { Artifact } from "./types";

const artOf = (aidx: number, name = `Artifact ${aidx}`): Artifact =>
  ({ aidx, name, tval: 1, sval: 1 }) as unknown as Artifact;

/** A live object carrying (or not) an artifact + its notice/ASSESSED bit. */
const objOf = (art: Artifact | null, assessed: boolean): GameObject =>
  ({
    artifact: art,
    notice: assessed ? OBJ_NOTICE.ASSESSED : 0,
  }) as unknown as GameObject;

function makeEnv(
  objects: GameObject[],
  created: Set<number>,
  wizard = false,
): ArtifactKnownEnv {
  return {
    worldObjects: () => objects,
    isCreated: (aidx) => created.has(aidx),
    wizard,
  };
}

describe("liveObjectIsKnownArtifact (obj-knowledge.c L552, shadow L512)", () => {
  it("is true only for an artifact object that has been ASSESSED", () => {
    const art = artOf(3);
    expect(liveObjectIsKnownArtifact(objOf(art, true))).toBe(true);
    expect(liveObjectIsKnownArtifact(objOf(art, false))).toBe(false);
    expect(liveObjectIsKnownArtifact(objOf(null, true))).toBe(false);
  });
});

describe("findArtifact (ui-knowledge.c L1537)", () => {
  it("returns the live object bearing the artifact, else null", () => {
    const art = artOf(4);
    const obj = objOf(art, false);
    const env = makeEnv([objOf(null, true), obj], new Set([4]));
    expect(findArtifact(env, 4)).toBe(obj);
    expect(findArtifact(env, 5)).toBeNull();
  });
});

describe("artifactIsKnown (ui-knowledge.c L1687)", () => {
  it("requires a name", () => {
    const art = artOf(1, "");
    expect(artifactIsKnown(art, makeEnv([], new Set([1])))).toBe(false);
  });

  it("wizard mode reveals every named artifact", () => {
    const art = artOf(1);
    expect(artifactIsKnown(art, makeEnv([], new Set(), true))).toBe(true);
  });

  it("an uncreated artifact is not known", () => {
    const art = artOf(2);
    expect(artifactIsKnown(art, makeEnv([], new Set()))).toBe(false);
  });

  it("created with no live copy is known (found and lost)", () => {
    const art = artOf(2);
    expect(artifactIsKnown(art, makeEnv([], new Set([2])))).toBe(true);
  });

  it("created but a live UNIDENTIFIED copy exists: NOT known (no leak)", () => {
    const art = artOf(2);
    const env = makeEnv([objOf(art, false)], new Set([2]));
    expect(artifactIsKnown(art, env)).toBe(false);
  });

  it("created and the live copy is identified: known", () => {
    const art = artOf(2);
    const env = makeEnv([objOf(art, true)], new Set([2]));
    expect(artifactIsKnown(art, env)).toBe(true);
  });
});
