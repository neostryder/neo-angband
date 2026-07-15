import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import { FEAT, MFLAG, OF, RF, SQUARE, TV } from "../generated";
import { bindConstants } from "../constants";
import { runGameLoop } from "../game/loop";
import { createDefaultRegistry } from "../game/player-turn";
import { addMon, makeRace, makeState, plReg } from "../game/harness";
import { ObjRegistry } from "../obj/bind";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import type { ObjPackJson } from "../obj/types";
import type { Trap } from "../game/trap";
import type { Store } from "../store/store";
import { ContentIdResolver, coreId, slug } from "../mod/ids";
import type { Curse } from "../obj/types";
import { Rng } from "../rng";
import type { AgentCapabilities } from "./types";
import { AGENT_API_VERSION } from "./types";
import { createAgentView } from "./perceive";
import { createAgentActions } from "./act";
import { AgentCapabilityError, installController } from "./controller";
import { subscribeEvents } from "./events";
import { GameEvents } from "../events";

/** A capability set granting exactly the listed capabilities. */
function grant(...caps: string[]): AgentCapabilities {
  const set = new Set(caps);
  return { has: (c) => set.has(c) };
}

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

const objReg = new ObjRegistry(objPack);
const objConstants = bindConstants(loadJson("constants"));

/** A hand-built object of the given tval, cleared of flags/mods for tests. */
function makeItem(tval: number): GameObject {
  const kind = objReg.kinds.find(
    (k) => k.tval === tval && k.kidx < objReg.ordinaryKindCount,
  );
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  const obj = objectPrep(new Rng(1), objReg, objConstants, kind, 0, "minimise");
  obj.flags.wipe();
  obj.ego = null;
  obj.artifact = null;
  obj.brands = null;
  obj.slays = null;
  obj.curses = null;
  for (let i = 0; i < obj.modifiers.length; i++) obj.modifiers[i] = 0;
  for (const e of obj.elInfo) {
    e.resLevel = 0;
    e.flags = 0;
  }
  return obj;
}

describe("perceive facade (AgentView)", () => {
  it("reports player vitals, position, and the turn from live state", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.actor.player.chp = 17;
    state.actor.player.mhp = 30;
    state.turn = 1234;
    const view = createAgentView(state);

    expect(view.apiVersion).toBe(AGENT_API_VERSION);
    const p = view.player();
    expect(p.hp).toBe(17);
    expect(p.maxHp).toBe(30);
    expect(p.grid).toEqual({ x: 10, y: 10 });
    expect(view.turn()).toBe(1234);
    expect(view.mapBounds()).toEqual({ width: 40, height: 25 });
  });

  it("lists live monsters and reads a cell's occupant", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace();
    race.name = "test-kobold";
    const mon = addMon(state, race, loc(12, 10));
    const view = createAgentView(state);

    const monsters = view.monsters();
    expect(monsters).toHaveLength(1);
    expect(monsters[0]?.race).toBe("test-kobold");
    expect(monsters[0]?.grid).toEqual({ x: 12, y: 10 });

    const cell = view.cell(12, 10);
    expect(cell?.monster).toBe(mon.midx);
    expect(cell?.passable).toBe(true);
    /* Out of bounds returns null. */
    expect(view.cell(-1, -1)).toBeNull();
  });

  it("returns fresh plain data, not live engine references", () => {
    const state = makeState();
    const view = createAgentView(state);
    const a = view.player();
    a.hp = 999;
    /* Mutating the view result must not touch the engine. */
    expect(view.player().hp).toBe(state.actor.player.chp);
    expect(state.actor.player.chp).not.toBe(999);
  });
});

describe("act facade (AgentActions)", () => {
  it("builds semantic verbs as typed commands", () => {
    const state = makeState();
    const act = createAgentActions(state);
    expect(act.move(6)).toEqual({ code: "walk", dir: 6 });
    expect(act.quaff(42)).toEqual({ code: "quaff", args: { handle: 42 } });
    expect(act.drop(42, 3)).toEqual({
      code: "drop",
      args: { handle: 42, quantity: 3 },
    });
    expect(act.cast(2)).toEqual({ code: "cast", args: { spell: 2 } });
    expect(act.descend()).toEqual({ code: "descend" });
  });

  it("sets a target by monster id through the facade", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace();
    race.name = "target-dummy";
    const mon = addMon(state, race, loc(11, 10));
    /* target_able needs the monster obvious (visible, uncamouflaged). */
    mon.mflag.on(MFLAG.VISIBLE);
    const act = createAgentActions(state);
    const view = createAgentView(state);

    expect(act.setTargetMonster(mon.midx)).toBe(true);
    expect(view.target()?.midx).toBe(mon.midx);
  });
});

describe("controller seam (the acceptance-gate end-to-end)", () => {
  it("a sample agent perceives and drives commands through the public facade", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const registry = createDefaultRegistry();

    /* A trivial agent: step east while HP is full, then yield. No privileged
     * core access - it only reads the view and emits act verbs. */
    let steps = 0;
    const startX = state.actor.grid.x;
    const session = installController(state, (view, act) => {
      if (view.player().hp <= 0 || steps >= 3) return null;
      steps++;
      return act.move(6);
    });

    runGameLoop(state, registry);

    /* The agent drove three eastward steps end-to-end via the facade. */
    expect(steps).toBe(3);
    expect(state.actor.grid.x).toBe(startX + 3);
    expect(state.turn).toBeGreaterThan(0);
    session.uninstall();
  });

  it("taps the message stream so the view reports since-last-decision", () => {
    const state = makeState();
    const prev: string[] = [];
    const originalSink = (t: string): void => {
      prev.push(t);
    };
    state.msg = originalSink;
    const session = installController(state, () => null);

    state.msg?.("you feel a chill");
    /* Perceive drains the buffer; a second read is empty. */
    expect(session.view.messages()).toEqual(["you feel a chill"]);
    expect(session.view.messages()).toEqual([]);
    /* The prior sink still received it (renderer forwarding preserved). */
    expect(prev).toEqual(["you feel a chill"]);

    session.uninstall();
    /* Uninstall restores the original sink. */
    expect(state.msg).toBe(originalSink);
  });

  it("uninstall restores the previous command provider", () => {
    const state = makeState();
    const original = state.nextCommand;
    const session = installController(state, () => ({ code: "hold" }));
    expect(state.nextCommand).not.toBe(original);
    session.uninstall();
    expect(state.nextCommand).toBe(original);
  });
});

describe("capability gating and determinism", () => {
  it("refuses to install without the required capabilities", () => {
    const state = makeState();
    expect(() =>
      installController(state, () => null, {
        capabilities: grant("state:*.read"), // missing command:add
      }),
    ).toThrow(AgentCapabilityError);
  });

  it("installs when both capabilities are granted", () => {
    const state = makeState();
    expect(() =>
      installController(state, () => null, {
        capabilities: grant("state:*.read", "command:add"),
      }),
    ).not.toThrow();
  });

  it("installs with narrow read grants (least privilege), gating reads per domain", () => {
    const state = makeState();
    // A sandboxed plugin granted command:add + only the player domain (no
    // state:*.read wildcard): install succeeds, and the perceive facade gates
    // the ungranted domain at read time rather than the install requiring all.
    const caps = grant("command:add", "state:player.read");
    let session!: ReturnType<typeof installController>;
    expect(() => {
      session = installController(state, () => null, { capabilities: caps });
    }).not.toThrow();
    expect(() => session.view.player()).not.toThrow();
    expect(() => session.view.monsters()).toThrow(AgentCapabilityError);
    session.uninstall();
  });

  it("trips the determinism ratchet hook for a nondeterministic controller", () => {
    const state = makeState();
    let flipped = 0;
    installController(state, () => null, {
      nondeterministic: true,
      onNondeterministic: () => {
        flipped++;
      },
    });
    expect(flipped).toBe(1);
  });
});

describe("flag-code mapping (guards the per-table offset)", () => {
  it("maps a known OF_* flag on an item to its expected code", () => {
    const state = makeState();
    const obj = makeItem(TV.SWORD);
    obj.flags.on(OF.SEE_INVIS);
    state.gear.pack.push(1);
    state.gear.store.set(1, obj);
    const view = createAgentView(state);
    expect(view.inventory()[0]?.flags).toContain("SEE_INVIS");
  });

  it("maps a known RF_* flag on a race to its expected code", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace({ flags: [RF.UNIQUE] });
    addMon(state, race, loc(11, 10));
    const view = createAgentView(state);
    expect(view.monsters()[0]?.raceFlags).toContain("UNIQUE");
  });
});

describe("ItemView rich fields", () => {
  it("reports flags, modifiers, ego/artifact null, and inscription round-trip", () => {
    const state = makeState();
    const obj = makeItem(TV.SWORD);
    obj.flags.on(OF.FREE_ACT);
    obj.modifiers[0] = 3; /* OBJ_MOD STR (index 0). */
    obj.note = "test-note";
    state.gear.pack.push(1);
    state.gear.store.set(1, obj);
    const view = createAgentView(state);
    const item = view.inventory()[0];

    expect(item?.flags).toContain("FREE_ACT");
    expect(item?.modifiers).toContainEqual({ code: "STR", value: 3 });
    expect(item?.ego).toBe(false);
    expect(item?.artifact).toBe(false);
    expect(item?.egoName).toBeNull();
    expect(item?.artifactName).toBeNull();
    expect(item?.inscription).toBe("test-note");
    expect(item?.activation).toBe(false);
    expect(item?.timeout).toBe(0);
    /* No deps supplied: kindId/value stay omitted. */
    expect(item?.kindId).toBeUndefined();
    expect(item?.value).toBeUndefined();
  });
});

describe("MonsterView rich fields", () => {
  it("reports level, raceFlags, and spellFlags from the race", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace({ level: 7, flags: [RF.UNIQUE, RF.MALE] });
    addMon(state, race, loc(12, 10));
    const view = createAgentView(state);
    const mon = view.monsters()[0];

    expect(mon?.level).toBe(7);
    expect(mon?.raceFlags).toEqual(expect.arrayContaining(["UNIQUE", "MALE"]));
    /* spellFlags mirrors race.spellFlags verbatim (empty for the test race). */
    expect(mon?.spellFlags).toEqual([]);
    expect(mon?.poisoned).toBe(false);
    expect(mon?.raceId).toBeUndefined();
  });
});

describe("CellView rich fields", () => {
  it("reports glow and trap as plain booleans", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(10, 10);
    const idx = grid.y * state.chunk.width + grid.x;

    const before = createAgentView(state).cell(10, 10);
    expect(before?.glow).toBe(false);
    expect(before?.trap).toBe(false);

    state.chunk.sqinfoOn(grid, SQUARE["GLOW"]);
    state.traps.set(idx, [{} as unknown as Trap]);

    const after = createAgentView(state).cell(10, 10);
    expect(after?.glow).toBe(true);
    expect(after?.trap).toBe(true);
    expect(after?.featCode).toBeUndefined();
  });
});

describe("spellbooks()", () => {
  it("yields SpellView entries with learned=false at birth for a caster class", () => {
    const state = makeState();
    const caster = plReg.classes.find((c) => c.magic.totalSpells > 0);
    if (!caster) throw new Error("no caster class in the bound pack");
    state.actor.player.cls = caster;

    const view = createAgentView(state);
    const books = view.spellbooks();

    expect(books.length).toBe(caster.magic.books.length);
    expect(books[0]?.spells.length).toBeGreaterThan(0);
    for (const book of books) {
      expect(typeof book.realm).toBe("string");
      expect(book.realm.length).toBeGreaterThan(0);
      for (const spell of book.spells) {
        expect(spell.learned).toBe(false);
        expect(spell.worked).toBe(false);
        expect(spell.forgotten).toBe(false);
      }
    }
  });
});

describe("stores()", () => {
  it("reports owner, isHome, and stock index without a registry dep", () => {
    const state = makeState();
    const obj = makeItem(TV.SWORD);
    const store: Store = {
      feat: FEAT.STORE_GENERAL,
      featName: "STORE_GENERAL",
      owners: [{ index: 0, name: "Bilbo", maxCost: 500 }],
      owner: { index: 0, name: "Bilbo", maxCost: 500 },
      alwaysTable: [],
      normalTable: [],
      buy: null,
      turnover: 0,
      normalStockMin: 0,
      normalStockMax: 0,
      stock: [obj],
      stockSize: 10,
    };
    state.stores = [store];

    const view = createAgentView(state);
    const stores = view.stores();

    expect(stores).toHaveLength(1);
    expect(stores[0]?.owner.name).toBe("Bilbo");
    expect(stores[0]?.owner.purse).toBe(500);
    expect(stores[0]?.isHome).toBe(false);
    expect(stores[0]?.stock[0]?.index).toBe(0);
    /* No registry dep: price stays omitted, but the item fields are present. */
    expect(stores[0]?.stock[0]?.price).toBeUndefined();
    expect(stores[0]?.stock[0]?.label).toBe(obj.kind.name);
  });
});

describe("constants()", () => {
  it("returns a plain clone equal to state.z", () => {
    const state = makeState();
    const view = createAgentView(state);
    expect(view.constants()).toEqual(state.z);
    expect(view.constants()).not.toBe(state.z);
  });
});

describe("pre-freeze gap closures", () => {
  it("SpellView.chance is the live adjusted fail when statInd is present", () => {
    const state = makeState();
    const caster = plReg.classes.find((c) => c.magic.totalSpells > 0);
    if (!caster) throw new Error("no caster class in the bound pack");
    state.actor.player.cls = caster;
    state.statInd = [10, 10, 10, 10, 10];

    const spell = createAgentView(state).spellbooks()[0]?.spells[0];
    expect(typeof spell?.chance).toBe("number");

    /* Without statInd the live chance is omitted (base fail still present). */
    delete state.statInd;
    const bare = createAgentView(state).spellbooks()[0]?.spells[0];
    expect(bare?.chance).toBeUndefined();
    expect(typeof bare?.fail).toBe("number");
  });

  it("exposes namespaced player race/class ids when the resolver has them", () => {
    const state = makeState();
    const resolver = new ContentIdResolver({
      objects: objReg,
      playerRaces: plReg.races,
      playerClasses: plReg.classes,
    });
    const p = createAgentView(state, undefined, { resolver }).player();
    expect(p.playerRaceId).toBe(coreId(slug(state.actor.player.race.name)));
    expect(p.playerClassId).toBe(coreId(slug(state.actor.player.cls.name)));

    /* No resolver: the ids stay omitted. */
    const bare = createAgentView(state).player();
    expect(bare.playerRaceId).toBeUndefined();
    expect(bare.playerClassId).toBeUndefined();
  });

  it("resolves curse names from the RuneEnv table, not the numeric index", () => {
    const state = makeState();
    const obj = makeItem(TV.SWORD);
    obj.curses = [
      { power: 0, timeout: 0 },
      { power: 5, timeout: 0 },
    ];
    /* Install a named curse at index 1 on the always-present RuneEnv table. */
    state.runeEnv = {
      ...state.runeEnv,
      curses: [null, { name: "teleportation" } as unknown as Curse],
    };
    state.gear.pack.push(1);
    state.gear.store.set(1, obj);

    const item = createAgentView(state).inventory()[0];
    expect(item?.curses).toEqual(["teleportation"]);
  });
});

describe("perceive: partial resolver degrades, never throws (W1.5)", () => {
  it("omits monster raceId and item kindId when the resolver lacks them", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addMon(state, makeRace(), loc(11, 10));
    // A resolver bound only to objects/player - no monster races, no kinds.
    const resolver = new ContentIdResolver({
      objects: new ObjRegistry({
        objectBase: { records: [] },
        object: { records: [] },
        egoItem: { records: [] },
        artifact: { records: [] },
        curse: { records: [] },
        brand: { records: [] },
        slay: { records: [] },
        activation: { records: [] },
        objectProperty: { records: [] },
        flavor: { records: [] },
      } as ObjPackJson),
    });
    const view = createAgentView(state, undefined, { resolver });
    // The unbound ids are simply omitted - no throw (the frozen contract).
    const mon = view.monsters().find((m) => m);
    expect(mon).toBeDefined();
    expect(mon?.raceId).toBeUndefined();
    const item = view.inventory()[0];
    if (item) expect(item.kindId).toBeUndefined();
  });
});

describe("event subscription seam (W1.6)", () => {
  it("delivers events to a granted subscriber, blocks ungranted ones", () => {
    const bus = new GameEvents();
    const sub = subscribeEvents(bus, grant("event:message"));
    let got = 0;
    sub.on("message", () => {
      got += 1;
    });
    bus.emit("message", { msg: "hi", type: 0 });
    expect(got).toBe(1);
    expect(() => sub.on("sound", () => undefined)).toThrow(AgentCapabilityError);
  });

  it("no caps is a trusted host - any event may be subscribed", () => {
    const bus = new GameEvents();
    const sub = subscribeEvents(bus);
    let got = 0;
    sub.on("sound", () => {
      got += 1;
    });
    bus.emit("sound", { msg: "", type: 3 });
    expect(got).toBe(1);
  });
});

describe("facade capability enforcement (W1.4)", () => {
  it("perceive: no caps is a trusted host - every domain is granted", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const view = createAgentView(state);
    expect(() => view.player()).not.toThrow();
    expect(() => view.monsters()).not.toThrow();
    expect(() => view.constants()).not.toThrow();
  });

  it("perceive: a narrow grant allows its domain and blocks the rest", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const view = createAgentView(state, undefined, {}, grant("state:monsters.read"));
    expect(() => view.monsters()).not.toThrow();
    expect(() => view.player()).toThrow(AgentCapabilityError);
    expect(() => view.inventory()).toThrow(AgentCapabilityError);
    expect(() => view.constants()).toThrow(AgentCapabilityError);
  });

  it("perceive: the state:*.read wildcard grants every domain", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const view = createAgentView(state, undefined, {}, grant("state:*.read"));
    expect(() => view.player()).not.toThrow();
    expect(() => view.monsters()).not.toThrow();
    expect(() => view.cell(10, 10)).not.toThrow();
    expect(() => view.inventory()).not.toThrow();
    expect(() => view.constants()).not.toThrow();
  });

  it("act: no caps is a trusted host - every verb is granted", () => {
    const state = makeState();
    const act = createAgentActions(state);
    expect(act.move(1)).toEqual({ code: "walk", dir: 1 });
    expect(act.rest()).toEqual({ code: "rest" });
  });

  it("act: command:add is required per verb when caps are supplied", () => {
    const state = makeState();
    const withAdd = createAgentActions(state, grant("command:add"));
    expect(withAdd.move(1)).toEqual({ code: "walk", dir: 1 });

    const noAdd = createAgentActions(state, grant("state:*.read"));
    expect(() => noAdd.move(1)).toThrow(AgentCapabilityError);
    expect(() => noAdd.rest()).toThrow(AgentCapabilityError);
    expect(() => noAdd.raw("hold")).toThrow(AgentCapabilityError);
  });
});
