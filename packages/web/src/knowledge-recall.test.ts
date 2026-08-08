/**
 * PORT_TODO 3.3: the assembly half of the two object-side knowledge recalls -
 * desc_obj_fake (ui-knowledge.c L1938) and desc_ego_fake (L1789). The
 * PRODUCERS (make_fake_kind / object_info_ego / describe_ego) are tested in
 * core; what is tested here is what the browser actually shows: the header
 * object_desc builds, the body object_info produces, and the one branch the
 * port's knowledge shadow cannot express - an unaware flavoured kind, whose
 * blank twin makes object_info_out return at its first line.
 *
 * These run against a REAL started game rather than a stub, because the whole
 * failure mode being closed here was a recall that looked fine while producing
 * nothing: a fixture that returns lines would hide it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  startGame,
  playerLearnAllRunes,
  blankObjKnowledge,
  makeFakeArtifact,
  Rng,
  type GamePack,
  type GameState,
  type ObjectKind,
  type ObjectInfoExtras,
  type EgoItem,
} from "@rpgm-tools/neo-angband-core";
import {
  objectFakeRecall,
  egoFakeRecall,
  artifactFakeRecall,
  type FakeRecallDeps,
  type ObjectRecallDeps,
  type ArtifactKnowledgeDeps,
} from "./knowledge";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  obj: {
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
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
};

const { state, booted, flavor } = startGame(pack, { seed: 4242, depth: 1 });
const reg = booted.registries.objects;

const extras: ObjectInfoExtras = {
  projections: booted.registries.projections ?? [],
  constants: booted.registries.constants,
  timedDesc: (i) => state.world?.timedTable[i]?.desc ?? "",
  summonDesc: (i) => booted.registries.monsters.summons[i]?.desc ?? "",
};

const recallDeps = (): FakeRecallDeps => ({
  state: state as GameState,
  reg,
  constants: booted.registries.constants,
  player: state.actor.player,
  inspectExtras: extras,
  runeEnv: state.runeEnv,
});

const hasFlavor = (k: ObjectKind): boolean => state.hasFlavor?.(k) ?? false;

function browserDeps(aware: (k: ObjectKind) => boolean): ObjectRecallDeps {
  return {
    isAware: aware,
    wasTried: (k) => flavor.wasTried(k),
    everseen: () => true,
    hasFlavor,
    kindName: (k, a) =>
      !a && hasFlavor(k)
        ? (state.flavorText?.(k) ?? "")
        : k.name.replace(/[~&]/gu, " ").trim(),
    recall: recallDeps(),
  };
}

/** A melee weapon: unflavoured, so desc_obj_fake takes its "aware" branch. */
const sword = reg.kinds.find((k) => k.name.includes("Short Sword"))!;
/** A flavoured kind, so the unaware branch is reachable. */
const potion = reg.kinds.find((k) => hasFlavor(k) && k.name.includes("Cure Light Wounds"))!;

const body = (lines: { text: string }[]): string => lines.map((l) => l.text).join("\n");

describe("objectFakeRecall (desc_obj_fake, ui-knowledge.c L1938)", () => {
  it("shows the computed object_info body, not just a name and a blurb", () => {
    /* The gap this closes: the recall used to be the kind name plus kind.text.
     * These lines all come from object_info and none of them are in the record
     * - the flavour paragraph is, so assert on the COMPUTED ones. */
    const { title, lines } = objectFakeRecall(browserDeps(() => true), sword);
    const text = body(lines);
    expect(title).toMatch(/short sword/iu);
    expect(text).toMatch(/blows\/round/u);
    expect(text).toMatch(/Average damage\/round/u);
    expect(text).not.toBe("");
  });

  it("suppresses exact modifier magnitudes, because OINFO_FAKE says to", () => {
    /* describe_stats' suppress_details covers OINFO_EGO *and* OINFO_FAKE
     * (obj-info.c L2076): "each real one will be different". A recall that
     * printed "+5 tunneling" would be describing a roll nobody will ever see. */
    const digger = reg.kinds.find(
      (k) => k.name.includes("Digging") && k.modifiers.some((m) => m.dice > 0),
    );
    expect(digger, "no Ring of Digging with a dice modifier in the pack").toBeTruthy();
    const text = body(objectFakeRecall(browserDeps(() => true), digger!).lines);
    expect(text).toContain("Affects your tunneling.");
    expect(text).not.toMatch(/[+-]\d+ tunneling/u);
  });

  it("says only 'You do not know what this is' for an unaware flavoured kind", () => {
    /* Upstream's known twin is a blank OBJECT_NULL here, so object_info_out
     * returns at its very first branch. The port's shadow always mirrors
     * obj.kind, so this branch is the call site's job - and if it were missing,
     * an unidentified potion would leak its full effect list. */
    const { title, lines } = objectFakeRecall(browserDeps(() => false), potion);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("You do not know what this is.");
    expect(title).not.toMatch(/Cure Light Wounds/u);
    expect(title.length).toBeGreaterThan(0);
  });

  it("treats an UNFLAVOURED kind as known even when isAware says no", () => {
    /* `kind->aware || !kind->flavor` (L1958). A sword has no flavour to be
     * unaware of, so dropping the second half would blank the recall for every
     * weapon and every piece of armour in the browser. */
    const { lines } = objectFakeRecall(browserDeps(() => false), sword);
    expect(body(lines)).toMatch(/blows\/round/u);
  });

  it("shows the effect once the same kind is aware", () => {
    /* The pair: same kind, awareness flipped. Without this the negative test
     * above would also pass on a recall that never printed anything. */
    const text = body(objectFakeRecall(browserDeps(() => true), potion).lines);
    expect(text).toMatch(/heals/iu);
  });

  it("does not disturb the live player's knowledge or the game RNG", () => {
    /* The scratch player exists so browsing cannot teach the real one. */
    const before = JSON.stringify(state.actor.player.objKnown);
    const rngSnapshot = state.rng.getState();
    const expected = state.rng.randint0(1_000_000);
    state.rng.setState(rngSnapshot);
    for (const k of reg.kinds.slice(0, 300)) {
      objectFakeRecall(browserDeps(() => true), k);
    }
    expect(JSON.stringify(state.actor.player.objKnown)).toBe(before);
    expect(state.rng.randint0(1_000_000)).toBe(expected);
  });
});

describe("egoFakeRecall (desc_ego_fake, ui-knowledge.c L1789)", () => {
  const anyEgo = (): EgoItem => reg.egos.find((e) => e.firstPossItem >= 0)!;

  it("heads the page with '<group name> <ego name>' (L1801)", () => {
    const e = anyEgo();
    const { title } = egoFakeRecall(recallDeps(), e, "Sword");
    expect(title).toBe(`Sword ${e.name}`);
  });

  it("shows object_info_ego's computed lines", () => {
    const e = reg.egos.find((x) => x.name === "(Holy Avenger)")!;
    const text = body(egoFakeRecall(recallDeps(), e, "Sword").lines);
    expect(text).toContain("It provides one random sustain.");
    expect(text).toContain("Slays undead");
  });

  it("reads the same to a character who knows nothing", () => {
    /* object_info_ego's twin is a full object_copy, so an ego recall is not a
     * function of the browsing player's runes. Compare a fresh player against
     * a rune-complete one through the SAME entry point. */
    const e = reg.egos.find((x) => x.name === "(Holy Avenger)")!;
    const fresh = body(egoFakeRecall(recallDeps(), e, "Sword").lines);

    const learned = { ...state.actor.player, objKnown: blankObjKnowledge() };
    playerLearnAllRunes(learned, state.runeEnv);
    const knowing = body(
      egoFakeRecall({ ...recallDeps(), player: learned }, e, "Sword").lines,
    );
    expect(fresh).toBe(knowing);
    expect(fresh).not.toBe("");
  });

  it("does not disturb the game RNG across the whole ego catalogue", () => {
    const snapshot = state.rng.getState();
    const expected = state.rng.randint0(1_000_000);
    state.rng.setState(snapshot);
    for (const e of reg.egos) egoFakeRecall(recallDeps(), e, "Sword");
    expect(state.rng.randint0(1_000_000)).toBe(expected);
  });
});

describe("artifactFakeRecall (desc_art_fake, ui-knowledge.c L1610)", () => {
  /**
   * Browsing an artifact ADVANCES the game RNG, because upstream's does.
   *
   * desc_art_fake calls make_fake_artifact with no stream of its own (L1629),
   * so copy_artifact_data's copy_curses step rolls the curse timeout
   * (obj-curse.c:67) off Angband's global RNG. The port used to hand it a
   * throwaway Rng at a fixed seed, which meant browsing was free and an
   * artifact previewed identically every time. Both are nicer than Angband and
   * neither is Angband, so both went.
   *
   * The assertion is deliberately the opposite of the two RNG-stability tests
   * above: object_prep draws nothing, so desc_obj_fake and desc_ego_fake really
   * do leave the stream alone upstream, and those tests are parity claims.
   * This one would pass trivially if written the same way, so it is written the
   * only way a restored private stream fails it.
   */
  const artifactDeps = (): ArtifactKnowledgeDeps => ({
    ...recallDeps(),
    artState: { isFound: () => false } as unknown as ArtifactKnowledgeDeps["artState"],
  });

  it("advances the game RNG, as desc_art_fake does", () => {
    /* Only a CURSED artifact draws - copy_curses is the sole caller of the RNG
     * in this path - so find one rather than trusting the set to contain any. */
    const cursed = reg.artifacts.find((a) => a && (a.curses?.length ?? 0) > 0);
    expect(cursed, "the pack must ship a cursed artifact").toBeTruthy();

    const before = JSON.stringify(state.rng.getState());
    artifactFakeRecall(artifactDeps(), cursed!);
    expect(JSON.stringify(state.rng.getState())).not.toBe(before);
  });

  it("is the stream that moves it, not the call", () => {
    /* The control, so the assertion above cannot pass for a reason other than
     * the one it names. This is the code that USED to run: the identical build
     * against a private stream. If it also moved the game RNG, the test above
     * would be measuring something else and would stay green through a revert. */
    const cursed = reg.artifacts.find((a) => a && (a.curses?.length ?? 0) > 0)!;
    const before = JSON.stringify(state.rng.getState());
    makeFakeArtifact(reg, booted.registries.constants, cursed, new Rng(1));
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });
});
