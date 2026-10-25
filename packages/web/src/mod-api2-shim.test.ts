/**
 * The shim: an API 1 plugin runs unchanged, and an API 2 definition runs
 * through the same loader path as an API 1 plugin.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeModHooks,
  guardModHooks,
  OptionState,
  Rng,
  StoreBehaviourRegistry,
  ObjRegistry,
  TV,
  bindConstants,
  massProduce,
  objectPrep,
  objectValueReal,
  registerCoreStoreBehaviour,
  resetTvalRegistry,
  tvalRegistry,
  type ObjPackJson,
  type HistoryAddEntry,
  type GameState,
  type ModHooks,
  type ModPluginContext,
  type ModRegistryHost,
} from "@rpgm-tools/neo-angband-core";
import {
  API2_HOOK_NAMES,
  API2_POLICY_KINDS,
  CapabilitySet,
  defineApi2Mod,
  isNotGranted,
  type ModApi2,
  type Api2Policies,
} from "@rpgm-tools/neo-angband-mod-sdk";
import {
  API1_CONTEXT_MAP,
  api2Plugin,
  api2PluginRegistrations,
  api2PolicyModHooks,
  api2DisplayOption,
  api2ToModHooks,
  checkApi2Definition,
  installApi2PolicyRegistrations,
  removeApi2PolicyRegistrations,
  mergePolicies,
} from "./mod-api2-shim";
import { modPluginContext } from "./mod-context";
import { defineModPlugin, validateModPlugin, type ModPlugin } from "./mod-plugin";

afterEach(() => resetTvalRegistry());

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8")) as T;
}

const pricingRegistry = new ObjRegistry({
  objectBase: loadJson("object_base"), object: loadJson("object"),
  egoItem: loadJson("ego_item"), artifact: loadJson("artifact"),
  curse: loadJson("curse"), brand: loadJson("brand"), slay: loadJson("slay"),
  activation: loadJson("activation"), objectProperty: loadJson("object_property"), flavor: loadJson("flavor"),
} as ObjPackJson);
const pricingConstants = bindConstants(loadJson("constants"));

function armor(name: string, toA = 0) {
  const kind = pricingRegistry.kinds.find((candidate) => candidate.name === name);
  if (!kind) throw new Error(`no armor kind named ${name}`);
  const obj = objectPrep(new Rng(1), pricingRegistry, pricingConstants, kind, 0, "minimise");
  obj.toA = toA;
  return obj;
}

function capabilities(id: string, granted: string[]): CapabilitySet {
  return CapabilitySet.fromManifest({
    id, name: id, version: "1.0.0", shape: "plugin", facets: ["plugin"], modApi: 1, capabilities: granted,
  });
}

describe("starting-options policy", () => {
  it("applies through OptionState setters on a new character and skips birth options", () => {
    const options = new OptionState();
    const hooks = api2PolicyModHooks({ startingOptions: {
      kind: "starting-options",
      values: { birth_no_selling: true, cheat_live: true, auto_more: true },
      hitpointWarn: 7,
      delayFactor: 9,
      lazymoveDelay: 40,
    } }, () => true);
    hooks.newCharacter?.({ options } as GameState, {} as never);
    expect(options.get("birth_no_selling")).toBe(false);
    expect(options.get("cheat_live")).toBe(true);
    expect(options.get("score_live")).toBe(true);
    expect(options.get("auto_more")).toBe(true);
    expect(options.hitpointWarn).toBe(7);
    expect(options.delayFactor).toBe(9);
    expect(options.lazymoveDelay).toBe(40);
  });

  it("does not apply after the mod stops", () => {
    const options = new OptionState();
    const hooks = api2PolicyModHooks({ startingOptions: { kind: "starting-options", values: { auto_more: true } } }, () => false);
    hooks.newCharacter?.({ options } as GameState, {} as never);
    expect(options.get("auto_more")).toBe(false);
  });
});

describe("projection radius clamp policy", () => {
  it("holds a radius above the maximum range at it and leaves the rest alone", () => {
    const hooks = api2PolicyModHooks({ projectionRadiusClamp: true }, () => true);
    expect(hooks.projectionRadius?.(25, 20)).toBe(20);
    expect(hooks.projectionRadius?.(20, 20)).toBe(20);
    expect(hooks.projectionRadius?.(3, 20)).toBe(3);
  });

  it("gives the radius back unchanged after the mod stops", () => {
    expect(api2PolicyModHooks({ projectionRadiusClamp: true }, () => false).projectionRadius?.(25, 20)).toBe(25);
  });

  it("installs nothing when the table is absent", () => {
    expect(api2PolicyModHooks({}, () => true).projectionRadius).toBeUndefined();
  });
});

describe("level revisit tracking policy", () => {
  function level(): { width: number; height: number; noise: Uint16Array; scent: Uint16Array } {
    return { width: 6, height: 6, noise: new Uint16Array(36), scent: new Uint16Array(36) };
  }
  const at = (x: number, y: number): number => y * 6 + x;
  const revisit = (hooks: ReturnType<typeof api2PolicyModHooks>, chunk: ReturnType<typeof level>, from: number, to: number): void =>
    hooks.levelRevisited?.(chunk as never, from, to);

  it("clears the interior noise and ages scent by the world ticks that passed", () => {
    const chunk = level();
    chunk.noise.fill(81);
    chunk.scent[at(2, 2)] = 1;
    chunk.scent[at(3, 2)] = 65534;
    revisit(api2PolicyModHooks({ levelRevisitTracking: true }, () => true), chunk, 19, 50);
    expect(chunk.noise[at(2, 2)]).toBe(0);
    expect(chunk.noise[at(0, 0)]).toBe(81);
    expect(chunk.scent[at(2, 2)]).toBe(5);
    expect(chunk.scent[at(3, 2)]).toBe(0);
    expect(chunk.scent[at(4, 2)]).toBe(0);
  });

  it("counts a tick boundary even when fewer than ten turns passed", () => {
    const chunk = level();
    chunk.scent[at(2, 2)] = 7;
    revisit(api2PolicyModHooks({ levelRevisitTracking: true }, () => true), chunk, 19, 20);
    expect(chunk.scent[at(2, 2)]).toBe(8);
  });

  it("leaves the level as it was after the mod stops", () => {
    const chunk = level();
    chunk.noise.fill(9);
    chunk.scent[at(2, 2)] = 3;
    revisit(api2PolicyModHooks({ levelRevisitTracking: true }, () => false), chunk, 0, 100);
    expect(chunk.noise[at(2, 2)]).toBe(9);
    expect(chunk.scent[at(2, 2)]).toBe(3);
  });
});

describe("ignore policy", () => {
  it("wraps the prior ignore callback with case-sensitive light rules and exemptions", () => {
    const state = { isIgnored: () => false } as unknown as GameState;
    let active = true;
    installApi2PolicyRegistrations({ ignore: [
      { tval: "light", kindNameContains: "Torch", ignore: true },
      { tval: "light", kindNameContains: "Lantern", ignore: true },
    ] }, { state, stores: null, tiles: null }, () => active);
    const check = (name: string, values: Partial<{ tval: number; artifact: unknown; note: string | null }> = {}) =>
      state.isIgnored!({ tval: TV.LIGHT, artifact: null, note: null, kind: { name }, ...values } as never);
    expect(check("& Wooden Torch~")).toBe(true);
    expect(check("& Lantern~")).toBe(true);
    expect(check("& wooden torch~")).toBe(false);
    expect(check("& Wooden Torch~", { artifact: {} })).toBe(false);
    expect(check("& Wooden Torch~", { note: "!k" })).toBe(false);
    expect(check("& Wooden Torch~", { note: "!*" })).toBe(false);
    active = false;
    expect(check("& Wooden Torch~")).toBe(false);
  });
});

describe("display-options policy", () => {
  it("uses the last active contribution and falls back after removal or stop", () => {
    let firstActive = true;
    let secondActive = true;
    const value = { kind: "display-options" as const, storeItemNameEllipsis: true, storeSelectionDescription: true, monsterListColorKey: true };
    installApi2PolicyRegistrations({ displayOptions: value }, { id: "first", stores: null, tiles: null }, () => firstActive);
    expect(api2DisplayOption("storeItemNameEllipsis", false)).toBe(true);
    installApi2PolicyRegistrations({ displayOptions: { ...value, storeItemNameEllipsis: false } }, { id: "second", stores: null, tiles: null }, () => secondActive);
    expect(api2DisplayOption("storeItemNameEllipsis", true)).toBe(false);
    secondActive = false;
    expect(api2DisplayOption("storeItemNameEllipsis", false)).toBe(true);
    removeApi2PolicyRegistrations("first");
    firstActive = false;
    expect(api2DisplayOption("storeItemNameEllipsis", false)).toBe(false);
    removeApi2PolicyRegistrations("second");
  });
});

describe("purge-input policy", () => {
  it("consumes fresh unmodified presses and sends the declared Escape count", () => {
    let listener: ((event: KeyboardEvent) => void) | undefined;
    const cancel = vi.fn();
    installApi2PolicyRegistrations({ purgeInput: { kind: "purge-input", trigger: "F2", modifiers: [], freshOnly: true, escapeCount: 3 } }, {
      id: "purger", stores: null, tiles: null,
      purgeInput: {
        display: { onKey: (callback) => { listener = callback; return () => { listener = undefined; }; } },
        isBindableTriggerKey: () => true,
        keyRepeat: () => ({ isRepeat: false }),
        cancelInput: cancel,
      },
    }, () => true);
    let prevented = false;
    let stopped = false;
    listener?.({ key: "F2", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
      preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } } as KeyboardEvent);
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
    expect(cancel).toHaveBeenCalledWith(3);
    removeApi2PolicyRegistrations("purger");
    expect(listener).toBeUndefined();
  });

  it("consumes but does not repeat a held key", () => {
    let listener: ((event: KeyboardEvent) => void) | undefined;
    const cancel = vi.fn();
    installApi2PolicyRegistrations({ purgeInput: { kind: "purge-input", trigger: "F2", modifiers: [], freshOnly: true, escapeCount: 3 } }, {
      id: "repeat-purger", stores: null, tiles: null,
      purgeInput: { display: { onKey: (callback) => { listener = callback; return () => undefined; } }, isBindableTriggerKey: () => true,
        keyRepeat: () => ({ isRepeat: true }), cancelInput: cancel },
    }, () => true);
    listener?.({ key: "F2", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
      preventDefault: () => undefined, stopImmediatePropagation: () => undefined } as KeyboardEvent);
    expect(cancel).not.toHaveBeenCalled();
    removeApi2PolicyRegistrations("repeat-purger");
  });
});

/* What the loader does with one plugin: validate, ask for hooks, guard, fold, register. */
function load(id: string, plugin: ModPlugin, granted: string[] = []): { hooks: ModHooks | undefined; ctx: ModPluginContext } {
  expect(validateModPlugin(plugin)).toBeNull();
  const caps = capabilities(id, granted);
  const hookCtx = modPluginContext(id, { loud: true }, undefined, {}, { capabilities: caps });
  const contributed = plugin.hooks?.(hookCtx);
  const hooks = composeModHooks(contributed ? [guardModHooks(contributed, () => undefined)] : []);
  const ctx = modPluginContext(id, { loud: true }, undefined, {}, { capabilities: caps });
  plugin.register?.({} as ModRegistryHost, ctx);
  return { hooks, ctx };
}

describe("an API 1 plugin", () => {
  it("still loads, hooks and registers with the API 1 context", () => {
    let seen: ModPluginContext | undefined;
    const legacy = defineModPlugin({
      api: 1,
      hooks: (ctx) => ({ messageText: (raw) => (ctx.flags["loud"] ? raw.toUpperCase() : raw) }),
      register(_host, ctx) {
        seen = ctx;
      },
    });
    const { hooks, ctx } = load("legacy", legacy);
    expect(hooks?.messageText?.("hello")).toBe("HELLO");
    expect(seen).toBe(ctx);
    expect(seen?.api).toBe(1);
    expect(typeof seen?.assetUrl).toBe("function");
  });
});

describe("an API 2 definition through the shim", () => {
  it("offers a birth presenter each creation and lets it decline other characters", () => {
    let take = true;
    const definition = defineApi2Mod({ api: "^2.0.0", birth: (mod) => {
      expect(mod.presentation).toBeDefined();
      return { show: (session) => {
        if (!take) return undefined;
        session.accept();
        return true;
      } };
    } });
    const caps = capabilities("modern", ["ui:birth.replace"]);
    const plugin = api2Plugin(definition, () => ({ grants: caps, tier: "first-party", firstParty: { presentation: true } }));
    const ctx = modPluginContext("modern", {}, undefined, {}, { capabilities: caps });
    let accepted = 0;
    const session = { accept: () => { accepted += 1; } } as unknown as import("./birth-session").ModBirthSession;
    const presenter = plugin.birth!(ctx)!;
    expect(presenter.show(session)).toBe(true);
    take = false;
    expect(presenter.show(session)).toBeUndefined();
    expect(accepted).toBe(1);
    expect(api2Plugin(definition, () => ({ grants: caps, tier: "public" })).birth).toBeUndefined();
  });
  it("passes presenters only to the measured first-party tier", () => {
    const menu = { ask: () => undefined };
    const definition = defineApi2Mod({ api: "^2.0.0", presentation: { menu: (mod) => {
      expect(mod.presentation).toBeDefined();
      return menu;
    } } });
    expect(checkApi2Definition(definition)).toBeNull();
    const caps = capabilities("modern", []);
    const ctx = modPluginContext("modern", {}, undefined, {}, { capabilities: caps });
    const p = api2Plugin(definition, () => ({ grants: caps, tier: "first-party", firstParty: { presentation: true } }));
    expect(p.menu?.(ctx)).toBe(menu);
    const publicPlugin = api2Plugin(definition, () => ({ grants: caps, tier: "public", firstParty: { presentation: true } }));
    expect(publicPlugin.menu).toBeUndefined();
  });
  it("passes the API 1 validator, hooks through core's fold and starts with the API 2 domains", async () => {
    let started: ModApi2 | undefined;
    const definition = defineApi2Mod({
      api: ">=2.0.0 <3.0.0",
      hooks: ({ flags }) => ({ messageText: (raw) => (flags["loud"] ? `${raw}!` : raw) }),
      start(mod) {
        started = mod;
      },
    });
    expect(checkApi2Definition(definition)).toBeNull();
    const plugin = api2Plugin(definition, () => ({ grants: capabilities("modern", []) }));
    const { hooks } = load("modern", plugin);
    expect(hooks?.messageText?.("hello")).toBe("hello!");
    expect(started?.meta.id).toBe("modern");
    expect(started?.meta.api).toBe("2.0.0");
    expect(started?.hooks.active).toEqual(["messageText"]);
    expect(started?.hooks.available).toEqual(API2_HOOK_NAMES);
    expect(started?.manage).toBeUndefined();
    expect(started?.truth).toBeUndefined();
    const refused = await started!.view.player();
    expect(refused.ok).toBe(false);
  });

  it("composes with an API 1 plugin's hooks in load order", () => {
    const legacy = defineModPlugin({ api: 1, hooks: () => ({ messageText: (raw) => `[${raw}]` }) });
    const modern = api2Plugin(
      defineApi2Mod({ api: ">=2.0.0 <3.0.0", hooks: () => ({ messageText: (raw) => `${raw}?` }) }),
      () => ({ grants: capabilities("modern", []) }),
    );
    const ctx = (id: string) => modPluginContext(id, {}, undefined, {}, { capabilities: capabilities(id, []) });
    const folded = composeModHooks([legacy.hooks!(ctx("legacy"))!, modern.hooks!(ctx("modern"))!]);
    expect(folded?.messageText?.("hi")).toBe("[hi]?");
  });

  it("writes a history decision onto the shared entry, and every mod must agree to keep it", () => {
    const rewrite = api2ToModHooks({ historyAdd: (e) => ({ keep: true, what: `${e.what} (noted)` }) });
    const veto = api2ToModHooks({ historyAdd: (e) => ({ keep: !e.what.includes("noted") }) });
    const entry: HistoryAddEntry = { what: "Found the stairs", type: 1, duplicate: false };
    const folded = composeModHooks([rewrite, veto]);
    expect(folded?.historyAdd?.(entry)).toBe(false);
    expect(entry.what).toBe("Found the stairs (noted)");
  });

  it("leaves an undeclared hook absent", () => {
    expect(Object.keys(api2ToModHooks({}))).toEqual([]);
    expect(Object.keys(api2ToModHooks({ saveNoiseScent: () => true }))).toEqual(["saveNoiseScent"]);
  });

  it("refuses a definition for an API it cannot run", () => {
    expect(checkApi2Definition({ api: ">=3.0.0 <4.0.0", start() {} })).toMatch(/newer|3/);
    expect(checkApi2Definition({ api: 2, start() {} })).toMatch(/string/);
    expect(checkApi2Definition({ api: ">=2.0.0 <3.0.0" })).toMatch(/hooks, policies, start/);
    expect(checkApi2Definition({ api: ">=2.0.0 <3.0.0", start() {}, prefs: { version: 0, migrate: () => null } })).toMatch(/prefs.version/);
  });

  it("logs a start that rejects instead of throwing into the loader", async () => {
    const plugin = api2Plugin(
      defineApi2Mod({ api: ">=2.0.0 <3.0.0", start: () => Promise.reject(new Error("boom")) }),
      () => ({ grants: capabilities("failing", []) }),
    );
    const lines: string[] = [];
    const ctx = modPluginContext("failing", {}, undefined, {}, { capabilities: capabilities("failing", []) });
    plugin.register!({} as ModRegistryHost, { ...ctx, log: (m: string) => lines.push(m) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lines).toEqual(["start failed: boom"]);
  });

  it("installs an in-process mod's policy tables, with a hook function taking precedence", () => {
    const plugin = api2Plugin(
      defineApi2Mod({
        api: ">=2.0.0 <3.0.0",
        policies: () => ({
          messageText: [{ find: "a", replace: "b" }],
          characterBackground: [{ find: "x", replace: "y", match: "substring" }],
        }),
        hooks: () => ({ messageText: (raw) => `${raw}!` }),
      }),
      () => ({ grants: capabilities("tables", ["registry:message"]) }),
    );
    const { hooks } = load("tables", plugin);
    expect(hooks?.messageText?.("a")).toBe("a!");
    expect(hooks?.characterBackground?.("xox")).toBe("yoy");
  });

  it("refuses invalid policy tables when the hooks are asked for", () => {
    expect(() => mergePolicies({ messageText: [{ find: "a" }] }, undefined)).toThrow(/policies are not valid/);
    expect(mergePolicies(undefined, undefined)).toBeUndefined();
  });

  it("answers not-granted through the shim when the grant is missing", async () => {
    let started: ModApi2 | undefined;
    const plugin = api2Plugin(
      defineApi2Mod({ api: ">=2.0.0 <3.0.0", start: (mod) => { started = mod; } }),
      () => ({ grants: capabilities("quiet", []) }),
    );
    load("quiet", plugin);
    const r = await started!.act.answer(1, true);
    expect(isNotGranted(r) && r.capability).toBe("input:prompt.reply");
  });
});

describe("the API 1 context map", () => {
  it("names a home or a reason for every API 1 member", () => {
    const ctx = modPluginContext("probe", {}, undefined, {}, {});
    for (const key of Object.keys(ctx)) {
      expect(API1_CONTEXT_MAP, key).toHaveProperty(key);
    }
    for (const value of Object.values(API1_CONTEXT_MAP)) expect(value.length).toBeGreaterThan(0);
  });
});

describe("policy tables that install registrations", () => {
  it("does not evaluate a throwing policy factory again during registration", () => {
    let calls = 0;
    const plugin = api2Plugin({ api: "^2.0.0", policies: () => { calls += 1; throw new Error("broken table"); } },
      () => ({ grants: capabilities("tables", ["registry:store"]) }));
    expect(() => load("tables", plugin)).toThrow("broken table");
    expect(() => api2PluginRegistrations(plugin, "tables", {})).not.toThrow();
    expect(api2PluginRegistrations(plugin, "tables", {})).toBeUndefined();
    expect(calls).toBe(1);
  });

  it("reuses the policies evaluated for hooks when installing registrations", () => {
    let calls = 0;
    const plugin = api2Plugin({ api: "^2.0.0", policies: () => {
      calls += 1;
      return { storeDiscountRoll: { tiers: [{ oneIn: 1, percent: calls }] } };
    } }, () => ({ grants: capabilities("tables", ["registry:store"]) }));
    load("tables", plugin);
    expect(api2PluginRegistrations(plugin, "tables", { loud: true })?.discountRoll?.({ cost: 5, oneIn: () => true })).toBe(1);
    expect(calls).toBe(1);
  });

  const tables: Api2Policies = {
    prefErrors: { kind: "pref-errors", continueAfterError: true, reportLimit: 20 },
    startingOptions: { kind: "starting-options", values: { auto_more: true } },
    ignore: [{ tval: "light", kindNameContains: "Torch", ignore: true }],
    displayOptions: { kind: "display-options", storeItemNameEllipsis: true, storeSelectionDescription: true, monsterListColorKey: true },
    purgeInput: { kind: "purge-input", trigger: "F2", modifiers: [], freshOnly: true, escapeCount: 3 },
    walkBlockedByDiggable: { kind: "walk-blocked-by-diggable", attempt: "tunnel", energy: "move", step: false },
    messageText: [{ find: "a", replace: "b" }], screenText: [{ find: "a", replace: "b" }],
    characterBackground: [{ find: "a", replace: "b" }], objectInfoText: [{ find: "a", replace: "b" }],
    effectIntro: [{ find: "a", replace: "b" }], historyAdd: [{ find: "a", replace: "b" }],
    historyDisplay: [{ find: "a", replace: "b" }], objectListOrder: ["dy"], saveNoiseScent: true,
    shapeLearnObviousFlagsDirectly: true, storeDiscountRoll: { tiers: [{ oneIn: 1, percent: 20 }] },
    tileMap: [{ monster: 2, like: 1 }], projectionRadiusClamp: true, levelRevisitTracking: true,
    valueFloor: { kind: "valueFloor", tvals: [10, 11], appliesTo: "egoOrPositiveToA", comparison: "cheapestPlainSameTvalWithStrictlyGreaterAc", price: "objectValueReal" },
  };

  it.each(Object.keys(tables))("requires a registry grant for the in-process %s policy", (name) => {
    const plugin = api2Plugin({ api: "^2.0.0", policies: () => ({ [name]: tables[name as keyof Api2Policies] }) },
      () => ({ grants: capabilities("tables", []) }));
    expect(Object.keys(load("tables", plugin).hooks ?? {})).toEqual([]);
    expect(api2PluginRegistrations(plugin, "tables", {})).toBeUndefined();
  });

  it.each(API2_POLICY_KINDS)("installs the in-process $name policy under its matching registry grant", ({ name, capability, target }) => {
    const plugin = api2Plugin({ api: "^2.0.0", policies: () => ({ [name]: tables[name] }) },
      () => ({ grants: capabilities("tables", [capability]) }));
    const hooks = load("tables", plugin).hooks;
    const registrations = api2PluginRegistrations(plugin, "tables", { loud: true });
    const policyHook: Partial<Record<string, string>> = { walkBlockedByDiggable: "walkBlockedByDiggable", startingOptions: "newCharacter", projectionRadiusClamp: "projectionRadius", levelRevisitTracking: "levelRevisited" };
    expect(Object.keys(hooks ?? {})).toEqual("hook" in target ? [target.hook] : policyHook[name] ? [policyHook[name]] : []);
    expect(Object.keys(registrations ?? {})).toEqual("registration" in target ? [target.registration] : []);
    plugin.uninstall?.();
  });

  it("keeps granted policy tables when another registry permission is refused", () => {
    const plugin = api2Plugin({ api: "^2.0.0", policies: () => tables },
      () => ({ grants: capabilities("tables", ["registry:store"]) }));
    expect(Object.keys(load("tables", plugin).hooks ?? {})).toEqual([]);
    expect(Object.keys(api2PluginRegistrations(plugin, "tables", { loud: true }) ?? {})).toEqual(["discountRoll"]);
  });

  const definition = defineApi2Mod({
    api: "^2.0.0",
    policies: () => ({
      messageText: [{ find: "a", replace: "b" }],
      storeDiscountRoll: { tiers: [{ oneIn: 2, percent: 30 }, { oneIn: 3, percent: 60 }] },
      tileMap: [{ monster: 5, like: 1 }],
    }),
  });

  it("reads an in-process API 2 mod's registrations from its tables, and none from an API 1 plugin", () => {
    const plugin = api2Plugin(definition, () => ({ grants: capabilities("tables", ["registry:store", "registry:tiles"]) }));
    plugin.hooks?.(modPluginContext("tables", {}, undefined, {}, {}));
    expect(Object.keys(api2PluginRegistrations(plugin, "tables", {}) ?? {}).sort()).toEqual(["discountRoll", "tileFiller"]);
    expect(api2PluginRegistrations(defineModPlugin({ api: 1 }), "old", {})).toBeUndefined();
  });

  it("installs the discount roll on the game's stores, drawing from the game's own random stream", () => {
    const plugin = api2Plugin(definition, () => ({ grants: capabilities("tables", ["registry:store", "registry:tiles"]) }));
    plugin.hooks?.(modPluginContext("tables", {}, undefined, {}, {}));
    const stores = new StoreBehaviourRegistry();
    installApi2PolicyRegistrations(api2PluginRegistrations(plugin, "tables", {}) ?? {}, { stores, tiles: null }, () => true);
    const rng = new Rng(42);
    const twin = new Rng(42);
    const expected = Array.from({ length: 20 }, () => (twin.oneIn(2) ? 30 : twin.oneIn(3) ? 60 : 0));
    const handler = stores.discountRollHandler();
    expect(Array.from({ length: 20 }, () => handler?.({ rng, cost: 100 }))).toEqual(expected);
  });

  it("answers as if nothing were installed once the mod is no longer active", () => {
    const plugin = api2Plugin(definition, () => ({ grants: capabilities("tables", ["registry:store", "registry:tiles"]) }));
    plugin.hooks?.(modPluginContext("tables", {}, undefined, {}, {}));
    const stores = new StoreBehaviourRegistry();
    let filled = 0;
    const tiles = { register: (filler: (fill: never) => void) => { filler({ pack: { id: "p" }, monsterTile: () => (filled += 1, "t"), fillMonster: () => true } as never); } };
    installApi2PolicyRegistrations(api2PluginRegistrations(plugin, "tables", {}) ?? {}, { stores, tiles }, () => false);
    const rng = new Rng(7);
    const before = JSON.stringify(rng.getState());
    expect(stores.discountRollHandler()?.({ rng, cost: 100 })).toBe(0);
    expect(JSON.stringify(rng.getState())).toBe(before);
    expect(filled).toBe(0);
  });

  const floor: Api2Policies = {
    valueFloor: { kind: "valueFloor", tvals: [10, 11, 12, 13, 14, 15, 16, 17, 18], appliesTo: "egoOrPositiveToA", comparison: "cheapestPlainSameTvalWithStrictlyGreaterAc", price: "objectValueReal" },
  };

  function installFloor() {
    const plugin = api2Plugin({ api: "^2.0.0", policies: () => floor }, () => ({ grants: capabilities("floor", ["registry:tval"]) }));
    load("floor", plugin);
    const registrations = api2PluginRegistrations(plugin, "floor", { loud: true })!;
    installApi2PolicyRegistrations(registrations, { stores: null, tiles: null, valueAdjust: tvalRegistry().valueAdjust },
      () => api2PluginRegistrations(plugin, "floor", { loud: true }) === registrations);
    return plugin;
  }

  it.each([
    ["Studded Leather Armour~", 2, 1, 266, 336],
    ["Studded Leather Armour~", 2, 3, 798, 1008],
    ["Hard Leather Armour~", 1, 1, 374, 546],
    ["Hard Leather Armour~", 3, 1, 546, 546],
  ] as const)("matches Bug Fixes' real price for %s +%i, quantity %i", (name, toA, qty, faithful, fixed) => {
    const obj = armor(name, toA);
    const before = JSON.stringify(obj);
    expect(objectValueReal(pricingRegistry, obj, qty)).toBe(faithful);
    const plugin = installFloor();
    expect(objectValueReal(pricingRegistry, obj, qty)).toBe(fixed);
    expect(JSON.stringify(obj)).toBe(before);
    plugin.uninstall?.();
    expect(objectValueReal(pricingRegistry, obj, qty)).toBe(faithful);
  });

  it.each([
    ["Studded Leather Armour~", 0], ["Studded Leather Armour~", -3], ["Adamantite Plate Mail~", 5],
  ] as const)("keeps the live route's no-op for %s +%i", (name, toA) => {
    const obj = armor(name, toA);
    const faithful = objectValueReal(pricingRegistry, obj, 1);
    installFloor();
    expect(objectValueReal(pricingRegistry, obj, 1)).toBe(faithful);
  });

  it("applies the floor to an ego without positive toA and leaves other classes alone", () => {
    const obj = armor("Studded Leather Armour~");
    obj.ego = pricingRegistry.egos[0]!;
    const swordKind = pricingRegistry.kinds.find((kind) => kind.tval === TV.SWORD)!;
    const sword = objectPrep(new Rng(1), pricingRegistry, pricingConstants, swordKind, 0, "minimise");
    sword.toA = 2;
    const faithful = objectValueReal(pricingRegistry, sword, 1);
    installFloor();
    expect(objectValueReal(pricingRegistry, obj, 1)).toBe(336);
    expect(objectValueReal(pricingRegistry, sword, 1)).toBe(faithful);
    expect(tvalRegistry().valueAdjust.has(TV.SWORD)).toBe(false);
  });

  it("uses the last contribution and restores preceding handlers on stop", () => {
    const obj = armor("Studded Leather Armour~", 2);
    tvalRegistry().valueAdjust.set(obj.tval, () => 1234);
    const first = installFloor();
    expect(objectValueReal(pricingRegistry, obj, 1)).toBe(336);
    const second = installFloor();
    first.uninstall?.();
    expect(objectValueReal(pricingRegistry, obj, 1)).toBe(336);
    second.uninstall?.();
    expect(objectValueReal(pricingRegistry, obj, 1)).toBe(1234);
  });

  const discounts: Api2Policies = {
    storeDiscountRoll: { minCost: 5, tiers: [{ oneIn: 25, percent: 10 }, { oneIn: 50, percent: 25 }, { oneIn: 150, percent: 50 }, { oneIn: 300, percent: 75 }, { oneIn: 500, percent: 90 }] },
  };

  function classicDiscount(rng: Rng, cost: number): number {
    if (cost < 5) return 0;
    if (rng.oneIn(25)) return 10;
    if (rng.oneIn(50)) return 25;
    if (rng.oneIn(150)) return 50;
    if (rng.oneIn(300)) return 75;
    if (rng.oneIn(500)) return 90;
    return 0;
  }

  it("matches Cutting Room Floor's stocking, stack size and game RNG", () => {
    const plugin = api2Plugin({ api: "^2.0.0", policies: () => discounts }, () => ({ grants: capabilities("discounts", ["registry:store"]) }));
    load("discounts", plugin);
    const registrations = api2PluginRegistrations(plugin, "discounts", { loud: true })!;
    const declared = new StoreBehaviourRegistry();
    const live = new StoreBehaviourRegistry();
    registerCoreStoreBehaviour(declared);
    registerCoreStoreBehaviour(live);
    installApi2PolicyRegistrations(registrations, { stores: declared, tiles: null }, () => true);
    live.registerDiscountRoll(({ rng, cost }) => classicDiscount(rng, cost));
    const kind = pricingRegistry.kinds.find((candidate) => candidate.tval === TV.POTION && candidate.cost >= 5)!;
    for (let seed = 1; seed <= 256; seed += 1) {
      const original = objectPrep(new Rng(1), pricingRegistry, pricingConstants, kind, 0, "minimise");
      for (const cost of [4, kind.cost]) {
        const left = { ...original, kind: { ...kind, cost } };
        const right = { ...original, kind: { ...kind, cost } };
        const rng = new Rng(seed);
        const twin = new Rng(seed);
        massProduce(pricingRegistry, rng, left, declared);
        massProduce(pricingRegistry, twin, right, live);
        expect([left.discount, left.number]).toEqual([right.discount, right.number]);
        expect(rng.getState()).toEqual(twin.getState());
      }
    }
  });

  it("restores the preceding discount declaration without drawing after both stop", () => {
    const stores = new StoreBehaviourRegistry();
    let firstActive = true;
    let secondActive = true;
    const rng = new Rng(42);
    const before = rng.getState();
    installApi2PolicyRegistrations({ discountRoll: () => 10 }, { stores, tiles: null }, () => firstActive);
    installApi2PolicyRegistrations({ discountRoll: () => 90 }, { stores, tiles: null }, () => secondActive);
    expect(stores.discountRollHandler()?.({ rng, cost: 100 })).toBe(90);
    secondActive = false;
    expect(stores.discountRollHandler()?.({ rng, cost: 100 })).toBe(10);
    firstActive = false;
    expect(stores.discountRollHandler()?.({ rng, cost: 100 })).toBe(0);
    expect(rng.getState()).toEqual(before);
  });
});
