import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
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
  ELEM,
  buildUiEntryConfig,
  characterGrid,
  objectLearnOnWield,
  gearAdd,
  calcInventory,
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
  registerBookKinds,
  objectPrep,
  spellLearn,
  objCanCastFrom,
  objCanStudy,
  bindConstants,
  getMonName,
  describeObject,
  scorePageRows,
  scoreRows,
} from "@rpgm-tools/neo-angband-core";
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
  HighScore,
  ScoreNameResolver,
  ScoreStore,
  Player,
} from "@rpgm-tools/neo-angband-core";
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
  monsterRecallScreen,
  objectRecallScreen,
  objectComparisonScreen,
  knownMonsterEntries,
  autoinscriptionMenu,
  tombstoneLines,
  tombstoneScreen,
  winnerLines,
  winnerScreen,
  ctimeStamp,
  monsterListScreenLines,
  monsterListScreen,
  magicBooks,
  packMenu,
  quiverMenu,
  inventoryScreen,
  equipmentScreen,
  equipmentLines,
  objectListScreen,
  playerHistoryScreen,
  messageHistoryScreen,
  quiverScreen,
  quiverLines,
  objectName,
  storeKnowledgeScreen,
  STORE_STOCK_COLUMNS,
  hallOfFameScreen,
  hallOfFameTitle,
  hallOfFameFooter,
  updateScreen,
  reportScreen,
  UPDATE_ACTION_KEYS,
  REPORT_ACTION_KEYS,
  characterScreen,
  SCREEN_PROMPTS,
  SCREEN_NO_PROMPT,
  screenPromptFor,
} from "./screens";
import { REPORT_MAX_MOD_TRACKERS, reportDestinations } from "./report";
import { characterFlagsScreen } from "./charsheet";
import { MessageLog } from "./messages";
import { showPredictedScores, showScoreScreen } from "./score";
import { showMonsterList } from "./monster-list";
import { setScreenPresenter } from "./screen-runtime";
import type { GridPointerInput, GridSurface } from "./term";
import { screenBodyLines, MODELLED_SCREENS } from "./screen-view";
import type {
  ScreenArtField,
  ScreenTableBlock,
  ScreenTextBlock,
  ScreenView,
} from "./screen-view";
import { UI_DIM } from "./ui-colors";
import type { Monster } from "@rpgm-tools/neo-angband-core";

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

const objConstants = bindConstants(loadJson("constants"));

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
  rememberSeen(state, idx, obj);
  return obj;
}

/** The player has SEEN `obj` here: one entry in the remembered pile. */
function rememberSeen(state: GameState, idx: number, obj: GameObject): void {
  const known = state.known.objects.get(idx) ?? [];
  known.push({ obj, sensed: false });
  state.known.objects.set(idx, known);
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
  rememberSeen(state, idx, obj);
  return obj;
}

/**
 * Mark a grid as sensed-but-unidentified (a detection marker, no glyph). A
 * sensed memory is still a memory OF an object, so this puts one on the floor
 * and flags its entry, exactly as object_sense does.
 */
function senseUnknown(state: GameState, at: Loc): void {
  const obj = putFakeFloor(state, at);
  const idx = at.y * state.chunk.width + at.x;
  const entry = state.known.objects.get(idx)?.find((e) => e.obj === obj);
  if (entry) entry.sensed = true;
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
    /* cols = 6 -> width 6: "aaaa" fits, the break space is dropped, "bbbb"
       wraps to the next row keeping its own colour. */
    const lines = wrapRuns(tb, 6);
    expect(lines.map((l) => l.text)).toEqual(["aaaa", "bbbb"]);
    expect(lines[0]!.runs).toEqual([{ text: "aaaa", color: colorToCss(L_GREEN) }]);
    expect(lines[1]!.runs).toEqual([{ text: "bbbb", color: colorToCss(L_RED) }]);
  });

  it("hard-breaks a word longer than the width, taking the FULL width", () => {
    /* `adjusted_line_length = width` (z-textblock.c L292): with no breaking
     * character on the line, upstream takes all `width` characters. The width
     * is the region's, which is `cols` - this asserted `cols - 1` while the
     * renderer cited the wrong upstream function, and the two mistakes hid each
     * other on every page a player can actually reach. See
     * `prose-wrap.upstream.test.ts`. */
    const tb: Textblock = { runs: [{ text: "abcdefgh", attr: WHITE }] };
    const lines = wrapRuns(tb, 5); /* width 5 */
    expect(lines.map((l) => l.text)).toEqual(["abcde", "fgh"]);
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

  it("formats '%10ld%7d'  %s' oldest-first, with ' (LOST)' on lost entries", () => {
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
  /* upkeep->inven[] is DERIVED (calc_inventory, player-calcs.c:1023) and it is
   * what every pack listing walks, so a fixture that only pushes onto the master
   * gear list has an empty inventory. */
  calcInventory(state.gear, objConstants);
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

/**
 * The two listings that have given up their models (#253 step 5).
 *
 * WHAT THESE PIN. `inventoryLines` is no longer a drawing - it is
 * `screenBodyLines(inventoryScreen(state))`, so the generic table renderer now
 * draws what the player sees. The risk that creates is silent: a column that
 * stops clamping at 45 or a prefix that stops being three characters wide moves
 * every weight figure on the screen while every other test goes on passing,
 * because nothing else asserts the column stops. So the expected row is DERIVED
 * here from `objectName` and `objectWeightColumn` at the upstream field widths,
 * rather than copied out of the current output.
 */
describe("the inventory and equipment screens, and the lines they still render to", () => {
  it("publishes rows a mod can read, with the identity the PICKER uses", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const food = objReg.kinds.find((k) => k.tval === TV.FOOD) as ObjectKind;
    const obj = addPack(state, food.name, 2);
    const handle = state.gear.inven![0]!;

    const view = inventoryScreen(state);
    expect(view.id).toBe("core:inventory");
    const block = view.blocks[0] as ScreenTableBlock;
    expect(block.rows).toHaveLength(1);
    const row = block.rows[0]!;

    /* The same id and semantic packMenu gives the same object: an inventory
     * LISTING and an inventory PICKER are the same objects seen twice, and a mod
     * drawing sprites for one must not need a second vocabulary for the other. */
    expect(row.id).toBe(`core:gear:${handle}`);
    expect(row.id).toBe(packMenu(state).items[0]!.id);
    expect(row.semantic).toEqual({ kind: "item", ref: handle, data: { source: "inventory", slot: 0 } });

    /* Addressed by column key, never by counting characters. */
    expect(row.cells.name!.text).toBe(objectName(state, obj));
    expect(row.cells.weight!.values).toEqual({ each: obj.weight, total: 2 * obj.weight, number: 2 });
  });

  it("renders each row on the OLIST_WEIGHT column stops it was rendered on before", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const food = objReg.kinds.find((k) => k.tval === TV.FOOD) as ObjectKind;
    const obj = addPack(state, food.name, 2);

    const expected =
      `a) ${objectName(state, obj).padEnd(45).slice(0, 45)} ${objectWeightColumn(obj)}`;
    expect(inventoryLines(state)[0]!.text).toBe(expected);
  });

  it("keeps an empty body slot as a ROW, disabled and with no item semantic", () => {
    /* The screen's subject is the body: a missing shield is the thing the player
     * came to look at, so it is a row rather than an absence - and it is marked
     * so a presenter does not draw it as gear. */
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const block = (equipmentScreen(state).blocks[0] as ScreenTableBlock);
    expect(block.rows.length).toBe(state.actor.player.body.count);
    const empty = block.rows.find((r) => r.disabled)!;
    expect(empty.semantic!.kind).toBe("slot");
    expect(empty.tag).toBeUndefined();
    expect(empty.cells.name!.text).toBe("(nothing)");
  });

  it("indents an empty slot by exactly the width of a letter, so the columns hold", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const lines = equipmentLines(state).map((l) => l.text);
    expect(lines.every((t) => t.startsWith("   ") || /^[a-zA-Z]\) /u.test(t))).toBe(true);
    /* And no line is padded out past where the game ends it. */
    expect(lines.every((t) => t === t.replace(/\s+$/u, ""))).toBe(true);
  });

  it("says '(nothing carried)' with nothing carried", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    expect(inventoryLines(state)).toEqual([{ text: "(nothing carried)", color: UI_DIM }]);
  });
});

describe("the four listings that gave up their models in step 5b", () => {
  /* The RENDERING of these four is already pinned by the describes above, which
   * is the point: they went through a model without moving a pixel. What is new
   * and needs its own tests is what the model carries BEYOND the rendering, and
   * the two layout facts that are now declared rather than inferred. */

  it("puts the quiver's weight in the row's numbers, and NOT in the text", () => {
    /* Upstream's quiver listing has no weight field, so growing one would be the
     * port adding something. A presenter can still draw it, because the model is
     * allowed to carry more than the rendering - never less. */
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const arrow = objReg.kinds.find((k) => k.tval === TV.ARROW) as ObjectKind;
    const obj = addPack(state, arrow.name, 20);
    /* calcInventory routes ammo to the quiver, so read the handle off the master
     * gear list rather than off `inven`, which is empty for an arrow. */
    state.gear.quiver = [state.gear.pack[state.gear.pack.length - 1]!];

    const block = quiverScreen(state).blocks[0] as ScreenTableBlock;
    const row = block.rows[0]!;
    expect(row.tag).toBe("0"); // a DIGIT, not a letter
    expect(row.values).toEqual({ each: obj.weight, total: 20 * obj.weight, number: 20 });
    expect(Object.keys(row.cells)).toEqual(["name"]);
    expect(quiverLines(state)[0]!.text).toBe(`0) ${objectName(state, obj)}`);
  });

  it("publishes the object list's offset as NUMBERS, not as a compass string", () => {
    /* "2 N 0 W" cannot be turned back into a map marker without parsing English
     * and guessing the sign convention, which is exactly the parsing this seam
     * exists to remove. */
    const state = makeTestState({ playerGrid: loc(20, 12) });
    putRealFloor(state, loc(20, 10), "& Wooden Torch~");
    const block = objectListScreen(state).blocks[0] as ScreenTableBlock;
    const row = block.rows[0]!;
    expect(row.values).toEqual({ dy: -2, dx: 0 });
    expect(row.cells.location!.text).toBe("2 N 0 W");
  });

  it("does NOT line the object list's locations up into a column", () => {
    /* Upstream writes "%s %s   %s" - the location FOLLOWS the name. A generic
     * table renderer would pad every name to the widest and quietly align them,
     * which looks tidier and is the port adding something. Two entries of
     * different name lengths keep exactly three spaces each. */
    const state = makeTestState({ playerGrid: loc(20, 12) });
    putRealFloor(state, loc(22, 12), "& Ration~ of Food");
    putRealFloor(state, loc(21, 12), "& Wooden Torch~");
    const rows = objectListLines(state).slice(1);
    expect(rows).toHaveLength(2);
    const names = new Set(rows.map((l) => l.text.length));
    expect(names.size).toBe(2); // the two rows really are different lengths
    for (const line of rows) expect(line.text).toMatch(/[^ ] {3}\d+ [NS] \d+ [EW]$/u);
  });

  it("keeps the player history's Note column where the header says it is", () => {
    /* Derived from the header rather than from a copy of the output: the two are
     * the same layout seen twice, and a `gap` that drifts must break one of them. */
    const state = makeTestState({ playerGrid: loc(20, 12) });
    state.actor.player.hist.push({
      type: 1 << HIST.PLAYER_BIRTH,
      dlev: 0,
      clev: 1,
      aIdx: 0,
      turn: 0,
      event: "Began the quest to destroy Morgoth.",
    });
    const lines = historyLines(state);
    expect(lines[1]!.text.indexOf("Began")).toBe(lines[0]!.text.indexOf("Note"));
  });

  it("carries the character level the history screen never prints", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    state.actor.player.hist.push({
      type: 1 << HIST.PLAYER_BIRTH,
      dlev: 3,
      clev: 7,
      aIdx: 0,
      turn: 1234,
      event: "Reached level 7",
    });
    const block = playerHistoryScreen(state).blocks[0] as ScreenTableBlock;
    expect(block.rows[0]!.values).toEqual({ turn: 1234, depth: 150, dlev: 3, clev: 7 });
    expect(historyLines(state)[1]!.text).not.toContain("7 ");
  });

  it("shows the history's column header even with no history at all", () => {
    /* The regression `tagged` taught, in its other form: a table's COLUMNS are a
     * fact about the table, so the header cannot be conditional on there being
     * rows under it. A character who has done nothing still has a Turn column. */
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const block = playerHistoryScreen(state).blocks[0] as ScreenTableBlock;
    expect(block.rows).toHaveLength(0);
    expect(historyLines(state)[0]!.text).toBe("      Turn   Depth  Note");
  });

  it("publishes a message's repeat count as a number as well as in its text", () => {
    const log = new MessageLog();
    log.push("You hit it.");
    log.push("You hit it.");
    const block = messageHistoryScreen(log).blocks[0] as ScreenTableBlock;
    expect(block.rows[0]!.values).toEqual({ count: 2 });
    expect(block.rows[0]!.cells.message!.text).toBe("You hit it. <2x>");
  });

  it("wraps long message history and history notes instead of losing their ending", () => {
    const long = "A long record must remain readable after it passes the width of an 80-column terminal, including its final punctuation.";
    const log = new MessageLog();
    log.push(long);
    const messageRows = screenBodyLines(messageHistoryScreen(log), 80).map((line) => line.text);
    expect(messageRows.every((line) => line.length <= 79)).toBe(true);
    expect(messageRows.join(" ")).toBe(long);

    const state = makeTestState({ playerGrid: loc(20, 12) });
    state.actor.player.hist.push({
      type: 1 << HIST.PLAYER_BIRTH,
      dlev: 0,
      clev: 1,
      aIdx: 0,
      turn: 0,
      event: long,
    });
    const historyRows = screenBodyLines(playerHistoryScreen(state), 80).slice(1).map((line) => line.text);
    expect(historyRows.every((line) => line.length <= 79)).toBe(true);
    expect(historyRows.map((line) => line.slice(20).trim()).join(" ")).toBe(long);
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

describe("magicBooks tester param (screens.ts, per-verb item_tester: cmd-obj.c L1129/1187/1215, ui-spell.c L340)", () => {
  const mage = players.classByName("Mage")!;

  /** A GameState wielding a real Mage class and carrying its first book. */
  function makeMageBookState(): GameState {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    state.actor.player.cls = mage;
    state.actor.player.lev = 1;
    state.actor.player.spellFlags = new Array<number>(mage.magic.totalSpells).fill(0);
    state.actor.player.upkeep.newSpells = 1;
    registerBookKinds(objReg, players.classes);
    const book = mage.magic.books[0]!;
    const kind = objReg.kinds.find(
      (k) => k.tval === book.tvalIdx && k.sval === book.sval,
    )!;
    const bookObj = objectPrep(new Rng(1), objReg, objConstants, kind, 0, "average");
    const handle = gearAdd(state.gear, bookObj);
    state.gear.pack.push(handle);
    calcInventory(state.gear, objConstants);
    return state;
  }

  it("defaults to the browse behaviour: the book is offered even with nothing learned", () => {
    const state = makeMageBookState();
    const { items, handles } = magicBooks(state);
    expect(items.length).toBe(1);
    expect(handles.length).toBe(1);
  });

  it("a cast tester (obj_can_cast_from) hides the book until a spell is learned", () => {
    const state = makeMageBookState();
    const p = state.actor.player;
    expect(magicBooks(state, (o) => objCanCastFrom(p, o)).items.length).toBe(0);
    spellLearn(p, 0);
    expect(magicBooks(state, (o) => objCanCastFrom(p, o)).items.length).toBe(1);
  });

  it("a study tester (obj_can_study) hides the book once nothing is left to learn", () => {
    const state = makeMageBookState();
    const p = state.actor.player;
    expect(magicBooks(state, (o) => objCanStudy(p, o)).items.length).toBe(1);
    for (const s of mage.magic.books[0]!.spells.filter((sp) => sp.level <= p.lev)) {
      spellLearn(p, s.sidx);
    }
    expect(magicBooks(state, (o) => objCanStudy(p, o)).items.length).toBe(0);
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
    purpleUniques: false,
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

describe("the prose pages that gave up their models in step 5b-ii", () => {
  /* The rendering-equivalence proof for these three is the ~30 tests above and in
   * the wrapRuns block, which went through a `text` block unchanged. What is
   * asserted here is only what the MODEL carries that the rendering does not. */

  const recallScreen = (): ScreenView => {
    const lore = newMonsterLore(breathingRace);
    lore.spellFlags.on(RSF.BR_POIS);
    lore.armourKnown = true;
    return monsterRecallScreen(breathingRace, lore, testRecallDeps());
  };

  const textBlock = (view: ScreenView): ScreenTextBlock => {
    const block = view.blocks[0];
    expect(block?.kind).toBe("text");
    return block as ScreenTextBlock;
  };

  it("publishes the recall UNWRAPPED, so the same model serves any width", () => {
    /* The point of the block. `monsterRecallLines` has to take a column count
     * because it renders; the screen does not, because the wrap is not part of
     * what the game knows - and a presenter with a proportional font has to redo
     * it anyway. Same paragraphs at any terminal size, and each one longer than
     * the rows the terminal would cut it into. */
    const view = recallScreen();
    const paragraphs = textBlock(view).paragraphs;
    const longest = Math.max(
      ...paragraphs.map((p) => p.reduce((n, r) => n + r.text.length, 0)),
    );
    expect(longest).toBeGreaterThan(79);
    expect(monsterRecallLines(breathingRace, newMonsterLore(breathingRace), testRecallDeps(), 80))
      .not.toEqual(
        monsterRecallLines(breathingRace, newMonsterLore(breathingRace), testRecallDeps(), 40),
      );
  });

  it("keeps the engine's own colours on the runs, not just on the rendered row", () => {
    /* loreDescription colours the parts that matter - the race name, the damage
     * figures - and a presenter that had to recover those from a rendered line
     * would be reading a rendering again. */
    const runs = textBlock(recallScreen()).paragraphs.flat();
    expect(new Set(runs.map((r) => r.color)).size).toBeGreaterThan(1);
  });

  it("splits ONLY where the core put a break, never where the terminal did", () => {
    /* A paragraph is a logical break. If the split had followed the wrap instead,
     * every paragraph would fit in a row - which is exactly the bug that would
     * make a `text` block a `lines` block wearing a different name. */
    const paragraphs = textBlock(recallScreen()).paragraphs;
    const rows = monsterRecallLines(
      breathingRace,
      (() => {
        const lore = newMonsterLore(breathingRace);
        lore.spellFlags.on(RSF.BR_POIS);
        lore.armourKnown = true;
        return lore;
      })(),
      testRecallDeps(),
      80,
    );
    expect(rows.length).toBeGreaterThan(paragraphs.length);
  });

  it("gives the object recall and the object COMPARISON different ids", () => {
    /* One subject versus two. A presenter that wanted to draw the comparison as
     * two columns could not tell it from an inspect page if they shared an id,
     * and the title is a display string it must not have to parse. */
    const tb: Textblock = { runs: [{ text: "A Dagger\nIt is sharp.", attr: WHITE }] };
    expect(objectRecallScreen("A Dagger", tb).id).toBe("core:object-recall");
    expect(objectComparisonScreen("Object comparison", tb).id).toBe("core:object-comparison");
    expect(objectRecallScreen("A Dagger", tb).blocks[0]).toEqual({
      kind: "text",
      color: colorToCss(WHITE),
      paragraphs: [
        [{ text: "A Dagger", color: colorToCss(WHITE) }],
        [{ text: "It is sharp.", color: colorToCss(WHITE) }],
      ],
    });
  });
});

/* ------------------------------------------------------------------ */
/* knownMonsterEntries ('~' -> Monsters,                                 */
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
      /* eslint-disable-next-line no-control-regex -- the ASCII range is the assertion. */
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

describe("the death screens gave up their models in step 5b-iii", () => {
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

  it("publishes the stone WITHOUT the epitaph written into it", () => {
    const block = tombstoneScreen(baseDeps).blocks[0]!;
    expect(block.kind).toBe("art");
    if (block.kind !== "art") throw new Error("unreachable");
    /* The whole point: the picture a presenter is handed is the picture, and
     * the character is beside it. A model that shipped the composited art would
     * be a rendering wearing a model's name. */
    expect(block.lines.join("\n")).not.toContain("Frodo");
    expect(block.lines.join("\n")).not.toContain("Level: 3");
    expect(block.fields?.map((f) => f.key)).toEqual([
      "name", "the", "title", "class", "level", "exp", "gold", "death", "killer", "date",
    ]);
  });

  it("publishes the numbers as numbers, not only as formatted text", () => {
    const block = tombstoneScreen(baseDeps).blocks[0]!;
    if (block.kind !== "art") throw new Error("unreachable");
    const by = (k: string): ScreenArtField => block.fields!.find((f) => f.key === k)!;
    expect(by("level").values).toEqual({ level: 3 });
    expect(by("exp").values).toEqual({ exp: 42 });
    expect(by("gold").values).toEqual({ gold: 100 });
    expect(by("death").values).toEqual({ depth: 5 });
    /* A name is not a quantity, so it has no `values` - absent means "there is
     * no number here", never zero. */
    expect(by("name").values).toBeUndefined();
    expect(by("name").text).toBe("Frodo");
  });

  it("drops the killer field entirely on retirement, rather than blanking it", () => {
    const block = tombstoneScreen({ ...baseDeps, retired: true, diedFrom: "Retiring" })
      .blocks[0]!;
    if (block.kind !== "art") throw new Error("unreachable");
    expect(block.fields?.map((f) => f.key)).not.toContain("killer");
    expect(block.fields?.find((f) => f.key === "death")?.text).toBe("Retired on Level 5");
  });

  it("gives the winner's banner no band, which is the full-width case", () => {
    const block = winnerScreen().blocks[0]!;
    if (block.kind !== "art") throw new Error("unreachable");
    expect(block.center).toBe(true);
    expect(block.width).toBe(25);
    const hail = block.fields![0]!;
    expect(hail.key).toBe("hail");
    /* put_str_centred(i, 0, wid, ...) in the C - centred on the TERMINAL, not on
     * the crown, and one row past the picture. */
    expect(hail.x1).toBeUndefined();
    expect(hail.x2).toBeUndefined();
    expect(hail.row).toBe(block.lines.length);
  });

  it("re-centres the banner when the terminal is not 80 columns", () => {
    const view = winnerScreen();
    const at = (cols: number): number =>
      screenBodyLines(view, cols).at(-1)!.text.indexOf("All Hail");
    // The banner is 28 chars: x = cols/2 - 14.
    expect(at(80)).toBe(26);
    expect(at(120)).toBe(46);
  });

  it("gives the two death screens distinct ids", () => {
    expect(tombstoneScreen(baseDeps).id).toBe("core:tombstone");
    expect(winnerScreen().id).toBe("core:winner");
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

/* ------------------------------------------------------------------ */
/* The model (#253 step 5b-vi): the monster list as a document         */
/* ------------------------------------------------------------------ */

describe("the visible-monster list gave up its model in step 5b-vi", () => {
  const kobold = monReg.races.find(
    (r) => r.name === "kobold" && !r.flags.has(RF.UNIQUE),
  ) as MonsterRace;

  const withOne = (): GameState => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const m = fakeVisibleMon(kobold, loc(23, 15)); // 3 E, 3 S
    m.mTimed[MON_TMD.SLEEP] = 500;
    state.monsters.push(m);
    return state;
  };

  it("is listed as modelled, and is a table rather than a page of lines", () => {
    expect(MODELLED_SCREENS).toContain("core:monster-list");
    const view = monsterListScreen(withOne(), 80);
    expect(view.id).toBe("core:monster-list");
    expect(view.blocks.some((b) => b.kind === "lines")).toBe(false);
    const table = view.blocks.find((b) => b.kind === "table") as ScreenTableBlock;
    expect(table.key).toBe("in-view");
    expect(table.caption?.text).toBe("You can see 1 monster:");
  });

  it("publishes the offset and the sleepers as NUMBERS, not as '3 S 3 E'", () => {
    /* The whole argument for `values` on this screen: an arrow on a minimap can
     * be drawn from a vector and cannot be recovered from a compass string
     * without parsing one back. */
    const view = monsterListScreen(withOne(), 80);
    const table = view.blocks.find((b) => b.kind === "table") as ScreenTableBlock;
    const row = table.rows[0]!;
    expect(row.values).toEqual({ count: 1, asleep: 1, dy: 3, dx: 3 });
    /* The game's own label, pluralisation and all, minus the terminal's "%3d "
     * right-justification - which is a column, not part of the name. */
    expect(row.semantic).toEqual({ kind: "monster", ref: "kobold", data: { name: "1 kobold" } });
    /* The glyph carries the RACE's colour, which is not the row's line colour -
     * that one encodes danger. Two facts, published apart. */
    expect(row.cells.glyph!.text).toBe(kobold.dChar);
    expect(row.cells.glyph!.color).toBeTypeOf("string");
    expect(row.cells.glyph!.color).not.toBe(row.color);
    /* And the terminal's own cell is still exactly what it always drew. */
    expect(row.cells.name!.text).toBe("  1 kobold (asleep)");
    expect(row.cells.location!.text).toBe(" 3 S 3 E");
  });

  it("names the sort toggle as an ACTION, so a presenter can reach it", () => {
    /* Left in the footer prose, 'x' would be a command a mod that took this
     * screen silently removed from the player. */
    const view = monsterListScreen(withOne(), 80);
    expect(view.actions).toEqual([{ id: "sort-exp", key: "x", label: "sort by exp" }]);
    expect(view.footer).toContain("turn ON 'sort by exp'");
    expect(monsterListScreen(withOne(), 80, true).footer).toContain("turn OFF");
  });

  it("keeps the name column clear of every name the pack can produce at 80 cols", () => {
    /* The one place the model and the C part: the C clips a name at THAT row's
     * own `full_width`, which is more generous on a row whose location is
     * shorter than the section's longest, while a column width is a fact about
     * the column. Measured rather than argued - the widest name+tag the shipped
     * pack can generate against the narrowest name column an 80-column terminal
     * can produce (a section holding the longest possible offset). A mod
     * re-rendering narrow clips a column class earlier than the C would, which
     * is recorded rather than hidden. */
    const widest = Math.max(
      ...monReg.races.map((r) => getMonName(r, 2).length + " (99 asleep)".length),
    );
    const narrowestNameColumn = 79 - 3 - " 99 N 99 W".length;
    expect(widest).toBeLessThan(narrowestNameColumn);
    /* 14 columns of margin when this was measured. Asserted loosely because the
     * number is a property of the CONTENT PACK - a mod that adds a monster with
     * a very long name moves it, and should fail here rather than silently start
     * clipping a name the C would have shown. */
    expect(narrowestNameColumn - widest).toBeGreaterThan(8);
  });

  it("draws exactly the rows it drew before the model, at every width", () => {
    /* The layout did not move: a right-aligned location column reproduces the
     * C's `"%-*s%s"` byte for byte, because the total is `max_width - 1` on
     * every row either way. Trailing spaces are the one difference and they
     * paint nothing. */
    /* A second RACE, so the section holds a grouped row (no offset) beside the
     * lone one (offset): the case where the C's per-row `full_width` and this
     * model's fixed column have to agree, and the one a same-race fixture would
     * have missed by merging everything into a single entry. */
    const rat = monReg.races.find(
      (r) => r.name !== "kobold" && !r.flags.has(RF.UNIQUE),
    ) as MonsterRace;
    const state = withOne();
    state.monsters.push(fakeVisibleMon(rat, loc(21, 12)));
    state.monsters.push(fakeVisibleMon(rat, loc(22, 12)));
    for (const cols of [40, 60, 80, 120]) {
      const rows = monsterListScreenLines(state, cols).map((l) => l.text);
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(cols - 1);
      expect(rows.some((r) => /3 S 3 E$/u.test(r))).toBe(true);
    }
  });
});

describe("samples/sprite-inventory draws the monster list from the numbers", () => {
  const kobold = monReg.races.find(
    (r) => r.name === "kobold" && !r.flags.has(RF.UNIQUE),
  ) as MonsterRace;

  /** A canvas that records the strings drawn on it and nothing else. */
  function recordingDocument(drawn: string[]): {
    doc: unknown;
    press: (key: string) => void;
  } {
    const keys: ((ev: { key: string }) => void)[] = [];
    const g = {
      fillRect: () => undefined,
      fillText: (text: string) => drawn.push(String(text)),
      measureText: (text: string) => ({ width: text.length * 7 }),
      beginPath: () => undefined,
      arc: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      strokeRect: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      closePath: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      set fillStyle(_v: string) {},
      set strokeStyle(_v: string) {},
      set font(_v: string) {},
      set lineWidth(_v: number) {},
    };
    return {
      doc: {
        createElement: () => ({ style: {}, getContext: () => g }),
        body: { appendChild: () => undefined },
        addEventListener: (_t: string, fn: (ev: { key: string }) => void) => keys.push(fn),
        removeEventListener: (_t: string, fn: (ev: { key: string }) => void) => {
          const i = keys.indexOf(fn);
          if (i >= 0) keys.splice(i, 1);
        },
      },
      press: (key) => {
        for (const fn of [...keys]) fn({ key });
      },
    };
  }

  /** A terminal that records nothing but whether it was written to. */
  function makeListTerm(): GridSurface & GridPointerInput & { printed: string[] } {
    const printed: string[] = [];
    return {
      printed,
      size: () => ({ cols: 80, rows: 24 }),
      clear: () => undefined,
      print: (_x: number, _y: number, text: string) => void printed.push(text),
    } as unknown as GridSurface & GridPointerInput & { printed: string[] };
  }

  afterEach(() => {
    setScreenPresenter(null);
    delete (globalThis as { document?: unknown }).document;
  });

  it("draws an arrow from dy/dx and flips the sort through the HOST", async () => {
    const drawn: string[] = [];
    const { doc, press } = recordingDocument(drawn);
    (globalThis as { document?: unknown }).document = doc;
    (globalThis as { window?: unknown }).window = { innerWidth: 960, innerHeight: 600 };
    const url = new URL("../../../samples/sprite-inventory/plugin.js", import.meta.url);
    const mod = (await import(url.href)) as { default: { screen: (ctx: unknown) => unknown } };
    const presenter = mod.default.screen({ id: "sprite-inventory", api: 1, log: () => undefined });
    setScreenPresenter({ id: "sprite-inventory", presenter: presenter as never });

    const state = makeTestState({ playerGrid: loc(20, 12) });
    state.monsters.push(fakeVisibleMon(kobold, loc(23, 15))); // 3 E, 3 S
    const term = makeListTerm();
    const open = showMonsterList(term, state);

    expect(term.printed, "the game drew it as well as the mod").toEqual([]);
    /* The arrow is the proof: "↘ 3" cannot be sliced out of " 3 S 3 E" without
     * turning a compass back into a vector, and the sample never sees that
     * string. The name is the game's own, unclipped. */
    expect(drawn).toContain("↘ 3");
    expect(drawn).toContain("1 kobold");
    expect(drawn).toContain("You can see 1 monster:");
    expect(drawn.some((t) => t.startsWith("[x] sort by exp"))).toBe(true);
    /* Not one padded terminal row reached the canvas. */
    const composite = monsterListScreenLines(state, 80).map((l) => l.text);
    for (const row of composite) if (row.includes("  ")) expect(drawn).not.toContain(row);

    /* 'x' goes through the host, so the GAME re-sorts and hands back the new
     * view - the mod never learns what "by experience" means. */
    const before = drawn.length;
    press("x");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(drawn.length).toBeGreaterThan(before);
    expect(drawn.slice(before).some((t) => t.includes("turn OFF"))).toBe(true);

    press("Escape");
    await expect(open).resolves.toBeUndefined();
    delete (globalThis as { window?: unknown }).window;
  });
});


/* ------------------------------------------------------------------ */
/* Inventory vs quiver, and the resist grid's knowledge gate           */
/* ------------------------------------------------------------------ */

describe("inventory listings walk upkeep->inven, not the master gear list", () => {
  it("lists quivered ammo in the quiver only, never in the inventory", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    addPack(state, "& Ration~ of Food");
    const shots = addPack(state, "& Iron Shot~", 20);

    /* calc_inventory routed the ammo into a quiver slot (player-calcs.c:1119). */
    expect(state.gear.quiver?.filter((h) => h !== 0)).toHaveLength(1);

    const inv = inventoryLines(state).map((l) => l.text);
    expect(inv.some((t) => t.includes("Ration"))).toBe(true);
    expect(inv.some((t) => t.includes("Iron Shot"))).toBe(false);

    /* The quiver source lists it, tagged by SLOT DIGIT (build_obj_list I2D). */
    const q = quiverMenu(state);
    expect(q.items).toHaveLength(1);
    expect(q.items[0]!.tag).toBe("0");
    expect(q.items[0]!.label).toContain("Iron Shot");
    expect(shots.number).toBe(20);

    /* And no item picker over the pack offers it either. */
    expect(packMenu(state).items.some((i) => i.label.includes("Iron Shot"))).toBe(false);
  });
});

describe("characterGrid knowledge gate (object_flag_is_known / object_element_is_known)", () => {
  const uiConfig = buildUiEntryConfig({
    uiEntry: loadJson<{ records: unknown[] }>("ui_entry").records,
    uiEntryBase: loadJson<{ records: unknown[] }>("ui_entry_base").records,
    uiEntryRenderer: loadJson<{ records: unknown[] }>("ui_entry_renderer").records,
    objectProperty: loadJson<{ records: unknown[] }>("object_property").records,
    playerProperty: loadJson<{ records: unknown[] }>("player_property").records,
  } as never);

  /**
   * The default test runeEnv carries no registry tables (the harness default);
   * rune learning needs the real object_property list, so give this state the
   * shipped tables exactly as session/game.ts wireGame does.
   */
  function withRunes(state: GameState): GameState {
    state.runeEnv = makeRuneEnv(
      (slot: number) => state.gear.store.get(state.actor.player.equipment[slot] ?? 0) ?? null,
      (v) => state.rng.randcalcVaries(v),
      {
        brands: objReg.brands,
        slays: objReg.slays,
        curses: objReg.curses,
        properties: objReg.properties,
      },
    );
    return state;
  }

  /** Wield a real kind into body slot `slot`, learning what upstream learns. */
  function wield(state: GameState, kindName: string, slot: number): GameObject {
    const kind = objReg.kinds.find((k) => k.name === kindName) as ObjectKind;
    const obj = objectNew(kind);
    obj.tval = kind.tval;
    obj.sval = kind.sval;
    obj.number = 1;
    obj.weight = kind.weight;
    const handle = gearAdd(state.gear, obj);
    state.gear.pack.push(handle);
    state.actor.player.equipment[slot] = handle;
    objectLearnOnWield(state.actor.player, obj, state.runeEnv);
    return obj;
  }

  it("prints '.' for a mundane weapon, whose runes are ALL known because it has none", () => {
    const state = withRunes(makeTestState({ playerGrid: loc(20, 12) }));
    wield(state, "& Main~ Gauche~", 0);
    const grid = characterGrid(state, uiConfig);
    const acidRow = grid.resistPanels[0]!.rows[0]!;
    /* object_fully_known -> object_element_is_known true -> value 0 -> '.'.
     * Reading p->obj_k alone printed '?' in every row of the weapon's column. */
    expect(acidRow.cells[0]!.symbol).toBe(".");
    const anyUnknown = grid.resistPanels.some((panel) =>
      panel.rows.some((r) => r.cells[0]!.symbol === "?"),
    );
    expect(anyUnknown).toBe(false);
  });

  it("still prints '?' for a property whose rune is genuinely unlearned", () => {
    const state = withRunes(makeTestState({ playerGrid: loc(20, 12) }));
    const obj = wield(state, "& Main~ Gauche~", 0);
    /* Give the weapon a resistance the player has NOT learned: it now has an
     * unknown rune, so object_fully_known is false and the row reads '?'. */
    obj.elInfo[ELEM.ACID]!.resLevel = 1;
    const grid = characterGrid(state, uiConfig);
    const acidRow = grid.resistPanels[0]!.rows.find((r) => r.label === " Acid:")!;
    expect(acidRow.cells[0]!.symbol).toBe("?");
  });
});

/* ------------------------------------------------------------------ */
/* The four screens a mod presenter could not reach                    */
/* ------------------------------------------------------------------ */

/**
 * showStoreKnowledge's row formatting EXACTLY as main.ts wrote it before the
 * model existed (main.ts L4213-4234 at 0.19.0).
 *
 * The point of keeping the dead expression here is that it is the CAPTURE: the
 * assertions below say "the table renders what the padded strings rendered", not
 * "the table renders what I expected the padded strings to render". A hand-typed
 * expectation would only ever have agreed with whichever of the two I typed it
 * from.
 *
 * TWO things are deliberately NOT the literal main.ts capture any more:
 *
 * The header's "Price", which main.ts placed at column 62 - two short of
 * `scr_places_x[LOC_PRICE] + 4` (ui-store.c L368) - a port defect fixed for
 * task #257 (see `storeKnowledgeScreen`'s own comment in screens.ts). Column 64
 * is where #257 moved it to, self-consistent with this screen's own (then
 * 46-wide) data columns but still not upstream's real number.
 *
 * The name/weight/price columns themselves, widened for task #264: #257's "64"
 * only agreed with itself, six columns left of where `store_display_recalc`
 * (ui-store.c L208-233) actually puts the price field at wid=80 - the same
 * six columns the live shop screen (shop.ts) already got right. Column 70 is
 * what upstream's arithmetic gives and what this file's dedicated column test
 * below derives independently, so the padEnd values below are corrected to
 * match rather than kept as a second copy of the bug.
 */
function storeKnowledgeLinesBefore(
  state: GameState,
  stock: readonly GameObject[],
  o: { owner: string; isHome: boolean; price: (obj: GameObject) => number },
): string[] {
  const { isHome } = o;
  const lines: string[] = [];
  lines.push(isHome ? "Your Home" : o.owner);
  lines.push("");
  lines.push(
    isHome
      ? `${"Home Inventory".padEnd(68)}Weight`
      : `${"Store Inventory".padEnd(58)}${"Weight".padEnd(12)}Price`,
  );
  if (stock.length === 0) {
    lines.push("");
    lines.push(isHome ? "  (Your home is empty.)" : "  (The shelves are bare.)");
  }
  // Task #264: the home's name field is 10 columns wider than a store's,
  // because store_display_recalc only reserves the store's -10 (room for a
  // price column) `if (store->feat != FEAT_HOME)` (ui-store.c L232-233) - see
  // STORE_NAME_WIDTH / HOME_NAME_WIDTH's comments in screens.ts.
  const nameWidth = isHome ? 62 : 52;
  stock.forEach((obj, i) => {
    const name = describeObject(state, obj);
    const wgt = obj.weight;
    const weightStr = `${Math.trunc(wgt / 10)}.${wgt % 10} lb`;
    const priceStr = isHome ? "" : String(o.price(obj));
    const tag = String.fromCharCode(97 + (i % 26));
    lines.push(
      `${tag}) ${name.padEnd(nameWidth).slice(0, nameWidth)} ${weightStr.padStart(8)}  ${priceStr.padStart(9)}`.trimEnd(),
    );
  });
  return lines;
}

describe("the knowledge menu's store view is a table (core:store-knowledge)", () => {
  /** A price that varies with the item, so a column of one repeated number
   *  could not pass by accident. */
  const price = (obj: GameObject): number => obj.weight * 7 + 3;

  function shopStock(state: GameState): GameObject[] {
    return [
      addPack(state, "& Ration~ of Food", 3),
      addPack(state, "& Flask~ of oil", 1),
      addPack(state, "& Wooden Torch~", 2),
    ];
  }

  it("renders byte for byte what the padded strings rendered - shop", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const stock = shopStock(state);
    const view = storeKnowledgeScreen(state, stock, {
      title: "General Store",
      owner: "Bilbo the Friendly",
      isHome: false,
      price,
    });
    expect(screenBodyLines(view, 80).map((l) => l.text)).toEqual(
      storeKnowledgeLinesBefore(state, stock, {
        owner: "Bilbo the Friendly",
        isHome: false,
        price,
      }),
    );
  });

  it("renders byte for byte what the padded strings rendered - home, no price", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const stock = shopStock(state);
    const view = storeKnowledgeScreen(state, stock, {
      title: "Home",
      owner: "ignored",
      isHome: true,
    });
    expect(screenBodyLines(view, 80).map((l) => l.text)).toEqual(
      storeKnowledgeLinesBefore(state, stock, { owner: "ignored", isHome: true, price }),
    );
  });

  it("renders byte for byte what the padded strings rendered - both empty states", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    for (const isHome of [false, true]) {
      const view = storeKnowledgeScreen(state, [], {
        title: "Alchemy shop",
        owner: "Ga-nat the Greedy",
        isHome,
        ...(isHome ? {} : { price }),
      });
      expect(screenBodyLines(view, 80).map((l) => l.text)).toEqual(
        storeKnowledgeLinesBefore(state, [], {
          owner: "Ga-nat the Greedy",
          isHome,
          price,
        }),
      );
    }
  });

  it("publishes the price as a CELL, and the home has no price column at all", () => {
    /* The whole point of the model: "what does this cost" is a lookup rather than
     * a substring of a padded row. And the home's missing price is a real
     * conditional - store_display_entry skips it for FEAT_HOME (ui-store.c L303)
     * - so a presenter never has to decide whether a blank means free or
     * unknown. */
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const stock = shopStock(state);
    const shop = storeKnowledgeScreen(state, stock, {
      title: "General Store",
      owner: "Bilbo",
      isHome: false,
      price,
    }).blocks[1] as ScreenTableBlock;
    expect(shop.tagged).toBe(true);
    expect(shop.columns.map((c) => c.key)).toEqual(["name", "weight", "price"]);
    expect(shop.rows[0]!.cells.price!.text).toBe(String(price(stock[0]!)));
    expect(shop.rows[0]!.cells.price!.values).toEqual({ price: price(stock[0]!) });
    expect(shop.rows[0]!.tag).toBe("a");
    expect(shop.rows[0]!.semantic).toMatchObject({ kind: "item" });

    const home = storeKnowledgeScreen(state, stock, {
      title: "Home",
      owner: "x",
      isHome: true,
    }).blocks[1] as ScreenTableBlock;
    expect(home.columns.map((c) => c.key)).toEqual(["name", "weight"]);
    expect(home.rows[0]!.cells.price).toBeUndefined();
    expect(home.rows[0]!.values).toEqual({
      number: stock[0]!.number,
      weight: stock[0]!.weight,
    });
  });
});

/* ------------------------------------------------------------------ */
/* task #257 / #264: the knowledge store's "Price" header column        */
/* ------------------------------------------------------------------ */

/**
 * Pins the header's "Price" against upstream's OWN arithmetic
 * (`scr_places_x[LOC_PRICE] + 4`, ui-store.c L368) rather than against
 * whatever `storeKnowledgeScreen` happens to emit - a test that just records
 * the current output would have recorded the pre-fix column just as happily.
 *
 * Upstream draws the numeric price with `%9ld` (ui-store.c L314-316) starting
 * at `scr_places_x[LOC_PRICE]`, then draws the "Price" label 4 columns into
 * that SAME 9-wide field (L368) - so the 5-char label's last character lands
 * on the field's own last column: label right-justified flush with the data.
 * This screen's price cell is the row's own last field (`priceStr.padStart(9)`
 * in `storeKnowledgeLinesBefore` above, matching `STORE_STOCK_COLUMNS`'s
 * `{ key: "price", width: 9, gap: 2 }`), so its end column is read directly off
 * a real rendered row rather than retyped - and from there the expected header
 * column follows by the same subtraction upstream's own code performs.
 */
describe('the knowledge store\'s "Price" header column (task #257 / #264)', () => {
  const price = (obj: GameObject): number => obj.weight * 7 + 3;

  it("right-justifies against the price field's own end column, matching scr_places_x[LOC_PRICE] + 4", () => {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    const stock = [addPack(state, "& Ration~ of Food", 3)];
    const view = storeKnowledgeScreen(state, stock, {
      title: "General Store",
      owner: "Bilbo the Friendly",
      isHome: false,
      price,
    });
    const lines = screenBodyLines(view, 80);
    const header = lines[2]!;
    const row0 = lines[3]!;

    // Ground truth for the price field's own end column, read off a rendered
    // row rather than hand-computed - it is unchanged by this fix and already
    // covered by the "byte for byte" tests above. The price string is the
    // row's last field and carries no trailing padding of its own (it is a
    // plain positive number), so its last character IS the row's last
    // character.
    const priceColumn = STORE_STOCK_COLUMNS.find((c) => c.key === "price")!;
    expect(priceColumn.width).toBe(9);
    const priceFieldEnd = row0.text.length - 1;

    // Upstream's own subtraction: the label is 5 characters and ends where the
    // 9-wide numeric field ends, i.e. it starts 4 short of that end column.
    const expectedPriceHeaderCol = priceFieldEnd - ("Price".length - 1);

    expect(header.text.indexOf("Price")).toBe(expectedPriceHeaderCol);
    // Task #264: this was 64 (self-consistent with the screen's own then-46-wide
    // name column, but NOT with upstream) before the name/weight/price columns
    // were widened to match store_display_recalc at wid=80. It is 70 now for the
    // reason the NEXT test checks independently: 70 is scr_places_x[LOC_PRICE] + 4
    // computed from the upstream formula directly, not read back off this
    // screen's own row.
    expect(expectedPriceHeaderCol).toBe(70);
    expect(header).toEqual({
      text: `${"Store Inventory".padEnd(58)}${"Weight".padEnd(12)}Price`,
    });
  });

  /**
   * Task #264's actual defect: the previous test only proves the header agrees
   * with THIS SCREEN'S OWN data row, which is exactly the check that already
   * passed at column 64 before this fix (self-consistency is not the same as
   * correctness - #257 satisfied it while still being 6 columns off). This test
   * instead computes `scr_places_x[LOC_PRICE] + 4` from `store_display_recalc`'s
   * own formula (ui-store.c L219, L226) at wid=80 - the width every test in this
   * file already renders at (`screenBodyLines(view, 80)`, and `screenBodyLines`'s
   * own default) - with NOTHING read back from the rendered output, so it cannot
   * pass merely because the screen agrees with itself.
   *
   * Without the #264 fix (STORE_NAME_WIDTH=46), this screen's header put "Price"
   * at column 64 - this assertion of 70 would have failed. Confirmed by reverting
   * STORE_NAME_WIDTH to 46 and re-running: `header.text.indexOf("Price")` reads 64.
   */
  it("matches store_display_recalc's OWN arithmetic at wid=80, not merely its own row", () => {
    const wid = 80; // Term_get_size at the width this whole screen family renders at
    const locPrice = wid - 14; // ui-store.c L226
    const expectedFromUpstream = locPrice + 4; // ui-store.c L368
    expect(expectedFromUpstream).toBe(70);

    const state = makeTestState({ playerGrid: loc(20, 12) });
    const stock = [addPack(state, "& Ration~ of Food", 3)];
    const view = storeKnowledgeScreen(state, stock, {
      title: "General Store",
      owner: "Bilbo the Friendly",
      isHome: false,
      price,
    });
    const header = screenBodyLines(view, 80)[2]!;
    expect(header.text.indexOf("Price")).toBe(expectedFromUpstream);
  });

  /**
   * The actual #264 title: "the two store screens still disagree on Price ...
   * for a different reason". shop.ts's `geom()` computes `priceX = wid - 14`
   * from the LIVE terminal (shop.ts:488, mirroring ui-store.c L226) and draws
   * the label at `gm.priceX + 4` (shop.ts:564) - the identical formula the
   * previous test derives independently from the C source. There is no shared
   * renderer to call from here (a shop needs a live `StartedGame` and a `Term`,
   * which is shop.ts's own fixture, not this file's), so this pins the SAME
   * upstream-derived constant (70 at wid=80) both screens must produce, rather
   * than an arithmetic identity (field width minus label length) that would
   * hold regardless of which column either screen actually drew at - which is
   * what this test used to check, and which could not have caught #264 at all:
   * it was true at column 64 just as it is at column 70.
   */
  it("agrees with the live shop screen's own geom(): both put \"Price\" at column 70 for wid=80", () => {
    const wid = 80;
    const shopPriceHeaderCol = (wid - 14) + 4; // shop.ts:488's priceX, then shop.ts:564's priceX + 4
    expect(shopPriceHeaderCol).toBe(70);

    const state = makeTestState({ playerGrid: loc(20, 12) });
    const stock = [addPack(state, "& Ration~ of Food", 3)];
    const view = storeKnowledgeScreen(state, stock, {
      title: "General Store",
      owner: "Bilbo the Friendly",
      isHome: false,
      price,
    });
    const header = screenBodyLines(view, 80)[2]!;
    expect(header.text.indexOf("Price")).toBe(shopPriceHeaderCol);
  });
});

/**
 * A related defect found in passing while deriving the #264 arithmetic above:
 * the home's weight column reused the STORE's name width (then 46, giving both
 * screens the same shape), but `store_display_recalc` gives the home a WIDER
 * name field than a store's - `scr_places_x[LOC_WEIGHT]` only gets the -10 that
 * reserves room for a price column `if (store->feat != FEAT_HOME)` (ui-store.c
 * L232-233), so the home's weight sits at plain `wid - 14` = 66 at wid=80, ten
 * columns right of a store's 56. This was never named by #264 (which is scoped
 * to Price, and the home has none), but it is the identical mechanism in the
 * identical function, so it is fixed alongside rather than left as a second,
 * now-consciously-known instance of the same mistake.
 *
 * Before this fix the home's "Weight" header sat at column 52 (46 + gap), 16
 * columns left of upstream's 68 - a bigger miss than the store's ever was, and
 * one nothing had previously measured because no test asserted the home's
 * header column against upstream's own arithmetic; the "byte for byte" tests
 * above only ever checked the port against ITSELF.
 */
describe("the knowledge store's HOME view: the weight column (found alongside #264)", () => {
  it("matches store_display_recalc's home arithmetic at wid=80 (no price column to reserve for)", () => {
    const wid = 80;
    const locWeightHome = wid - 14; // ui-store.c L226; L232-233's `-10` does NOT apply to FEAT_HOME
    const expectedFromUpstream = locWeightHome + 2; // ui-store.c L344-345 ("Weight" label, +2 into the field)
    expect(expectedFromUpstream).toBe(68);

    const state = makeTestState({ playerGrid: loc(20, 12) });
    const stock = [addPack(state, "& Ration~ of Food", 3)];
    const view = storeKnowledgeScreen(state, stock, {
      title: "Home",
      owner: "ignored",
      isHome: true,
    });
    const header = screenBodyLines(view, 80)[2]!;
    expect(header.text.indexOf("Weight")).toBe(expectedFromUpstream);
  });
});

/* ------------------------------------------------------------------ */
/* The Hall of Fame                                                    */
/* ------------------------------------------------------------------ */

const HOF_NAMES: ScoreNameResolver = {
  raceName: (i) => ["Half-Troll", "Human", "Dwarf"][i] ?? null,
  className: (i) => ["Warrior", "Mage"][i] ?? null,
};

/* One record of each shape display_score_page branches on: a dungeon death with
 * both "(Max N)" arms, a town death whose race and class do not resolve, and a
 * winner. */
const HOF_SCORES: HighScore[] = [
  { what: "4.2.6", pts: 123456, gold: 9876, turns: 54321, day: "@20260813", who: "Frodo",
    uid: 1000, pRace: 0, pClass: 0, curLev: 20, curDun: 12, maxLev: 21, maxDun: 15,
    how: "a Cave Orc" },
  { what: "4.2.6", pts: 12, gold: 0, turns: 7, day: "TODAY", who: "Bo",
    uid: 7, pRace: 9, pClass: 9, curLev: 1, curDun: 0, maxLev: 1, maxDun: 0,
    how: "a Fruit Bat" },
  { what: "4.2.6", pts: 5000, gold: 120, turns: 900, day: "@20250101", who: "Cee",
    uid: 42, pRace: 1, pClass: 1, curLev: 5, curDun: 3, maxLev: 5, maxDun: 3,
    how: "Ripe Old Age" },
];

describe("display_score_page's three lines did not move (ui-score.c L30)", () => {
  /**
   * The capture, taken off the shipped build BEFORE `scoreRow` was refactored to
   * compose from `ScoreRow.fields`. Every character of the Hall of Fame the
   * player reads is in here.
   */
  it("builds the same strings it always did", () => {
    const rows = scorePageRows(HOF_SCORES, 0, 3, 1, HOF_NAMES);
    expect(rows.map((r) => [r.line1, r.line2, r.line3])).toEqual([
      [
        "  1.   123456  Frodo the Half-Troll Warrior, level 20 (Max 21)",
        "Killed by a Cave Orc on dungeon level 12 (Max 15)",
        "(User 1000, Date 2026-08-13, Gold 9876, Turn 54321).",
      ],
      [
        "  2.       12  Bo the <none> <none>, level 1",
        "Killed by a Fruit Bat in the town",
        "(User 7, Date TODAY, Gold 0, Turn 7).",
      ],
      [
        "  3.     5000  Cee the Human Mage, level 5",
        "Killed by Ripe Old Age on dungeon level 3",
        "(User 42, Date 2025-01-01, Gold 120, Turn 900).",
      ],
    ]);
    expect(rows[1]!.color).toBe(COLOUR_L_GREEN);
    expect(rows[0]!.color).toBe(COLOUR_WHITE);
  });

  /**
   * THE ANTI-DRIFT CHECK. The lines and the table cells come from ONE extraction
   * (`ScoreRow.fields`), and this is what holds them to it: if the fields ever
   * stop being what the lines are made of, the strings above still pass and this
   * does not. That is the whole reason the fields live beside the lines instead
   * of being read a second time in the front end.
   */
  it("makes each line out of the fields it publishes", () => {
    for (const row of scorePageRows(HOF_SCORES, 0, 3, -1, HOF_NAMES)) {
      const f = row.fields;
      expect(
        row.line1.startsWith(`${f.rankText}.${f.pointsText}  ${f.who} the ${f.race} ${f.cls},`),
      ).toBe(true);
      expect(row.line1).toContain(`level ${String(f.level)}`);
      expect(row.line2).toContain(`Killed by ${f.how}`);
      expect(row.line3).toBe(
        `(User ${String(f.uid)}, Date ${f.date}, Gold ${String(f.gold)}, Turn ${String(f.turns)}).`,
      );
    }
  });
});

describe("the Hall of Fame is a table now (core:hall-of-fame)", () => {
  it("gives a mod every record, addressed by key, with the numbers beside them", () => {
    const view = hallOfFameScreen(scoreRows(HOF_SCORES, 0, 3, 1, HOF_NAMES));
    expect(view.id).toBe("core:hall-of-fame");
    /* No actions: a listing is dismissed, not answered. Paging is the terminal's
     * answer to three-line records on a 24-row screen, not a game command. */
    expect(view.actions).toBeUndefined();
    const table = view.blocks[0] as ScreenTableBlock;
    /* EVERY record, not the five the terminal has room for - a leaderboard a mod
     * can only see one page of is not a leaderboard. */
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]!.cells).toMatchObject({
      rank: { text: "  1" },
      points: { text: "   123456" },
      who: { text: "Frodo" },
      race: { text: "Half-Troll" },
      class: { text: "Warrior" },
      how: { text: "a Cave Orc" },
      date: { text: "2026-08-13" },
    });
    /* current + max together mean a proportion, which is what "(Max 21)" is. */
    expect(table.rows[0]!.cells.level!.values).toEqual({ current: 20, max: 21 });
    expect(table.rows[0]!.cells.depth!.values).toEqual({ current: 12, max: 15 });
    /* Sortable without parsing anything - the failure this screen was. */
    expect(table.rows.map((r) => r.values!.points)).toEqual([123456, 12, 5000]);
    expect(table.rows.map((r) => r.values!.turns)).toEqual([54321, 7, 900]);
    /* "Which row is me" as a number, not as a colour a presenter has to match. */
    expect(table.rows.map((r) => r.values!.highlighted)).toEqual([0, 1, 0]);
    expect(table.rows[1]!.color).toBe(colorToCss(COLOUR_L_GREEN));
    expect(table.rows[0]!.semantic).toEqual({
      kind: "score",
      ref: 1,
      data: { who: "Frodo", how: "a Cave Orc" },
    });
  });

  it("titles and foots itself with the strings display_scores_aux prints", () => {
    expect(hallOfFameTitle(0)).toBe("Neo Angband Hall of Fame");
    expect(hallOfFameTitle(5)).toBe("Neo Angband Hall of Fame (from position 6)");
    expect(hallOfFameFooter(true)).toBe(
      "[Press ESC to exit, up for prior page, any other key for next page.]",
    );
    expect(hallOfFameFooter(false)).toBe(
      "[Press ESC to exit, any other key to page forward till done.]",
    );
    expect(hallOfFameScreen([], { from: 5, allowScrolling: false })).toMatchObject({
      title: "Neo Angband Hall of Fame (from position 6)",
      footer: "[Press ESC to exit, any other key to page forward till done.]",
    });
  });
});

/** A terminal that remembers WHERE each string landed, for a positioned paint. */
function makeGridTerm(): GridSurface & GridPointerInput & { grid: () => string[] } {
  const rows: string[] = Array.from({ length: 24 }, () => "");
  return {
    grid: () => rows.map((r) => r.replace(/\s+$/u, "")),
    size: () => ({ cols: 80, rows: 24 }),
    clear: () => {
      rows.fill("");
    },
    print: (x: number, y: number, text: string) => {
      const row = (rows[y] ?? "").padEnd(x, " ");
      rows[y] = row.slice(0, x) + text + row.slice(x + text.length);
    },
  } as unknown as GridSurface & GridPointerInput & { grid: () => string[] };
}

describe("showScoreScreen: the seam, and the terminal underneath it", () => {
  afterEach(() => setScreenPresenter(null));

  /**
   * The byte-for-byte capture, taken off the shipped build before the seam was
   * cut: three-line records at rows n*4+2..4 with the detail lines indented to
   * column 15, the banner centred at column 30, the prompt at column 6 of row 23.
   *
   * `screenBodyLines` is NOT the renderer here and cannot be - it emits one row
   * per table row and display_score_page writes three and a blank - so what is
   * measured is the paint itself, which is what the player looks at. See
   * `hallOfFameScreen` for why the model is one row per record anyway.
   */
  it("paints exactly what it painted before", () => {
    const term = makeGridTerm();
    /* Never resolves - the screen is waiting for a key - which is why nothing
     * awaits it and why the assertion is on the FIRST paint. */
    void showScoreScreen(term, HOF_SCORES, HOF_NAMES, { highlight: 1 });
    expect(term.grid()).toEqual([
      "                              Neo Angband Hall of Fame",
      "",
      "  1.   123456  Frodo the Half-Troll Warrior, level 20 (Max 21)",
      "               Killed by a Cave Orc on dungeon level 12 (Max 15)",
      "               (User 1000, Date 2026-08-13, Gold 9876, Turn 54321).",
      "",
      "  2.       12  Bo the <none> <none>, level 1",
      "               Killed by a Fruit Bat in the town",
      "               (User 7, Date TODAY, Gold 0, Turn 7).",
      "",
      "  3.     5000  Cee the Human Mage, level 5",
      "               Killed by Ripe Old Age on dungeon level 3",
      "               (User 42, Date 2025-01-01, Gold 120, Turn 900).",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "      [Press ESC to exit, up for prior page, any other key for next page.]",
    ]);
  });

  it("offers the whole table to a presenter, and does not paint when it is taken", () => {
    const seen: ScreenView[] = [];
    setScreenPresenter({
      id: "test-presenter",
      presenter: {
        show: (view) => {
          seen.push(view);
          return { dismissed: Promise.resolve() };
        },
      },
    });
    const term = makeGridTerm();
    void showScoreScreen(term, HOF_SCORES, HOF_NAMES, { highlight: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe("core:hall-of-fame");
    expect((seen[0]!.blocks[0] as ScreenTableBlock).rows).toHaveLength(3);
    /* The game drew NOTHING. This screen used to be term.clear()/term.print()
     * with showThroughPresenter nowhere in the file. */
    expect(term.grid().every((r) => r === "")).toBe(true);
  });

  it("falls back to its own paint when the presenter declines", () => {
    setScreenPresenter({ id: "test-presenter", presenter: { show: () => undefined } });
    const term = makeGridTerm();
    void showScoreScreen(term, HOF_SCORES, HOF_NAMES, { highlight: 1 });
    expect(term.grid()[0]).toBe("                              Neo Angband Hall of Fame");
  });

  /**
   * The non-scrolling form, which close_game asks for on the way out of a living
   * game (predict_score(false), ui-game.c:1158). Only the footer differs on the
   * screen, and it differs at a different COLUMN too - 9 rather than 6
   * (display_scores_aux, ui-score.c:155-160) - so the paint is what pins it.
   */
  it("foots the non-scrolling form at column 9, as display_scores_aux does", () => {
    const term = makeGridTerm();
    void showScoreScreen(term, HOF_SCORES, HOF_NAMES, {
      highlight: 1,
      allowScrolling: false,
    });
    expect(term.grid()[23]).toBe(
      "         [Press ESC to exit, any other key to page forward till done.]",
    );
  });
});

/**
 * predict_score (ui-score.c:193) as the port runs it: the living-character
 * preview close_game shows after ^X, and the Hall of Fame command's scrolling
 * form. What matters here is that NEITHER writes - predict_score's argument is
 * display_scores_aux's allow_scrolling, and reading it as a write flag is the
 * mistake this pins shut. The stored table is only ever written by enterScore, at
 * a real death.
 */
describe("showPredictedScores previews without writing", () => {
  /** The seven Player fields build_score reads (score.c L194). */
  const LIVE_PLAYER = {
    maxExp: 4000,
    maxDepth: 8,
    au: 250,
    lev: 11,
    maxLev: 12,
    race: { ridx: 1 },
    cls: { cidx: 1 },
    fullName: "Alive",
  } as unknown as Player;

  /** A store that records every write, so "nothing was written" is measurable. */
  function spyStore(): ScoreStore & { writes: HighScore[][] } {
    const writes: HighScore[][] = [];
    return {
      writes,
      read: () => HOF_SCORES.map((s) => ({ ...s })),
      write: (scores: HighScore[]) => {
        writes.push(scores);
      },
    };
  }

  it("shows the live character in the table and writes nothing (close_game's false)", () => {
    const term = makeGridTerm();
    const store = spyStore();
    void showPredictedScores(
      term,
      store,
      LIVE_PLAYER,
      { diedFrom: "nobody (yet!)", turn: 1234, depth: 6, fullName: "Alive" },
      HOF_NAMES,
      false,
      false,
    );
    const grid = term.grid();
    /* The provisional row is IN the table (highscore_add into the list read out
     * of the store), highlighted, and reads "Killed by nobody (yet!)". */
    expect(grid.join("\n")).toContain("Alive the Human Mage, level 11");
    expect(grid.join("\n")).toContain("Killed by nobody (yet!) on dungeon level 6");
    /* allowScrolling false travelled all the way to the footer. */
    expect(grid[23]).toBe(
      "         [Press ESC to exit, any other key to page forward till done.]",
    );
    expect(store.writes).toEqual([]);
  });

  it("defaults to the scrolling footer, which is what show_scores asks for", () => {
    const term = makeGridTerm();
    const store = spyStore();
    void showPredictedScores(
      term,
      store,
      LIVE_PLAYER,
      { diedFrom: "nobody (yet!)", turn: 1234, depth: 6, fullName: "Alive" },
      HOF_NAMES,
      false,
    );
    expect(term.grid()[23]).toBe(
      "      [Press ESC to exit, up for prior page, any other key for next page.]",
    );
    expect(store.writes).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The two shell pages that keep a command                             */
/* ------------------------------------------------------------------ */

describe("the update page travels with its keys (core:update)", () => {
  const lines = [{ text: "Neo Angband 0.19.0", color: "#fff" }];

  it("keeps the prose as lines and names ENTER by what it will do", () => {
    const view = updateScreen({ phase: "offer", how: "swap" }, lines, "[ x ]", 0);
    expect(view.id).toBe("core:update");
    expect(view.blocks).toEqual([{ kind: "lines", lines }]);
    expect(view.actions).toEqual([
      { id: "confirm", key: "ENTER", label: "update and restart" },
      { id: "channel", key: "C", label: "change channel" },
    ]);
  });

  it("offers M only when a mod update is waiting, as the footer does", () => {
    expect(updateScreen({ phase: "offer", how: "swap" }, lines, "", 2).actions).toContainEqual({
      id: "mods",
      key: "M",
      label: "mod updates",
    });
    expect(
      updateScreen({ phase: "offer", how: "swap" }, lines, "", 0).actions?.some(
        (a) => a.id === "mods",
      ),
    ).toBe(false);
  });

  it("offers nothing at all mid-download, and no ENTER when up to date", () => {
    /* A button a presenter draws that does nothing when clicked is how a player
     * learns to distrust the interface - the footer's own reasoning. */
    expect(
      updateScreen({ phase: "downloading", how: "swap" }, lines, "", 3).actions,
    ).toBeUndefined();
    expect(
      updateScreen({ phase: "uptodate", how: "swap" }, lines, "", 0).actions?.map((a) => a.id),
    ).toEqual(["channel"]);
    expect(updateScreen({ phase: "failed", how: "swap" }, lines, "", 0).actions?.[0]).toEqual({
      id: "confirm",
      key: "ENTER",
      label: "try again",
    });
    expect(updateScreen({ phase: "unchecked", how: "web" }, lines, "", 0).actions).toEqual([
      { id: "confirm", key: "ENTER", label: "check again" },
    ]);
  });

  it("names a key for every action, so invoke() can run one", () => {
    for (const phase of ["offer", "uptodate", "failed", "unchecked", "downloading"] as const) {
      for (const how of ["swap", "web", "manual"] as const) {
        for (const action of updateScreen({ phase, how }, lines, "", 1).actions ?? []) {
          expect(UPDATE_ACTION_KEYS[action.id], action.id).toBeDefined();
        }
      }
    }
  });
});

describe("the report page travels with its keys (core:report)", () => {
  const lines = [{ text: "logging level: info", color: "#fff" }];

  it("keeps the prose as lines and offers D / L / ENTER while composing", () => {
    const view = reportScreen({ phase: "compose" }, lines, "[ x ]");
    expect(view.id).toBe("core:report");
    expect(view.blocks).toEqual([{ kind: "lines", lines }]);
    expect(view.actions).toEqual([
      { id: "describe", key: "D", label: "describe" },
      { id: "log-level", key: "L", label: "logging level" },
      { id: "confirm", key: "ENTER", label: "write it" },
    ]);
    for (const action of view.actions ?? []) {
      expect(REPORT_ACTION_KEYS[action.id], action.id).toBeDefined();
    }
  });

  it("has nothing left to do once it is saved, and retries after a failure", () => {
    expect(reportScreen({ phase: "saved" }, lines, "").actions).toBeUndefined();
    expect(reportScreen({ phase: "failed" }, lines, "").actions).toEqual([
      { id: "confirm", key: "ENTER", label: "try again" },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* The census: which actions take the terminal                         */
/* ------------------------------------------------------------------ */

describe("every action is on exactly one side of the prompt census", () => {
  /**
   * EVERY VIEW ANY BUILDER CAN PRODUCE WITH `actions`, built from the REAL
   * builders across every branch that changes the action list - not from
   * literals. A census checked against a hand-written list of ids is a census
   * checked against itself; it has to be checked against what a presenter is
   * actually handed.
   */
  function viewsWithActions(): ScreenView[] {
    const state = makeTestState({ playerGrid: loc(20, 12) });
    /* p->known_state, which the character sheet reads for ac / to_a / to_h /
     * to_d (char-sheet.ts panelCombat). A separate object rather than a second
     * reference to `combat`, exactly as charsheet.test.ts's own fixture keeps
     * them apart - sharing would make a test that moves the real state move the
     * known one too. */
    (state.actor as { knownCombat?: unknown }).knownCombat = {
      toH: 0, toD: 0, ac: 0, toA: 0, skills: [],
      numBlows: 100, ammoMult: 1, numShots: 0, ammoTval: 0, blessWield: false,
    };
    const uiConfig = buildUiEntryConfig({
      uiEntry: loadJson<{ records: unknown[] }>("ui_entry").records,
      uiEntryBase: loadJson<{ records: unknown[] }>("ui_entry_base").records,
      uiEntryRenderer: loadJson<{ records: unknown[] }>("ui_entry_renderer").records,
      objectProperty: loadJson<{ records: unknown[] }>("object_property").records,
      playerProperty: loadJson<{ records: unknown[] }>("player_property").records,
    } as never);
    const out: ScreenView[] = [
      characterScreen(state, "Fred"),
      characterFlagsScreen(state, "Fred", uiConfig),
      monsterListScreen(state, 80, false),
      monsterListScreen(state, 80, true),
    ];
    const proseLines = [{ text: "Neo Angband", color: "#fff" }];
    for (const phase of ["offer", "uptodate", "failed", "unchecked", "downloading"] as const) {
      for (const how of ["swap", "web", "manual"] as const) {
        for (const modCount of [0, 2]) {
          out.push(updateScreen({ phase, how }, proseLines, "", modCount));
        }
      }
    }
    for (const phase of ["compose", "saved", "failed"] as const) {
      out.push(reportScreen({ phase }, proseLines, ""));
    }
    /* The saved page again, with the report screen's destination rows FULL: one
     * per mod up to the cap, so every `tracker-*` id the builder can produce is
     * published and the census below is asked about all of them. Driven through
     * `reportDestinations` rather than hand-written, because a hand-written list
     * is exactly the second copy that goes stale when the cap moves. */
    out.push(
      reportScreen(
        { phase: "saved" },
        proseLines,
        "",
        reportDestinations(
          Array.from({ length: REPORT_MAX_MOD_TRACKERS }, (_, i) => ({
            id: `mod-${String(i)}`,
            repo: `someone/mod-${String(i)}`,
          })),
        ),
      ),
    );
    return out.filter((v) => (v.actions?.length ?? 0) > 0);
  }

  it("names every published action exactly once, prompting or not", () => {
    /* TOTAL and DISJOINT. Total is the point: an action in neither table is one
     * nobody has followed into what `invoke` calls, and four such actions is how
     * this defect happened. Disjoint is the other half - an action in both is a
     * contradiction about whether the player can see the question. */
    const seen = new Set<string>();
    for (const view of viewsWithActions()) {
      const prompts = SCREEN_PROMPTS[view.id] ?? {};
      const safe = SCREEN_NO_PROMPT[view.id] ?? [];
      for (const action of view.actions ?? []) {
        seen.add(`${view.id}/${action.id}`);
        const prompting = Object.prototype.hasOwnProperty.call(prompts, action.id);
        const quiet = safe.includes(action.id);
        expect(
          [prompting, quiet],
          `${view.id} "${action.id}" is in ${String(Number(prompting) + Number(quiet))} of the two tables`,
        ).toEqual([prompting, !prompting]);
      }
    }
    /* And nothing in the tables that no builder publishes: a census that names a
     * command the game no longer has looks maintained and is not. */
    for (const [viewId, actions] of Object.entries(SCREEN_PROMPTS)) {
      for (const actionId of Object.keys(actions)) {
        expect(seen.has(`${viewId}/${actionId}`), `${viewId}/${actionId}`).toBe(true);
      }
    }
    for (const [viewId, actions] of Object.entries(SCREEN_NO_PROMPT)) {
      for (const actionId of actions) {
        expect(seen.has(`${viewId}/${actionId}`), `${viewId}/${actionId}`).toBe(true);
      }
    }
  });

  it("finds the four prompting sites, and the control that is not one", () => {
    /* Verified by following each host's `invoke` into what it calls; the
     * citations are in `SCREEN_PROMPTS`' own comment. `sort-exp` is the control:
     * it goes through `invoke`, does real work, and never touches the terminal. */
    const found = Object.entries(SCREEN_PROMPTS).flatMap(([viewId, actions]) =>
      Object.entries(actions).map(([actionId, fact]) => `${viewId}/${actionId} ${fact.promptId} ${fact.extent}`),
    );
    expect(found.sort()).toEqual([
      "core:character-flags/file charsheet:file line",
      "core:character-flags/rename charsheet:rename screen",
      "core:character/file charsheet:file line",
      "core:character/rename charsheet:rename screen",
      "core:report/describe report:describe line",
      "core:update/mods update:mods screen",
    ]);
    expect(screenPromptFor("core:monster-list", "sort-exp")).toBeUndefined();
    expect(SCREEN_NO_PROMPT["core:monster-list"]).toEqual(["sort-exp"]);
  });

  it("reads one prompt at a time through screenPromptFor, nesting and all", () => {
    expect(screenPromptFor("core:character", "rename")).toEqual({
      promptId: "charsheet:rename",
      extent: "screen",
    });
    expect(screenPromptFor("core:character", "page-next")).toBeUndefined();
    expect(screenPromptFor("core:inventory", "rename")).toBeUndefined();
  });

  it("is the WHOLE census: no other module publishes a screen's actions", () => {
    /*
     * The tripwire that makes a fifth site a build failure rather than a bug
     * report. A new ACTION on a screen the corpus above already builds is caught
     * by totality; a whole new SCREEN with actions, in a file nobody thought to
     * add to the corpus, would not be - and that is exactly how `core:update`
     * and `core:report` arrived. So: whoever publishes `actions:` on a view is
     * pinned here, and growing that set means growing `viewsWithActions()` in
     * the same commit.
     *
     * `screen-view.ts` is in the list and is not a producer: it is `freezeView`,
     * which copies whatever a producer gave it.
     */
    const dir = new URL("./", import.meta.url);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => /(^|[{,(]\s*|\n\s+)actions:\s*\S/u.test(readFileSync(new URL(f, dir), "utf8")));
    expect(files.sort()).toEqual(["charsheet.ts", "screen-view.ts", "screens.ts"]);
  });
});
