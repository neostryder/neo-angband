/**
 * The shim: an API 1 plugin runs unchanged, and an API 2 definition runs
 * through the same loader path as an API 1 plugin.
 */
import { describe, expect, it } from "vitest";
import {
  composeModHooks,
  guardModHooks,
  type HistoryAddEntry,
  type ModHooks,
  type ModPluginContext,
  type ModRegistryHost,
} from "@rpgm-tools/neo-angband-core";
import {
  API2_HOOK_NAMES,
  CapabilitySet,
  defineApi2Mod,
  isNotGranted,
  type ModApi2,
} from "@rpgm-tools/neo-angband-mod-sdk";
import { API1_CONTEXT_MAP, api2Plugin, api2ToModHooks, checkApi2Definition } from "./mod-api2-shim";
import { modPluginContext } from "./mod-context";
import { defineModPlugin, validateModPlugin, type ModPlugin } from "./mod-plugin";

function capabilities(id: string, granted: string[]): CapabilitySet {
  return CapabilitySet.fromManifest({
    id, name: id, version: "1.0.0", shape: "plugin", facets: ["plugin"], modApi: 1, capabilities: granted,
  });
}

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
    expect(checkApi2Definition({ api: ">=2.0.0 <3.0.0" })).toMatch(/hooks, start/);
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
