/**
 * What birth_randarts does to a MOD-CONTRIBUTED artifact.
 *
 * WHY THIS FILE EXISTS. A code read of design_artifact raised the claim that a
 * mod-added artifact is silently overwritten by a randomly designed one when
 * birth_randarts is on, so the mod author's artifact never appears. The reasoning
 * ran: the fixed-artifact skip loop (obj-randart.c L2777-L2787) reads a STALE
 * `kind`, so with core's pack alone the walk runs off the end of the array
 * harmlessly, and appending one mod artifact gives the walk somewhere to land.
 *
 * That claim is FALSE, and the tests below are what settles it. The stale-kind
 * quirk makes the QUEST_ART branch of the loop condition permanently true once it
 * is true at all, because the condition never re-reads the kind of the artifact
 * the walk advanced onto. So the walk does not "land" anywhere: it consumes every
 * remaining slot and returns. Core's two quest artifacts are the LAST two records
 * in artifact.json and mods append after core, which puts every mod artifact
 * behind the point where the walk starts eating slots. A mod artifact is
 * therefore preserved verbatim, and preserved for a reason a reader would never
 * guess from the code.
 *
 * THE TESTS ARE KEPT EITHER WAY. "Preserved by accident of position" is exactly
 * the kind of property that a later change breaks without noticing: give the
 * composer a reason to sort artifact records, or move a quest artifact off the
 * tail of the pack, and mod artifacts start being redesigned. The last test in
 * the first block is the demonstration of that - an artifact bound BEFORE the
 * quest artifacts is redesigned, so position is the whole mechanism.
 *
 * WHAT THE READ DID FIND. The swap loses a mod artifact's PROVENANCE, which is
 * the second block. `ContentIdResolver` mints an artifact's save id from
 * `from.owner`, so a mod artifact whose provenance is dropped is written into the
 * savefile under core's namespace.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KF } from "../generated/index.js";
import { ObjRegistry } from "./bind.js";
import { bindConstants } from "../constants.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import type { Artifact, ArtifactRecordJson, ObjPackJson } from "./types.js";
import { doRandart } from "./randart.js";
import { ContentIdResolver } from "../mod/ids.js";

/**
 * An artifact record as a MOD ships it: core's own fields, plus the composer's
 * `$from` stamp and any namespaced field of the mod's own. `ArtifactRecordJson`
 * describes core's keys only and deliberately has no index signature, so the
 * widening is spelled out here rather than cast at each use.
 */
type ModArtifactRecord = ArtifactRecordJson & Record<string, unknown>;

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

/** object_prep's z_info, for the real make_fake_artifact inside artifactPower. */
const constants = bindConstants(loadJson("constants"));

/**
 * The artifact record the modding tutorial teaches authors to write, read from
 * the tutorial itself rather than copied in here.
 *
 * Copying it would make this file an assertion about what a mod artifact looks
 * like; reading the shipped tutorial makes it a measurement of the record a mod
 * author is actually told to write. `$from` is the provenance stamp the composer
 * puts on every record a pack contributes (mod/extension.ts PROVENANCE_KEY), and
 * it is added here because the tutorial folder is a pack SOURCE - the stamp is
 * applied during composition, which this test does not run.
 */
function tutorialArtifact(): ModArtifactRecord {
  const doc = JSON.parse(
    readFileSync(
      new URL(
        "../../../../samples/tutorials/tutorial-07-add-an-artifact/artifact.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { records: ArtifactRecordJson[] };
  const rec = doc.records[0];
  expect(rec, "tutorial-07 still ships an artifact record").toBeTruthy();
  return { ...(rec as ArtifactRecordJson), $from: { owner: "tutorial" } };
}

/**
 * A registry bound from core's own pack, with `extra` artifact records appended
 * (`before` ones spliced in ahead of core's, for the position test).
 *
 * Appending is what composePacks does: mod records land after the records of
 * every pack loaded before them, and bindArtifacts assigns `aidx` by push order.
 * The composer is not driven here because it lives in `@rpgm-tools/-mod-sdk`,
 * which depends on core; importing it from a core test would be a package cycle.
 * What matters to design_artifact is the resulting ORDER, and that is reproduced
 * exactly.
 */
function makeReg(
  extra: readonly ArtifactRecordJson[] = [],
  before: readonly ArtifactRecordJson[] = [],
): ObjRegistry {
  const artifact = loadJson<{ records: ArtifactRecordJson[] }>("artifact");
  const reg = new ObjRegistry({
    objectBase: loadJson("object_base"),
    object: loadJson("object"),
    egoItem: loadJson("ego_item"),
    artifact: { ...artifact, records: [...before, ...artifact.records, ...extra] },
    curse: loadJson("curse"),
    brand: loadJson("brand"),
    slay: loadJson("slay"),
    activation: loadJson("activation"),
    objectProperty: loadJson("object_property"),
    flavor: loadJson("flavor"),
  } as ObjPackJson);
  /* add_brand and the randart log read projections[i].name, so a registry
   * without them cannot run do_randart at all. */
  reg.projections = bindProjections(
    loadJson<{ records: ProjectionRecordJson[] }>("projection").records,
  );
  return reg;
}

/** Every slot do_randart left exactly as the standard set had it. */
function preservedIndices(
  reg: ObjRegistry,
  generated: readonly (Artifact | null)[],
): number[] {
  const out: number[] = [];
  for (let i = 1; i < generated.length; i++) {
    const before = reg.artifacts[i];
    const after = generated[i];
    if (before && after && before.name === after.name) out.push(i);
  }
  return out;
}

/** The aidx of the first artifact whose base kind carries KF_QUEST_ART. */
function firstQuestArt(reg: ObjRegistry): number {
  for (let i = 1; i < reg.artifacts.length; i++) {
    const art = reg.artifacts[i];
    if (!art) continue;
    const kind = reg.lookupKind(art.tval, art.sval);
    if (kind?.kindFlags.has(KF.QUEST_ART)) return i;
  }
  return -1;
}

/* Two seeds rather than one, so a claim about the whole set is not resting on
 * one draw sequence. Neither is special. */
const SEEDS = [4242, 20260821];

describe("birth_randarts does NOT overwrite a mod-added artifact", () => {
  it("leaves the mod artifact's authored name and every stat it declared", () => {
    const rec = tutorialArtifact();
    for (const seed of SEEDS) {
      const reg = makeReg([rec]);
      const last = reg.artifacts.length - 1;
      const authored = reg.artifacts[last] as Artifact;
      expect(authored.name, "the mod artifact is bound at the tail").toBe(
        rec.name,
      );

      const generated = doRandart(reg, constants, seed, false);
      const got = generated[last];
      expect(got, `seed ${String(seed)}: slot ${String(last)} exists`).toBeTruthy();
      const after = got as Artifact;

      /* The authored identity, not a random name. */
      expect(after.name, `seed ${String(seed)}: name`).toBe(rec.name);
      /* And the authored numbers: a redesign replaces the base item outright,
       * so tval/sval/ac/to-a are what would move first if it had been touched. */
      expect(after.tval).toBe(authored.tval);
      expect(after.sval).toBe(authored.sval);
      expect(after.ac).toBe(authored.ac);
      expect(after.toA).toBe(authored.toA);
      expect(after.level).toBe(authored.level);
      expect(after.allocProb).toBe(authored.allocProb);
      expect(after.text).toBe(authored.text);
      expect(after.flags.count()).toBe(authored.flags.count());
      expect(after.modifiers).toEqual(authored.modifiers);
    }
  });

  it("survives because the stale-kind walk eats every slot from the first quest artifact on", () => {
    /*
     * THIS is the mechanism, and it is not the one a reading of the skip loop
     * suggests. design_artifact captures `kind` once, before the loop, and the
     * loop's QUEST_ART test keeps reading that capture while its name test
     * tracks the advancing artifact (obj-randart.c L2754 vs L2778). So the
     * moment design_artifact is entered ON a quest artifact, the condition is
     * true forever and the walk runs to the end of the array and returns
     * without designing anything.
     *
     * Measured rather than argued: with core alone the preserved slots are The
     * One Ring plus the tail from the first quest artifact onward, and adding a
     * mod artifact extends that tail by exactly the mod's slot.
     */
    const quest = firstQuestArt(makeReg());
    expect(quest, "core's pack still has a quest artifact").toBeGreaterThan(0);

    for (const seed of SEEDS) {
      const plain = makeReg();
      const plainKept = preservedIndices(plain, doRandart(plain, constants, seed, false));
      /* Everything from the first quest artifact to the end of core's set. */
      const plainTail = plainKept.filter((i) => i >= quest);
      const expectedTail: number[] = [];
      for (let i = quest; i < plain.artifacts.length; i++) expectedTail.push(i);
      expect(plainTail, `seed ${String(seed)}: core tail`).toEqual(expectedTail);

      const modded = makeReg([tutorialArtifact()]);
      const modKept = preservedIndices(modded, doRandart(modded, constants, seed, false));
      const modTail = modKept.filter((i) => i >= quest);
      const expectedModTail: number[] = [];
      for (let i = quest; i < modded.artifacts.length; i++) expectedModTail.push(i);
      expect(modTail, `seed ${String(seed)}: modded tail`).toEqual(expectedModTail);

      /* Exactly one more preserved slot, which is the mod's. */
      expect(modTail.length).toBe(plainTail.length + 1);
    }
  });

  it("is POSITION that saves it: an artifact bound ahead of the quest artifacts is redesigned", () => {
    /*
     * The guard on the finding above. Nothing in design_artifact protects a
     * mod's artifact as such; what protects it is sitting behind the slot where
     * the stale-kind walk begins. Bind the same record ahead of core's records
     * and it is designed over like any other artifact - so if the composer ever
     * sorts artifact records, or a pack ever puts a quest artifact somewhere
     * other than the tail, the first test in this block stops being true and
     * this one says why.
     */
    const rec = tutorialArtifact();
    const reg = makeReg([], [rec]);
    expect((reg.artifacts[1] as Artifact).name).toBe(rec.name);
    const generated = doRandart(reg, constants, SEEDS[0] as number, false);
    expect((generated[1] as Artifact).name).not.toBe(rec.name);
  });
});

describe("the randart swap keeps a mod artifact's provenance", () => {
  /*
   * WHY THIS IS NOT COSMETIC. ContentIdResolver mints an artifact's savefile id
   * from `from.owner` (mod/ids.ts packOf), and from `from.was.name` when a later
   * pack renamed it. doRandart returns a fresh array built by cloneArtifact, and
   * session/game.ts swapRandartSet installs that array as the registry's
   * artifacts wholesale. A clone that drops `from` therefore renames the mod
   * artifact's save id from "tutorial:..." to "core:...", and drops `ext`, which
   * is where a mod's own fields on the record live and the only place a plugin
   * can read them back.
   */
  it("carries `from` and `ext` onto the generated set", () => {
    const rec = { ...tutorialArtifact(), "tutorial:sigil": "open-eye" };
    const reg = makeReg([rec]);
    const last = reg.artifacts.length - 1;
    const authored = reg.artifacts[last] as Artifact;
    expect(authored.from?.owner, "bound with provenance").toBe("tutorial");
    expect(authored.ext, "bound with the mod's own field").toEqual({
      "tutorial:sigil": "open-eye",
    });

    const generated = doRandart(reg, constants, SEEDS[0] as number, false);
    const after = generated[last] as Artifact;
    expect(after.from?.owner).toBe("tutorial");
    expect(after.ext).toEqual({ "tutorial:sigil": "open-eye" });
  });

  it("keeps the mod artifact's savefile id in the mod's namespace", () => {
    /* The consequence, stated as the thing a player would lose: the id written
     * into the save for this artifact. Read through the real resolver rather
     * than re-deriving the id here, because the id format is the resolver's to
     * define. */
    const reg = makeReg([tutorialArtifact()]);
    const last = reg.artifacts.length - 1;
    const before = new ContentIdResolver({ objects: reg }).artifactId(last);
    expect(before.startsWith("tutorial:")).toBe(true);

    const swapped = makeReg([tutorialArtifact()]);
    const generated = doRandart(swapped, constants, SEEDS[0] as number, false);
    swapped.artifacts.length = 0;
    swapped.artifacts.push(...generated);
    const after = new ContentIdResolver({ objects: swapped }).artifactId(last);
    expect(after).toBe(before);
  });
});
