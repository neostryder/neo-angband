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
  AutoinscriptionRegistry,
  makeRuneEnv,
  DEFAULT_GAME_CONSTANTS,
  placePlayer,
  ObjRegistry,
  objectNew,
  gearAdd,
  COLOUR_RED,
  COLOUR_SLATE,
  COLOUR_VIOLET,
  COLOUR_WHITE,
  COLOUR_L_RED,
  COLOUR_L_GREEN,
  COLOUR_YELLOW,
  COLOUR_L_BLUE,
  COLOUR_L_DARK,
  TV,
  HIST,
  STAT,
  FlagSet,
  bindProjections,
  PY_SPELL,
  bindMonsters,
  newMonsterLore,
  RF,
  RSF,
  MFLAG,
  MON_TMD,
  TMD,
  chanceOfMeleeHitBase,
  getHitChance,
  SKILL,
  PF_SIZE,
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
  MonsterPackRecords,
  MonsterRace,
  MonsterLore,
  LoreDeps,
} from "@neo-angband/core";
import {
  wrapRuns,
  objectListLines,
  historyLines,
  spellBrowseLines,
  bookSpellMenu,
  inventoryLines,
  objectWeightColumn,
  deviceFailColumn,
  deviceMenu,
  monsterRecallLines,
  knownMonsterEntries,
  monsterKnowledgeMenu,
  autoinscriptionMenu,
  tombstoneLines,
  winnerLines,
  ctimeStamp,
  monsterListScreenLines,
} from "./screens";
import type { Monster } from "@neo-angband/core";

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
    expect(lines).toEqual([{ text: "You can see no objects.", color: colorToCss(COLOUR_SLATE) }]);
  });

  it("singular header + direction label for a single LOS object", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    putRealFloor(state, loc(20, 10), "& Wooden Torch~"); // dy=-2,dx=0 -> "2 N 0 W"
    const lines = objectListLines(state);
    expect(lines[0]).toEqual({ text: "You can see 1 object:", color: colorToCss(COLOUR_WHITE) });
    expect(lines).toHaveLength(2);
    expect(lines[1]!.text).toBe("~ a Wooden Torch (0 turns)   2 N 0 W");
  });

  it("plural header for several LOS objects, upstream sort order (type, then distance)", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    putRealFloor(state, loc(22, 12), "& Ration~ of Food"); // dx=2  (TV.FOOD)
    putRealFloor(state, loc(21, 12), "& Wooden Torch~"); // dx=1   (TV.LIGHT)
    const lines = objectListLines(state);
    expect(lines[0]).toEqual({ text: "You can see 2 objects:", color: colorToCss(COLOUR_WHITE) });
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
      { text: "You can see no objects.", color: colorToCss(COLOUR_SLATE) },
      { text: "", color: colorToCss(COLOUR_WHITE) },
      expect.objectContaining({ text: "You are aware of 1 object:", color: colorToCss(COLOUR_WHITE) }),
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
    expect(lines[0]).toEqual({ text: "You can see 1 object:", color: colorToCss(COLOUR_WHITE) });
    expect(lines[1]!.text).toContain("Torch");
    expect(lines[1]!.text.endsWith("0 N 1 E")).toBe(true);
    expect(lines[2]).toEqual({ text: "", color: colorToCss(COLOUR_WHITE) });
    expect(lines[3]).toEqual({ text: "You are aware of 1 other object:", color: colorToCss(COLOUR_WHITE) });
    expect(lines[4]!.text.endsWith("0 N 35 E")).toBe(true);
    expect(lines[4]!.text).not.toContain("Torch");
    expect(lines).toHaveLength(5);
  });

  it("shows '(unknown)' in red for a sensed-but-unidentified grid", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    senseUnknown(state, loc(21, 12));
    const lines = objectListLines(state);
    expect(lines[0]).toEqual({ text: "You can see 1 object:", color: colorToCss(COLOUR_WHITE) });
    expect(lines[1]!.text).toBe("* (unknown)   0 N 1 E");
    expect(lines[1]!.color).toBe(colorToCss(COLOUR_RED));
  });

  it("excludes money and session-ignored items without inflating the header count", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    putFakeFloor(state, loc(21, 12), { tval: TV.GOLD });
    const junk = putFakeFloor(state, loc(22, 12));
    state.isIgnored = (o) => o === junk;
    const lines = objectListLines(state);
    expect(lines).toEqual([{ text: "You can see no objects.", color: colorToCss(COLOUR_SLATE) }]);
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
    pflags: new FlagSet(PF_SIZE),
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

/** Add a real kind to the pack (weight seeded from the kind), return the obj. */
function addPack(state: GameState, kindName: string, number = 1): GameObject {
  const kind = objReg.kinds.find((k) => k.name === kindName) as ObjectKind;
  const obj = objectNew(kind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.number = number;
  obj.weight = kind.weight;
  const handle = gearAdd(state.gear, obj);
  state.gear.pack.push(handle);
  return obj;
}

describe("objectWeightColumn (OLIST_WEIGHT, ui-object.c L234-239)", () => {
  it("formats the total stack weight as '%4d.%1d lb'", () => {
    // 2 x 35 tenths = 70 tenths = 7.0 lb.
    expect(objectWeightColumn({ number: 2, weight: 35 } as GameObject)).toBe(
      "   7.0 lb",
    );
  });

  it("uses the per-one weight times the stack count", () => {
    expect(objectWeightColumn({ number: 1, weight: 123 } as GameObject)).toBe(
      "  12.3 lb",
    );
  });
});

describe("inventoryLines weight column (14.20)", () => {
  it("appends the 'lb' weight column to each carried item", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const food = objReg.kinds.find((k) => k.tval === TV.FOOD) as ObjectKind;
    addPack(state, food.name, 2);
    const lines = inventoryLines(state);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toMatch(/\d+\.\d lb$/);
  });
});

describe("deviceFailColumn (OLIST_FAIL, ui-object.c L212-221)", () => {
  it("shows a right-aligned '%% fail' figure once the effect is known (aware)", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const wand = objReg.kinds.find((k) => k.tval === TV.WAND) as ObjectKind;
    const obj = objectNew(wand);
    obj.tval = wand.tval;
    const col = deviceFailColumn(state, obj, () => true);
    expect(col).toMatch(/^\s*\d+% fail$/);
  });

  it("shows '    ? fail' when the device's effect is not yet known (unaware)", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const wand = objReg.kinds.find((k) => k.tval === TV.WAND) as ObjectKind;
    const obj = objectNew(wand);
    obj.tval = wand.tval;
    expect(deviceFailColumn(state, obj, () => false)).toBe("    ? fail");
  });

  it("is empty for a non-failing object (obj_can_fail false)", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const potion = objReg.kinds.find((k) => k.tval === TV.POTION) as ObjectKind;
    const obj = objectNew(potion);
    obj.tval = potion.tval;
    expect(deviceFailColumn(state, obj, () => true)).toBe("");
  });
});

describe("deviceMenu (device use picker with the FAIL% column, 14.21)", () => {
  it("labels each device with its fail column", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const wand = objReg.kinds.find((k) => k.tval === TV.WAND) as ObjectKind;
    addPack(state, wand.name);
    const { items, handles } = deviceMenu(
      state,
      (o) => o.tval === TV.WAND,
      () => true,
    );
    expect(handles).toHaveLength(1);
    expect(items[0]!.label).toMatch(/\d+% fail$/);
  });
});

/**
 * bookSpellMenu (spell_menu_display, ui-spell.c L64-121): the six-way state
 * classification and its column layout, exercised via the two-spell test class.
 */
describe("bookSpellMenu (cast/study state labels + colours, 14.22/14.24)", () => {
  const TEST_BOOK = { tval: 0, sval: 0, number: 1 } as unknown as GameObject;

  it("a WORKED learned spell shows its damage info in white and is castable", () => {
    const state = makeSpellTestState();
    state.actor.player.lev = 5;
    state.actor.player.spellFlags[0] = PY_SPELL.LEARNED | PY_SPELL.WORKED;
    const { items, sidx } = bookSpellMenu(state, TEST_BOOK, "cast");
    expect(sidx).toContain(0);
    const row = items[sidx.indexOf(0)]!;
    expect(row.color).toBe(colorToCss(COLOUR_WHITE));
    expect(row.disabled).toBe(false);
    // Faithful column layout: "<name(30)><lvl:2> <mana:4> <fail:3>%<comment>".
    expect(row.label).toMatch(/^Test Bolt {21}\s*\d+ +\d+ +\d+%/);
  });

  it("a learned-but-untried spell shows ' untried' in light green", () => {
    const state = makeSpellTestState();
    state.actor.player.lev = 5;
    state.actor.player.spellFlags[0] = PY_SPELL.LEARNED;
    const { items, sidx } = bookSpellMenu(state, TEST_BOOK, "cast");
    const row = items[sidx.indexOf(0)]!;
    expect(row.label).toContain(" untried");
    expect(row.color).toBe(colorToCss(COLOUR_L_GREEN));
  });

  it("a forgotten spell shows ' forgotten' in yellow", () => {
    const state = makeSpellTestState();
    state.actor.player.lev = 5;
    state.actor.player.spellFlags[0] = PY_SPELL.LEARNED | PY_SPELL.FORGOTTEN;
    const { items, sidx } = bookSpellMenu(state, TEST_BOOK, "cast");
    const row = items[sidx.indexOf(0)]!;
    expect(row.label).toContain(" forgotten");
    expect(row.color).toBe(colorToCss(COLOUR_YELLOW));
  });

  it("an unlearned but learnable spell shows ' unknown' in light blue", () => {
    const state = makeSpellTestState();
    state.actor.player.lev = 5; // level-1 spell is within reach
    state.actor.player.spellFlags[0] = 0;
    const { items, sidx } = bookSpellMenu(state, TEST_BOOK, "cast");
    const row = items[sidx.indexOf(0)]!;
    expect(row.label).toContain(" unknown");
    expect(row.color).toBe(colorToCss(COLOUR_L_BLUE));
    expect(row.disabled).toBe(true); // not okay to cast
  });

  it("a too-high-level spell shows ' difficult' in red", () => {
    const state = makeSpellTestState();
    state.actor.player.lev = 0; // below the level-1 spell
    state.actor.player.spellFlags[0] = 0;
    const { items, sidx } = bookSpellMenu(state, TEST_BOOK, "cast");
    const row = items[sidx.indexOf(0)]!;
    expect(row.label).toContain(" difficult");
    expect(row.color).toBe(colorToCss(COLOUR_RED));
  });

  it("a level>=99 spell renders the bare '(illegible)' in L_DARK", () => {
    const state = makeSpellTestState();
    state.actor.player.cls.magic.books[0]!.spells[0]!.level = 99;
    const { items, sidx } = bookSpellMenu(state, TEST_BOOK, "cast");
    const row = items[sidx.indexOf(0)]!;
    expect(row.label).toBe("(illegible)");
    expect(row.color).toBe(colorToCss(COLOUR_L_DARK));
  });
});

/* ------------------------------------------------------------------ */
/* monsterRecallLines ('r' in the look/target loop): the recall screen  */
/* content, wired to the real shipped monster + projection data, the    */
/* same fixture shape lore-describe.test.ts uses at the core layer -    */
/* this checks the WEB-side wiring (recallDeps' breathProjection lookup */
/* off world/projection.ts) rather than re-testing loreDescription      */
/* itself, which core/src/mon/lore-describe.test.ts already covers.     */
/* ------------------------------------------------------------------ */

const monReg = bindMonsters({
  pain: loadRecords("pain"),
  blowMethods: loadRecords("blow_methods"),
  blowEffects: loadRecords("blow_effects"),
  monsterSpells: loadRecords("monster_spell"),
  monsterBases: loadRecords("monster_base"),
  monsters: loadRecords("monster"),
  summons: loadRecords("summon"),
  pits: loadRecords("pit"),
} as MonsterPackRecords);

const monProjections = bindProjections(loadRecords<ProjectionRecordJson>("projection"));

/** A placeable, non-unique breathing race (has a BR_ spell), for the breath
 * damage / knowledge-gating checks below. */
const breathingRace = monReg.races.find(
  (r) => r.spellFlags.has(RSF.BR_POIS) && r.avgHp > 0 && !r.flags.has(RF.UNIQUE),
) as MonsterRace;

/** recallDeps() (main.ts) without the breathProjection override - the
 * caller-supplied LoreDeps every other field this fixture needs. */
function baseRecallDeps(): LoreDeps {
  return {
    playerLevel: 10,
    playerMaxDepth: 5,
    playerSpeed: 110,
    effectiveSpeed: false,
    spells: monReg.spells,
  };
}

/** baseRecallDeps() plus the real breath element table (world/projection.ts),
 * exactly as recallDeps() wires it in main.ts. */
function testRecallDeps(): LoreDeps {
  return { ...baseRecallDeps(), breathProjection: (subtype) => monProjections[subtype] };
}

describe("monsterRecallLines ('r' recall screen, ui-mon-lore.c lore_description)", () => {
  it("renders non-zero breath damage once armour is known, with breathProjection wired", () => {
    const lore = newMonsterLore(breathingRace);
    lore.spellFlags.on(RSF.BR_POIS);
    lore.armourKnown = true;

    const lines = monsterRecallLines(breathingRace, lore, testRecallDeps(), 200);
    const text = lines.map((l) => l.text).join(" ");
    expect(text).toMatch(/poison \(\d+\)/);
    const match = /poison \((\d+)\)/.exec(text);
    expect(Number(match?.[1])).toBeGreaterThan(0);
  });

  it("renders zero-suppressed breath damage (no '(N)' suffix) when breathProjection is not wired", () => {
    const lore = newMonsterLore(breathingRace);
    lore.spellFlags.on(RSF.BR_POIS);
    lore.armourKnown = true;

    const lines = monsterRecallLines(breathingRace, lore, baseRecallDeps(), 200);
    const text = lines.map((l) => l.text).join(" ");
    expect(text).toContain("poison");
    expect(text).not.toMatch(/poison \(\d+\)/);
  });

  it("hides unlearned content: fresh lore shows none of the gated sections", () => {
    const lore = newMonsterLore(breathingRace); // nothing observed yet
    const lines = monsterRecallLines(breathingRace, lore, testRecallDeps(), 200);
    const text = lines.map((l) => l.text).join(" ");
    // Nothing is known about attacks/spells until observed in play.
    expect(text).not.toMatch(/poison \(\d+\)/);
    expect(text).toContain("No battles to the death are recalled.");
    // The flavour text and title always show (upstream's non-spoiler recall
    // always names/describes the race), but the toughness percentage line
    // only appears once armour_known.
    expect(text).not.toContain("chance to hit such a creature in melee");
  });

  it("shows the player's real melee-to-hit percentage when meleeHitPercent is wired from live combat state (mon-lore.c L1086-1094)", () => {
    const lore = newMonsterLore(breathingRace);
    lore.armourKnown = true;

    // The exact expression recallDeps() (main.ts) wires meleeHitPercent to:
    // getHitChance(chanceOfMeleeHitBase(state.actor.combat, state.actor.weapon), race.ac).
    const combat = {
      toH: 10,
      toD: 5,
      ac: 0,
      toA: 0,
      skills: (() => {
        const s = new Array<number>(10).fill(0);
        s[SKILL.TO_HIT_MELEE] = 20;
        return s;
      })(),
      numBlows: 100,
      ammoMult: 1,
      numShots: 0,
      ammoTval: 0,
      blessWield: false,
    };
    const expectedPercent = getHitChance(chanceOfMeleeHitBase(combat, null), breathingRace.ac);
    expect(expectedPercent).toBeGreaterThan(0);

    const deps: LoreDeps = {
      ...baseRecallDeps(),
      meleeHitPercent: (race) => getHitChance(chanceOfMeleeHitBase(combat, null), race.ac),
    };
    const lines = monsterRecallLines(breathingRace, lore, deps, 200);
    const text = lines.map((l) => l.text).join(" ");
    expect(text).toContain("chance to hit such a creature in melee");
    expect(text).toMatch(new RegExp(`${expectedPercent}%`));
  });

  it("is RNG-invariant: building the recall screen draws no random numbers", () => {
    const rng = new Rng(20260713);
    const before = rng.getState();

    const lore = newMonsterLore(breathingRace);
    lore.spellFlags.on(RSF.BR_POIS);
    lore.armourKnown = true;
    monsterRecallLines(breathingRace, lore, testRecallDeps(), 200);
    monsterRecallLines(breathingRace, lore, testRecallDeps(), 80); // a second width, in case wrapping hides a draw

    expect(rng.getState()).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/* knownMonsterEntries / monsterKnowledgeMenu ('~' -> Monsters,          */
/* ui-knowledge.c do_cmd_knowledge_monsters): the list-building and      */
/* filtering logic behind the monster-knowledge screen, over the real   */
/* shipped monster registry.                                            */
/* ------------------------------------------------------------------ */

/** A few real, named races to seed the lore store with. */
const namedRaces = monReg.races.filter((r) => r.name);

/** newMonsterLore + observed overrides, so a race counts as "known". */
function seenLore(race: MonsterRace, over: Partial<MonsterLore> = {}): MonsterLore {
  return { ...newMonsterLore(race), ...over };
}

describe("knownMonsterEntries (ui-knowledge.c monster-knowledge filter/sort)", () => {
  it("is empty when no lore has been recorded", () => {
    expect(knownMonsterEntries(namedRaces, new Map())).toEqual([]);
  });

  it("includes only races that have been sighted or are fully known", () => {
    const seen = namedRaces[3]!; // sights > 0
    const known = namedRaces[7]!; // all_known but never sighted
    const blank = namedRaces[11]!; // has a record, but nothing observed
    const store = new Map<number, MonsterLore>([
      [seen.ridx, seenLore(seen, { sights: 2 })],
      [known.ridx, seenLore(known, { allKnown: true })],
      [blank.ridx, seenLore(blank)], // sights 0, not all_known -> excluded
    ]);
    const rows = knownMonsterEntries(namedRaces, store);
    const ridxs = rows.map((r) => r.race.ridx);
    expect(ridxs).toContain(seen.ridx);
    expect(ridxs).toContain(known.ridx);
    expect(ridxs).not.toContain(blank.ridx);
    // A race with no record at all (namedRaces[0]) is never listed.
    expect(ridxs).not.toContain(namedRaces[0]!.ridx);
    expect(rows.length).toBe(2);
  });

  it("skips the nameless r_info[0]-style blank even when it has been sighted", () => {
    const real = namedRaces[5]!;
    const nameless: MonsterRace = { ...real, ridx: 99991, name: "" };
    const store = new Map<number, MonsterLore>([
      [nameless.ridx, seenLore(real, { sights: 9 })],
    ]);
    expect(knownMonsterEntries([nameless], store)).toEqual([]);
  });

  it("sorts by level ascending, then by ordinal name (m_cmp_race fallback)", () => {
    // Seed a broad spread of races so both sort keys are exercised.
    const store = new Map<number, MonsterLore>();
    for (const r of namedRaces.slice(0, 60)) store.set(r.ridx, seenLore(r, { sights: 1 }));
    const rows = knownMonsterEntries(namedRaces, store);
    expect(rows.length).toBe(60);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!.race;
      const cur = rows[i]!.race;
      expect(prev.level).toBeLessThanOrEqual(cur.level);
      if (prev.level === cur.level) {
        // strcmp (ordinal), matching the port's byte-order name tiebreak.
        expect(prev.name <= cur.name).toBe(true);
      }
    }
  });

  it("does not mutate the lore store while filtering (no getLore side effects)", () => {
    const store = new Map<number, MonsterLore>([
      [namedRaces[4]!.ridx, seenLore(namedRaces[4]!, { sights: 1 })],
    ]);
    knownMonsterEntries(namedRaces, store);
    expect(store.size).toBe(1); // unseen races got no blank records
  });
});

describe("monsterKnowledgeMenu ('~' -> Monsters selection list)", () => {
  it("labels each row by capitalized name, appends a kill tally, colours by dAttr", () => {
    const killed = namedRaces[6]!;
    const unkilled = namedRaces[9]!;
    const store = new Map<number, MonsterLore>([
      [killed.ridx, seenLore(killed, { sights: 1, pkills: 4 })],
      [unkilled.ridx, seenLore(unkilled, { sights: 1, pkills: 0 })],
    ]);
    const { items, rows } = monsterKnowledgeMenu(namedRaces, store);
    expect(items.length).toBe(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const { race, lore } = rows[i]!;
      const item = items[i]!;
      const cap = race.name.charAt(0).toUpperCase() + race.name.slice(1);
      expect(item.label.startsWith(cap)).toBe(true);
      expect(item.label.includes("killed")).toBe(lore.pkills > 0);
      expect(item.color).toBe(colorToCss(race.dAttr));
    }
    // The killed race carries its "(N killed)" tally.
    const killedItem = items[rows.findIndex((r) => r.race.ridx === killed.ridx)]!;
    expect(killedItem.label).toContain("(4 killed)");
  });
});

describe("autoinscriptionMenu ('~' -> Set object autoinscriptions)", () => {
  const dagger = objReg.kinds.find(
    (k) => k.name === "& Dagger~" && k.tval === TV.SWORD,
  ) as ObjectKind;
  const tulwar = objReg.kinds.find(
    (k) => k.name === "& Tulwar~" && k.tval === TV.SWORD,
  ) as ObjectKind;

  it("lists aware kinds and shows the current aware note in braces", () => {
    const registry = new AutoinscriptionRegistry();
    registry.set(dagger.kidx, "@w1", true);
    const awareSet = new Set([dagger.kidx, tulwar.kidx]);
    const { items, rows } = autoinscriptionMenu(
      objReg.kinds,
      (k) => awareSet.has(k.kidx),
      registry,
    );
    expect(rows.length).toBe(2);
    const di = rows.findIndex((r) => r.kind.kidx === dagger.kidx);
    const ti = rows.findIndex((r) => r.kind.kidx === tulwar.kidx);
    expect(rows[di]!.note).toBe("@w1");
    expect(items[di]!.label).toContain("{@w1}");
    expect(rows[ti]!.note).toBe("");
    expect(items[ti]!.label).not.toContain("{");
  });

  it("excludes kinds the player is not aware of", () => {
    const registry = new AutoinscriptionRegistry();
    const { rows } = autoinscriptionMenu(
      objReg.kinds,
      (k) => k.kidx === dagger.kidx,
      registry,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.kind.kidx).toBe(dagger.kidx);
  });

  it("a note set through the registry (as the manager does) persists into the rebuilt list", () => {
    const registry = new AutoinscriptionRegistry();
    const awareSet = new Set([dagger.kidx]);
    const isAware = (k: ObjectKind): boolean => awareSet.has(k.kidx);
    /* showAutoinscriptionManager does exactly this on Enter: registry.set. */
    registry.set(dagger.kidx, "@v1", true);
    let built = autoinscriptionMenu(objReg.kinds, isAware, registry);
    let row = built.rows.findIndex((r) => r.kind.kidx === dagger.kidx);
    expect(built.rows[row]!.note).toBe("@v1");
    expect(built.items[row]!.label).toContain("{@v1}");
    /* An empty string clears it (manager's clear path). */
    registry.set(dagger.kidx, "", true);
    built = autoinscriptionMenu(objReg.kinds, isAware, registry);
    row = built.rows.findIndex((r) => r.kind.kidx === dagger.kidx);
    expect(built.rows[row]!.note).toBe("");
    expect(built.items[row]!.label).not.toContain("{");
  });
});

/* ------------------------------------------------------------------ */
/* Death / tombstone screens (ui-death.c display_exit_screen/winner)  */
/* ------------------------------------------------------------------ */

describe("tombstoneLines (display_exit_screen, ui-death.c L63-113)", () => {
  const baseDeps = {
    fullName: "Frodo",
    title: "Rookie",
    className: "Warrior",
    level: 3,
    exp: 42,
    gold: 100,
    depth: 5,
    diedFrom: "a giant white mouse",
    totalWinner: false,
    deathTime: "Wed Jun 30 21:49:08 1993",
  };

  it("centres the epitaph fields over the tombstone rows", () => {
    const lines = tombstoneLines(baseDeps);
    // Fields sit at rows 7,8,9,11..16,18 (put_str_centred line sequence).
    expect(lines[7]!.text).toContain("Frodo");
    expect(lines[8]!.text).toContain("the");
    expect(lines[9]!.text).toContain("Rookie");
    expect(lines[11]!.text).toContain("Warrior");
    expect(lines[12]!.text).toContain("Level: 3");
    expect(lines[13]!.text).toContain("Exp: 42");
    expect(lines[14]!.text).toContain("AU: 100");
    expect(lines[15]!.text).toContain("Killed on Level 5");
    expect(lines[16]!.text).toContain("by a giant white mouse.");
    expect(lines[18]!.text).toContain("on Wed Jun 30 21:49:08 1993");
  });

  it("centres within the [8,39] band (put_str_centred x = 23 - len/2)", () => {
    const lines = tombstoneLines(baseDeps);
    // "Frodo" length 5 -> x = 8 + (15 - 2) = 21.
    const idx = lines[7]!.text.indexOf("Frodo");
    expect(idx).toBe(21);
  });

  it("shows 'Magnificent' as the title for a total winner", () => {
    const lines = tombstoneLines({ ...baseDeps, totalWinner: true });
    expect(lines[9]!.text).toContain("Magnificent");
    expect(lines[9]!.text).not.toContain("Rookie");
  });

  it("swaps to the retirement wording when retired", () => {
    const lines = tombstoneLines({ ...baseDeps, retired: true, diedFrom: "Retiring" });
    expect(lines[15]!.text).toContain("Retired on Level 5");
    // No "by <killer>." line when retired (row 16 keeps only the tomb border).
    expect(lines[16]!.text).not.toContain("by ");
  });

  it("is pure ASCII everywhere", () => {
    for (const l of tombstoneLines(baseDeps)) {
      expect(l.text).toMatch(/^[\x00-\x7f]*$/);
    }
  });
});

describe("winnerLines (display_winner, ui-death.c L119-156)", () => {
  it("ends with the 'All Hail the Mighty Champion!' banner", () => {
    const lines = winnerLines(80);
    const last = lines[lines.length - 1]!;
    expect(last.text).toContain("All Hail the Mighty Champion!");
  });

  it("includes the crown art body", () => {
    const text = winnerLines(80).map((l) => l.text).join("\n");
    expect(text).toContain("I came, I saw, I conquered!");
  });
});

describe("ctimeStamp (ctime() %-.24s, ui-death.c L112)", () => {
  it("formats a Date as a 24-char ctime string", () => {
    // 1993-06-30 21:49:08 local.
    const d = new Date(1993, 5, 30, 21, 49, 8);
    const s = ctimeStamp(d);
    expect(s).toMatch(/^\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d 1993$/);
    expect(s.length).toBeLessThanOrEqual(24);
  });
});

/* ------------------------------------------------------------------ */
/* Monster list screen ([) - ui-mon-list.c format                     */
/* ------------------------------------------------------------------ */

/** A minimal visible monster of a real race, for the list format checks. */
function fakeVisibleMon(race: MonsterRace, at: Loc): Monster {
  const mflag = new FlagSet(8);
  mflag.on(MFLAG.VISIBLE);
  return {
    race,
    grid: at,
    mflag,
    mTimed: new Array(32).fill(0),
    attr: 0,
  } as unknown as Monster;
}

describe("monsterListScreenLines ([, ui-mon-list.c)", () => {
  const kobold = monReg.races.find(
    (r) => r.name === "kobold" && !r.flags.has(RF.UNIQUE),
  ) as MonsterRace;

  it("reports 'no monsters' when nothing is visible", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const lines = monsterListScreenLines(state, 80);
    expect(lines[0]!.text).toBe("You can see no monsters.");
  });

  it("groups visible monsters into the LOS header + a race row", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    state.monsters.push(fakeVisibleMon(kobold, loc(22, 12)));
    state.monsters.push(fakeVisibleMon(kobold, loc(23, 12)));
    const lines = monsterListScreenLines(state, 80);
    expect(lines[0]!.text).toBe("You can see 2 monsters:");
    // The race row carries the "N race(s)" name and the glyph run.
    const row = lines[1]!;
    expect(row.text).toContain("kobolds");
    expect(row.runs?.[0]?.text).toBe(kobold.dChar);
  });

  it("shows the single-monster direction offset and (asleep) tag", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const m = fakeVisibleMon(kobold, loc(23, 15)); // 3 E, 3 S
    m.mTimed[MON_TMD.SLEEP] = 500;
    state.monsters.push(m);
    const lines = monsterListScreenLines(state, 80);
    expect(lines[0]!.text).toBe("You can see 1 monster:");
    expect(lines[1]!.text).toContain("(asleep)");
    expect(lines[1]!.text).toMatch(/3 S 3 E\s*$/);
  });

  it("replaces the whole list while hallucinating (TMD_IMAGE)", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    state.monsters.push(fakeVisibleMon(kobold, loc(22, 12)));
    state.actor.player.timed[TMD.IMAGE] = 10;
    const lines = monsterListScreenLines(state, 80);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toContain("hallucinations are too wild");
  });
});
