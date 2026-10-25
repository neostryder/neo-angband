import { describe, expect, it } from "vitest";
import type { JsonValue } from "../compose.js";
import type {
  Api2Act,
  Api2Content,
  Api2Credentials,
  Api2Events,
  Api2Manage,
  Api2Meta,
  Api2Net,
  Api2Truth,
  Api2Ui,
  Api2View,
  ModApi2,
} from "./domains.js";
import type { Api2EventMap } from "./events.js";
import type { Api2Hooks } from "./hooks.js";
import type { Api2Call } from "./result.js";
import {
  API2_EVENT_NAMES,
  api2EventCapability,
  API2_HOOK_NAMES,
  api2NotGranted,
  api2Ok,
  api2Refused,
  api2Unavailable,
  apiRangeVerdict,
  defineApi2Mod,
  isNotGranted,
  MOD_API2_DEFAULT_RANGE,
  MOD_API2_VERSION,
} from "./index.js";

/* Plain data: no functions anywhere inside, so structured clone keeps all of it.
 * JSON values are plain by their definition, which also stops the recursion. */
type IsPlain<T> = [T] extends [JsonValue]
  ? true
  : T extends (...args: never[]) => unknown
  ? false
  : T extends readonly (infer U)[]
    ? IsPlain<U>
    : T extends object
      ? { [K in keyof T]-?: IsPlain<T[K]> }[keyof T] extends true
        ? true
        : false
      : true;

/* Every value a domain's calls resolve to, gathered into one union. */
type Resolved<D> = {
  [K in keyof D]-?: D[K] extends (...args: never[]) => Api2Call<infer R>
    ? R
    : D[K] extends (...args: never[]) => unknown
      ? never
      : D[K] extends object
        ? Resolved<D[K]>
        : never;
}[keyof D];

type AllPlain<D> = IsPlain<Resolved<D>> extends true ? true : false;

/* Each entry must be `true`; a call that resolved to something holding a function would fail to compile. */
const plainResults: Record<string, true> = {
  meta: true satisfies AllPlain<Api2Meta>,
  view: true satisfies AllPlain<Api2View>,
  act: true satisfies AllPlain<Api2Act>,
  events: true satisfies AllPlain<Api2Events>,
  content: true satisfies AllPlain<Api2Content>,
  ui: true satisfies AllPlain<Api2Ui>,
  net: true satisfies AllPlain<Api2Net>,
  credentials: true satisfies AllPlain<Api2Credentials>,
  manage: true satisfies AllPlain<Omit<Api2Manage, "authoring" | "wizard">>,
  truth: true satisfies AllPlain<Api2Truth>,
  eventPayloads: true satisfies IsPlain<Api2EventMap[keyof Api2EventMap]>,
  hookArguments: true satisfies IsPlain<Parameters<NonNullable<Api2Hooks[keyof Api2Hooks]>>[number]>,
  /* The checker itself: a function is caught, and a domain's results are really gathered. */
  catchesFunctions: true satisfies (IsPlain<{ a: { b: () => void } }> extends false ? true : false),
  catchesDomains: true satisfies (AllPlain<{ f(): Api2Call<{ g: () => void }> }> extends false ? true : false),
  gathersResults: true satisfies ([Resolved<Api2View>] extends [never] ? false : true),
};

describe("API 2 boundary values", () => {
  it("are plain data at the type level", () => {
    expect(Object.values(plainResults).every((v) => v)).toBe(true);
  });

  it("keeps the first-party seams optional on the API", () => {
    const optional: true = true satisfies (undefined extends ModApi2["manage"] ? true : false);
    const truth: true = true satisfies (undefined extends ModApi2["truth"] ? true : false);
    expect(optional && truth).toBe(true);
  });

  it("tracks the first-party management namespace", () => {
    const names: Record<keyof Api2Manage, true> = { profiles: true, session: true, saves: true, options: true, keys: true, look: true, mods: true, authoring: true, wizard: true, loadForSession: true, reloadGame: true };
    expect(Object.keys(names).sort()).toEqual(["authoring", "keys", "loadForSession", "look", "mods", "options", "profiles", "reloadGame", "saves", "session", "wizard"]);
  });
});

describe("apiRangeVerdict", () => {
  it("admits the default range and the host version", () => {
    expect(MOD_API2_VERSION).toBe("2.0.0");
    expect(apiRangeVerdict(MOD_API2_DEFAULT_RANGE)).toEqual({ ok: true });
    expect(apiRangeVerdict("^2.0.0")).toEqual({ ok: true });
    expect(apiRangeVerdict(">=2.0.0 <3.0.0", "2.4.1")).toEqual({ ok: true });
  });

  it("says which side needs updating", () => {
    expect(apiRangeVerdict(">=3.0.0 <4.0.0")).toMatchObject({ ok: false, code: "too-new" });
    expect(apiRangeVerdict("^1.0.0")).toMatchObject({ ok: false, code: "too-old" });
    expect(apiRangeVerdict(">=1.0.0 <2.0.0")).toMatchObject({ ok: false, code: "too-old" });
    expect(apiRangeVerdict(">=1.0.0 <2.1.0", "2.2.0")).toMatchObject({ ok: false, code: "outside" });
    expect(apiRangeVerdict(">=2.1.0 <3.0.0")).toMatchObject({ ok: false, code: "outside" });
    expect(apiRangeVerdict(">=2.1.0 <3.0.0", "2.1.0")).toEqual({ ok: true });
  });

  it("calls a missing or broken range malformed instead of throwing", () => {
    expect(apiRangeVerdict("")).toMatchObject({ ok: false, code: "malformed" });
    expect(apiRangeVerdict("two point oh")).toMatchObject({ ok: false, code: "malformed" });
    expect(apiRangeVerdict(2 as unknown as string)).toMatchObject({ ok: false, code: "malformed" });
  });
});

describe("API 2 results", () => {
  it("are frozen plain data that survive structured clone", () => {
    for (const r of [api2Ok({ a: 1 }), api2NotGranted("state:monsters.read"), api2Unavailable("no game"), api2Refused("rejected", "no")]) {
      expect(Object.isFrozen(r)).toBe(true);
      expect(structuredClone(r)).toEqual(r);
    }
  });

  it("name the refused permission", () => {
    const r = api2NotGranted("input:intent");
    expect(isNotGranted(r)).toBe(true);
    expect(r).toMatchObject({ ok: false, reason: "not-granted", capability: "input:intent" });
    expect(isNotGranted(api2Refused("stale", "the wait moved on"))).toBe(false);
  });
});

describe("API 2 names", () => {
  it("gate each event on its own permission", () => {
    expect(API2_EVENT_NAMES).toContain("combat-outcome");
    expect(API2_EVENT_NAMES).toContain("bolt");
    expect(API2_EVENT_NAMES).toContain("explosion");
    expect(api2EventCapability("message")).toBe("event:message");
    expect(new Set(API2_EVENT_NAMES).size).toBe(API2_EVENT_NAMES.length);
  });

  it("leave out the hooks that fire for things the player cannot see", () => {
    const names: readonly string[] = API2_HOOK_NAMES;
    expect(names).not.toContain("projectionRadius");
    expect(names).not.toContain("artifactCommit");
    expect(Object.isFrozen(API2_HOOK_NAMES)).toBe(true);
  });

  it("returns a definition unchanged", () => {
    const def = { api: MOD_API2_DEFAULT_RANGE, start: () => undefined };
    expect(defineApi2Mod(def)).toBe(def);
  });
});
