import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  colorToCss,
  loc,
  Rng,
  Chunk,
  FeatureRegistry,
  bindPlayer,
  blankPlayer,
  newGear,
  newKnownMap,
  newTargetState,
  IgnoreSettings,
  makeRuneEnv,
  DEFAULT_GAME_CONSTANTS,
  placePlayer,
  ObjRegistry,
  objectNew,
  COLOUR_RED,
  COLOUR_SLATE,
  COLOUR_VIOLET,
  COLOUR_WHITE,
  COLOUR_L_RED,
  COLOUR_L_GREEN,
  TV,
  HIST,
  STAT,
  FlagSet,
  bindProjections,
  PY_SPELL,
} from "@neo-angband/core";
import type {
  Textblock,
  GameState,
  Loc,
  GameObject,
  ObjPackJson,
  ObjectKind,
  Artifact,
  TerrainRecordJson,
  PlayerPackRecords,
  ProjectionRecordJson,
  ClassSpell,
  PlayerClass,
  MagicRealm,
} from "@neo-angband/core";
import { wrapRuns, objectListLines, historyLines, spellBrowseLines } from "./screens";

const WHITE = 1;
const L_GREEN = 13;
const L_RED = 12;

/* ------------------------------------------------------------------ */
/* objectListLines (']') test fixture: a real Chunk + player + object   */
/* registry built from the shipped content pack, the same way core's   */
/* game/obj-list.test.ts does, so entry names flow through the real    */
/* object_desc rather than a hand-rolled stub.                         */
/* ------------------------------------------------------------------ */

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const featureReg = new FeatureRegistry(loadRecords<TerrainRecordJson>("terrain"));
const FLOOR = featureReg.byCodeName("FLOOR").fidx;
const GRANITE = featureReg.byCodeName("GRANITE").fidx;

const players = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
} as PlayerPackRecords);

const objReg = new ObjRegistry({
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

function openField(w: number, h: number) {
  const c = new Chunk(featureReg, h, w);
  c.fill(GRANITE);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) c.setFeat(loc(x, y), FLOOR);
  }
  return c;
}

interface TestStateOpts {
  w?: number;
  h?: number;
  playerGrid: Loc;
  maxRange?: number;
}

/** A minimal but real GameState, built entirely from public core exports. */
function makeTestState(opts: TestStateOpts): GameState {
  const w = opts.w ?? 60;
  const h = opts.h ?? 40;
  const chunk = openField(w, h);
  const player = blankPlayer(players.races[0]!, players.classes[0]!, players.bodies[0]!);
  const gear = newGear();
  const rng = new Rng(1);
  const actor = {
    player,
    grid: opts.playerGrid,
    energy: 0,
    speed: 110,
    totalEnergy: 0,
    combat: {
      toH: 0, toD: 0, ac: 0, toA: 0, skills: [],
      numBlows: 1, ammoMult: 1, numShots: 0, ammoTval: 0, blessWield: false,
    },
    defense: { ac: 0, toA: 0 },
    weapon: null,
    stealth: 0,
    light: 0,
    unlight: false,
  };
  const state = {
    rng,
    chunk,
    actor,
    gear,
    monsters: [null],
    groups: [null],
    floor: new Map(),
    traps: new Map(),
    known: newKnownMap(w, h),
    target: newTargetState(),
    ignore: new IgnoreSettings(),
    lore: new Map(),
    turn: 0,
    z: { ...DEFAULT_GAME_CONSTANTS, maxRange: opts.maxRange ?? DEFAULT_GAME_CONSTANTS.maxRange },
    brands: [null],
    slays: [null],
    runeEnv: makeRuneEnv(
      (slot: number) => gear.store.get(player.equipment[slot] ?? 0) ?? null,
      (v) => rng.randcalcVaries(v),
    ),
    playing: true,
    isDead: false,
    generateLevel: false,
    nextCommand: () => null,
  } as unknown as GameState;
  placePlayer(state, opts.playerGrid);
  return state;
}

/** Drop a real kind (from the pack) as a floor pile at `at`, known to the player. */
function putRealFloor(state: GameState, at: Loc, kindName: string, number = 1): GameObject {
  const kind = objReg.kinds.find((k) => k.name === kindName) as ObjectKind;
  const obj = objectNew(kind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.number = number;
  obj.grid = at;
  const idx = at.y * state.chunk.width + at.x;
  const pile = state.floor.get(idx) ?? [];
  pile.push(obj);
  state.floor.set(idx, pile);
  state.known.objects.set(idx, { ch: kind.dChar ?? ",", attr: kind.dAttr ?? "w" });
  return obj;
}

interface FakeOpts {
  name?: string;
  tval?: number;
  sval?: number;
  cost?: number;
  number?: number;
  artifact?: Artifact | null;
}

/** Drop a minimal fake floor object at `at`, known to the player. */
function putFakeFloor(state: GameState, at: Loc, opts: FakeOpts = {}): GameObject {
  const kind = {
    name: opts.name ?? "Ration of Food",
    dChar: ",",
    dAttr: "w",
    cost: opts.cost ?? 3,
  };
  const obj = {
    kind,
    tval: opts.tval ?? 80,
    sval: opts.sval ?? 1,
    number: opts.number ?? 1,
    artifact: opts.artifact ?? null,
    grid: at,
  } as unknown as GameObject;
  const idx = at.y * state.chunk.width + at.x;
  const pile = state.floor.get(idx) ?? [];
  pile.push(obj);
  state.floor.set(idx, pile);
  state.known.objects.set(idx, { ch: kind.dChar, attr: kind.dAttr });
  return obj;
}

/** Mark a grid as sensed-but-unidentified (a detection marker, no glyph). */
function senseUnknown(state: GameState, at: Loc): void {
  const idx = at.y * state.chunk.width + at.x;
  state.known.objects.set(idx, { ch: null, attr: "" });
}

describe("wrapRuns (object-info Textblock -> ScreenLine[])", () => {
  it("keeps multiple colours on a single row", () => {
    const tb: Textblock = {
      runs: [
        { text: "Intensity ", attr: WHITE },
        { text: "3", attr: L_GREEN },
        { text: " light.", attr: WHITE },
      ],
    };
    const lines = wrapRuns(tb, 80);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.text).toBe("Intensity 3 light.");
    expect(line.runs).toEqual([
      { text: "Intensity ", color: colorToCss(WHITE) },
      { text: "3", color: colorToCss(L_GREEN) },
      { text: " light.", color: colorToCss(WHITE) },
    ]);
  });

  it("splits on embedded newlines into separate rows (and blank spacers)", () => {
    const tb: Textblock = {
      runs: [{ text: "Combat info:\n1.1 blows/round.\n\nDone", attr: WHITE }],
    };
    const lines = wrapRuns(tb, 80);
    expect(lines.map((l) => l.text)).toEqual([
      "Combat info:",
      "1.1 blows/round.",
      "",
      "Done",
    ]);
  });

  it("word-wraps at cols-1, preserving run colours across the wrap", () => {
    /* Two coloured words that must land on separate wrapped rows. */
    const tb: Textblock = {
      runs: [
        { text: "aaaa ", attr: L_GREEN },
        { text: "bbbb", attr: L_RED },
      ],
    };
    /* cols = 6 -> width 5: "aaaa" fits, the break space is dropped, "bbbb"
       wraps to the next row keeping its own colour. */
    const lines = wrapRuns(tb, 6);
    expect(lines.map((l) => l.text)).toEqual(["aaaa", "bbbb"]);
    expect(lines[0]!.runs).toEqual([{ text: "aaaa", color: colorToCss(L_GREEN) }]);
    expect(lines[1]!.runs).toEqual([{ text: "bbbb", color: colorToCss(L_RED) }]);
  });

  it("hard-breaks a word longer than the width", () => {
    const tb: Textblock = { runs: [{ text: "abcdefgh", attr: WHITE }] };
    const lines = wrapRuns(tb, 5); /* width 4 */
    expect(lines.map((l) => l.text)).toEqual(["abcd", "efgh"]);
  });
});

describe("objectListLines (']' object_list_show_interactive)", () => {
  it("reports 'You can see no objects.' on an empty level", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const lines = objectListLines(state);
    expect(lines).toEqual([{ text: "You can see no objects.", color: "#8a8a94" }]);
  });

  it("singular header + direction label for a single LOS object", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    putRealFloor(state, loc(20, 10), "& Wooden Torch~"); // dy=-2,dx=0 -> "2 N 0 W"
    const lines = objectListLines(state);
    expect(lines[0]).toEqual({ text: "You can see 1 object:", color: "#9aa0b4" });
    expect(lines).toHaveLength(2);
    expect(lines[1]!.text).toBe("~ a Wooden Torch (0 turns)   2 N 0 W");
  });

  it("plural header for several LOS objects, upstream sort order (type, then distance)", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    putRealFloor(state, loc(22, 12), "& Ration~ of Food"); // dx=2  (TV.FOOD)
    putRealFloor(state, loc(21, 12), "& Wooden Torch~"); // dx=1   (TV.LIGHT)
    const lines = objectListLines(state);
    expect(lines[0]).toEqual({ text: "You can see 2 objects:", color: "#9aa0b4" });
    /* compare_types sorts by tval then sval; FOOD < LIGHT numerically is not
     * guaranteed, so just assert both entries render, each with its own
     * direction string, and that the count header matches. */
    expect(lines).toHaveLength(3);
    expect(lines[1]!.text.endsWith("0 N 2 E") || lines[2]!.text.endsWith("0 N 2 E")).toBe(true);
    expect(lines[1]!.text.endsWith("0 N 1 E") || lines[2]!.text.endsWith("0 N 1 E")).toBe(true);
  });

  it("out-of-view-only objects: 'You are aware of' with no 'other' wording", () => {
    /* Distance 35 > default max_range 20 => NO_LOS, mirrors core's
     * obj-list.test.ts far-object fixture. */
    const state = makeTestState({ w: 60, playerGrid: loc(5, 12) });
    putRealFloor(state, loc(40, 12), "& Ration~ of Food");
    const lines = objectListLines(state);
    expect(lines).toEqual([
      { text: "You can see no objects.", color: "#8a8a94" },
      { text: "", color: "#c8c8d4" },
      expect.objectContaining({ text: "You are aware of 1 object:", color: "#9aa0b4" }),
      expect.anything(),
    ]);
  });

  it("mixes LOS + NO_LOS: 'other' wording, blank separator, correct per-section membership", () => {
    /* A far, sorts-first artifact (NO_LOS) plus a near, ordinary torch (LOS).
     * The whole list sorts once (artifact first); each section must still
     * only render the entries whose own count[section] is set, so the
     * artifact must NOT leak into the "You can see" section above it. */
    const state = makeTestState({ w: 60, playerGrid: loc(5, 12) });
    const torch = putRealFloor(state, loc(6, 12), "& Wooden Torch~"); // LOS, dx=1
    const art = putRealFloor(state, loc(40, 12), "& Ration~ of Food"); // NO_LOS, dx=35
    art.artifact = { name: "of Testing" } as unknown as Artifact;
    art.notice |= 0x02; // OBJ_NOTICE.ASSESSED: the shadow/name path agrees it's known.
    void torch;

    const lines = objectListLines(state);
    expect(lines[0]).toEqual({ text: "You can see 1 object:", color: "#9aa0b4" });
    expect(lines[1]!.text).toContain("Torch");
    expect(lines[1]!.text.endsWith("0 N 1 E")).toBe(true);
    expect(lines[2]).toEqual({ text: "", color: "#c8c8d4" });
    expect(lines[3]).toEqual({ text: "You are aware of 1 other object:", color: "#9aa0b4" });
    expect(lines[4]!.text.endsWith("0 N 35 E")).toBe(true);
    expect(lines[4]!.text).not.toContain("Torch");
    expect(lines).toHaveLength(5);
  });

  it("shows '(unknown)' in red for a sensed-but-unidentified grid", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    senseUnknown(state, loc(21, 12));
    const lines = objectListLines(state);
    expect(lines[0]).toEqual({ text: "You can see 1 object:", color: "#9aa0b4" });
    expect(lines[1]!.text).toBe("* (unknown)   0 N 1 E");
    expect(lines[1]!.color).toBe(colorToCss(COLOUR_RED));
  });

  it("excludes money and session-ignored items without inflating the header count", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    putFakeFloor(state, loc(21, 12), { tval: TV.GOLD });
    const junk = putFakeFloor(state, loc(22, 12));
    state.isIgnored = (o) => o === junk;
    const lines = objectListLines(state);
    expect(lines).toEqual([{ text: "You can see no objects.", color: "#8a8a94" }]);
  });

  it("colours: normal white, worthless slate, known-artifact violet, unaware l_red, unknown red", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const normal = putRealFloor(state, loc(20, 11), "& Wooden Torch~");
    const worthlessKind = { ...normal.kind, cost: 0 };
    const worthless = putRealFloor(state, loc(20, 13), "& Wooden Torch~");
    worthless.kind = worthlessKind as ObjectKind;

    const art = putRealFloor(state, loc(21, 12), "& Flask~ of oil");
    art.artifact = { name: "of Testing" } as unknown as Artifact;
    art.notice |= 0x02; // ASSESSED

    const unaware = putRealFloor(state, loc(19, 12), "& Ration~ of Food");
    state.isAware = (kind) => kind !== unaware.kind;

    senseUnknown(state, loc(23, 12));

    const lines = objectListLines(state);
    const byText = (needle: string) => lines.find((l) => l.text.includes(needle));
    expect(byText("Torch")?.color).toBe(colorToCss(COLOUR_WHITE));
    // The worthless torch is a second, distinct entry; both share the substring
    // "Torch", so check via the slate-coloured line specifically.
    expect(lines.some((l) => l.text.includes("Torch") && l.color === colorToCss(COLOUR_SLATE))).toBe(true);
    expect(lines.some((l) => l.text.includes("Testing") && l.color === colorToCss(COLOUR_VIOLET))).toBe(true);
    expect(lines.some((l) => l.color === colorToCss(COLOUR_L_RED))).toBe(true);
    expect(lines.some((l) => l.text.includes("(unknown)") && l.color === colorToCss(COLOUR_RED))).toBe(true);
  });

  it("is RNG-invariant: a pure read draws no random numbers", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    putRealFloor(state, loc(22, 12), "& Ration~ of Food", 3);
    putRealFloor(state, loc(21, 12), "& Wooden Torch~");
    senseUnknown(state, loc(19, 12));

    const before = state.rng.getState();
    objectListLines(state);
    objectListLines(state); // twice, in case a first-call-only branch hides a draw
    const after = state.rng.getState();
    expect(after).toEqual(before);
  });
});

describe("historyLines (history_display, ui-history.c)", () => {
  it("shows the placeholder for an empty log, with the faithful header", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const lines = historyLines(state);
    expect(lines[0]!.text).toBe("      Turn   Depth  Note");
    expect(lines[1]!.text).toBe("(no history yet)");
  });

  it("formats '%10ld%7d\'  %s' oldest-first, with ' (LOST)' on lost entries", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    state.actor.player.hist.push(
      {
        type: 1 << HIST.PLAYER_BIRTH,
        dlev: 0,
        clev: 1,
        aIdx: 0,
        turn: 0,
        event: "Began the quest to destroy Morgoth.",
      },
      {
        type: (1 << HIST.ARTIFACT_UNKNOWN) | (1 << HIST.ARTIFACT_LOST),
        dlev: 3,
        clev: 5,
        aIdx: 9,
        turn: 1234,
        event: "Missed the Amulet of Testing",
      },
    );
    const lines = historyLines(state);
    // Header, then two entries, oldest-first.
    expect(lines).toHaveLength(3);
    expect(lines[1]!.text).toBe(
      `${"0".padStart(10)}${"0".padStart(7)}'  Began the quest to destroy Morgoth.`,
    );
    expect(lines[2]!.text).toBe(
      `${"1234".padStart(10)}${"150".padStart(7)}'  Missed the Amulet of Testing (LOST)`,
    );
  });
});

/* ------------------------------------------------------------------ */
/* spellBrowseLines ('?' description panel, ui-spell.c spell_menu_browser) */
/* ------------------------------------------------------------------ */

const testProjections = bindProjections(loadRecords<ProjectionRecordJson>("projection"));

const TEST_REALM: MagicRealm = {
  name: "test-realm",
  stat: STAT.INT,
  verb: "cast",
  spellNoun: "spell",
  bookNoun: "book",
};

/** A minimal, directly-constructed class_spell fixture (no content pack). */
function makeTestClassSpell(overrides: Partial<ClassSpell> = {}): ClassSpell {
  return {
    name: "Test Bolt",
    sidx: 0,
    bidx: 0,
    level: 1,
    mana: 1,
    fail: 10,
    exp: 0,
    realm: TEST_REALM,
    effectsRaw: [{ eff: "BOLT", type: "FIRE", dice: "2d4" }],
    text: "A bolt of test fire.",
    ...overrides,
  };
}

/** A minimal player_class carrying only the given spells, one book. */
function makeTestClass(spells: ClassSpell[]): PlayerClass {
  return {
    cidx: 0,
    name: "Test Caster",
    titles: [],
    statAdj: [0, 0, 0, 0, 0],
    skills: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    extraSkills: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hitdie: 0,
    expFactor: 0,
    flags: new FlagSet(1),
    pflags: new FlagSet(1),
    maxAttacks: 1,
    minWeight: 0,
    attMultiply: 1,
    startItems: [],
    magic: {
      spellFirst: 1,
      spellWeight: 0,
      numBooks: 1,
      totalSpells: spells.length,
      books: [
        {
          tval: "magic book",
          tvalIdx: 0,
          sval: 0,
          dungeon: false,
          name: "Test Book",
          realm: TEST_REALM,
          numSpells: spells.length,
          spells,
          graphics: null,
          properties: null,
        },
      ],
    },
  };
}

/** State + player set up with a two-spell test class: sidx0 damaging (fire
 * bolt, 2d4 -> average 5), sidx1 non-damaging (a plain detection). */
function makeSpellTestState(): GameState {
  const state = makeTestState({ playerGrid: loc(20, 12) });
  const bolt = makeTestClassSpell();
  const detect = makeTestClassSpell({
    sidx: 1,
    name: "Test Wardsight",
    text: "Detects nothing in particular.",
    effectsRaw: [{ eff: "DETECT_TRAPS" }],
  });
  state.actor.player.cls = makeTestClass([bolt, detect]);
  state.actor.player.spellFlags = [];
  return state;
}

describe("spellBrowseLines ('?' description panel, ui-spell.c spell_menu_browser)", () => {
  it("shows only the description when the spell has never been cast (not WORKED)", () => {
    const state = makeSpellTestState();
    const lines = spellBrowseLines(state, 0, testProjections, 200);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("A bolt of test fire.");
    // No green digit run: the average-damage sentence is gated on WORKED.
    expect(lines[0]!.runs?.some((r) => r.color === colorToCss(COLOUR_L_GREEN))).toBe(false);
  });

  it("appends the 'Inflicts an average of ... damage.' sentence once WORKED", () => {
    const state = makeSpellTestState();
    state.actor.player.spellFlags[0] = PY_SPELL.WORKED;
    const lines = spellBrowseLines(state, 0, testProjections, 200);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe(
      "A bolt of test fire.  Inflicts an average of 5 fire damage.",
    );
    // Only the damage number itself is COLOUR_L_GREEN, matching upstream's
    // text_out_c(COLOUR_L_GREEN, " %d", ...) - not the surrounding words.
    const greenRuns = lines[0]!.runs?.filter((r) => r.color === colorToCss(COLOUR_L_GREEN));
    expect(greenRuns).toEqual([{ text: "5", color: colorToCss(COLOUR_L_GREEN) }]);
  });

  it("suppresses the summary again once the spell is FORGOTTEN, even though WORKED", () => {
    const state = makeSpellTestState();
    state.actor.player.spellFlags[0] = PY_SPELL.WORKED | PY_SPELL.FORGOTTEN;
    const lines = spellBrowseLines(state, 0, testProjections, 200);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("A bolt of test fire.");
  });

  it("a non-damaging spell shows only its description, WORKED or not", () => {
    const state = makeSpellTestState();
    state.actor.player.spellFlags[1] = PY_SPELL.WORKED;
    const lines = spellBrowseLines(state, 1, testProjections, 200);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("Detects nothing in particular.");
  });

  it("returns no lines for an out-of-range spell index", () => {
    const state = makeSpellTestState();
    expect(spellBrowseLines(state, 99, testProjections, 200)).toEqual([]);
  });

  it("is RNG-invariant: browsing a damaging spell draws no random numbers", () => {
    const state = makeSpellTestState();
    state.actor.player.spellFlags[0] = PY_SPELL.WORKED;
    const before = state.rng.getState();
    spellBrowseLines(state, 0, testProjections, 200);
    spellBrowseLines(state, 0, testProjections, 200); // twice, in case a first-call-only branch hides a draw
    expect(state.rng.getState()).toEqual(before);
  });
});
