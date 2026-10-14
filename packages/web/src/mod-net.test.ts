/**
 * `ctx.net` (#300): the browser transport against a stand-in fetch, the desktop
 * transport's hand-off to the relay, and the context wiring that decides who
 * gets `ctx.net`, `ctx.saves.create({ resumeAutoplayer })` and
 * `ctx.controller.markNondeterministic`.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import type { GameState } from "@rpgm-tools/neo-angband-core";
import { createModNet, netRelayBridge, type NetRelayBridge } from "./mod-net";
import { modPluginContext, setModDriverControl, setModNetControl } from "./mod-context";
import type { ModSaves } from "./mod-plugin";

const MAIN_TS_SOURCE = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

interface Sent {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(respond: (url: string) => Response): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      sent.push({ url, init });
      return respond(url);
    }) as typeof fetch,
  };
}

const caps = (...capabilities: string[]) => CapabilitySet.fromManifest({
  id: "squire", name: "Squire", version: "1.0.0", shape: "plugin", modApi: 1, capabilities,
});

describe("ctx.net in a browser tab", () => {
  it("fetches a declared host without credentials and returns the response", async () => {
    const { fetch, sent } = fakeFetch(() => new Response("{\"a\":1}", { status: 200, headers: { "Content-Type": "application/json" } }));
    const net = createModNet({ modId: "squire", modName: "Squire", grants: ["api.example.com"], relay: null, fetch, storage: memoryStorage() });
    expect(net.transport).toBe("page");
    const r = await net.request({ url: "https://api.example.com/v1", method: "post", body: "{}", headers: { "Content-Type": "application/json" } });
    expect(r).toMatchObject({ ok: true, status: 200, body: "{\"a\":1}", headers: { "content-type": "application/json" } });
    expect(Object.isFrozen(r)).toBe(true);
    expect(sent[0]?.init).toMatchObject({ method: "POST", credentials: "omit", redirect: "manual" });
  });

  it("refuses an undeclared host, a reserved header and a GET body before fetching", async () => {
    const { fetch, sent } = fakeFetch(() => new Response(""));
    const net = createModNet({ modId: "squire", modName: "Squire", grants: ["api.example.com"], relay: null, fetch, storage: null });
    expect(await net.request({ url: "https://evil.example.com/" })).toMatchObject({ ok: false, code: "not-declared" });
    expect(await net.request({ url: "https://api.example.com/", headers: { Cookie: "x" } })).toMatchObject({ ok: false, code: "bad-request" });
    expect(await net.request({ url: "https://api.example.com/", body: "x" })).toMatchObject({ ok: false, code: "bad-request" });
    expect(await net.request({ url: "file:///etc/passwd" })).toMatchObject({ ok: false, code: "bad-request" });
    expect(sent).toHaveLength(0);
  });

  it("keeps page secrets per mod, sends them only to their hosts, and says where they are kept", async () => {
    const storage = memoryStorage();
    const { fetch, sent } = fakeFetch(() => new Response("ok"));
    const grants = ["api.example.com", "other.example.com"];
    const net = createModNet({ modId: "squire", modName: "Squire", grants, relay: null, fetch, storage });
    expect(net.secrets.storage).toBe("page");
    expect(await net.secrets.set("jev", "sk-1", { hosts: ["api.example.com"] })).toEqual({ ok: true, storage: "page" });
    expect(await net.secrets.set("jev", "sk-1", { hosts: ["evil.example.com"] })).toMatchObject({ ok: false });
    expect(await net.secrets.has("jev")).toEqual({ present: true, storage: "page" });
    const r = await net.request({ url: "https://api.example.com/", headers: { Authorization: "Bearer {secret:jev}" } });
    expect(r).toMatchObject({ ok: true, secretStorage: "page" });
    expect((sent[0]?.init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-1");
    expect(await net.request({ url: "https://other.example.com/", headers: { Authorization: "Bearer {secret:jev}" } }))
      .toMatchObject({ ok: false, code: "secret-host" });
    const other = createModNet({ modId: "other", modName: "Other", grants, relay: null, fetch, storage });
    expect(await other.secrets.has("jev")).toEqual({ present: false });
    expect(await net.secrets.fromEnv("jev", ["TYPESAFE_API_KEY"], { hosts: ["api.example.com"] })).toMatchObject({ ok: false });
    expect(await net.secrets.delete("jev")).toEqual({ ok: true });
    expect(storage.data.size).toBe(0);
  });

  it("reports a CORS refusal and a redirect as problems", async () => {
    const blocked = createModNet({
      modId: "squire", modName: "Squire", grants: ["local"], relay: null, storage: null,
      fetch: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch,
    });
    const r = await blocked.request({ url: "http://192.168.2.154:8010/v1/systemone" });
    expect(r).toMatchObject({ ok: false, code: "unreachable" });
    expect((r as { problem: string }).problem).toContain("CORS");
    const redirect = createModNet({
      modId: "squire", modName: "Squire", grants: ["local"], relay: null, storage: null,
      fetch: (async () => Object.defineProperty(new Response(null, { status: 200 }), "type", { value: "opaqueredirect" })) as typeof fetch,
    });
    expect(await redirect.request({ url: "http://localhost:8010/" })).toMatchObject({ ok: false, code: "redirect" });
  });
});

describe("ctx.net in the desktop app", () => {
  it("hands requests and secrets to the relay with the mod's id and grants", async () => {
    const calls: [string, unknown][] = [];
    const relay: NetRelayBridge = {
      net: async (op, arg) => {
        calls.push([op, arg]);
        if (op === "request") return { ok: true, status: 200, headers: {}, body: "hi", secretStorage: "os" };
        if (op === "secret-set" || op === "secret-env") return { ok: true, storage: op === "secret-set" ? "os" : "environment" };
        return { present: true, storage: "os" };
      },
    };
    const net = createModNet({ modId: "squire", modName: "Squire", grants: ["api.example.com"], relay, fetch: undefined as never, storage: null });
    expect(net.transport).toBe("relay");
    expect(await net.request({ url: "https://api.example.com/x" })).toMatchObject({ ok: true, body: "hi" });
    expect(await net.request({ url: "https://evil.example.com/x" })).toMatchObject({ ok: false, code: "not-declared" });
    expect(await net.secrets.fromEnv("jev", ["TYPESAFE_API_KEY", "JEV_API_KEY"], { hosts: ["api.example.com"] }))
      .toEqual({ ok: true, storage: "environment" });
    expect(calls.map(([op]) => op)).toEqual(["request", "secret-env"]);
    expect(calls[0]?.[1]).toMatchObject({ modId: "squire", grants: ["api.example.com"], request: { url: "https://api.example.com/x", method: "GET" } });
    expect(calls[1]?.[1]).toMatchObject({ modName: "Squire", variables: ["TYPESAFE_API_KEY", "JEV_API_KEY"] });
  });

  it("answers a garbled or failed relay call as a problem", async () => {
    const net = createModNet({
      modId: "squire", modName: "Squire", grants: ["local"], fetch: undefined as never, storage: null,
      relay: { net: async () => { throw new Error("no handler"); } },
    });
    expect(await net.request({ url: "http://localhost:1/" })).toMatchObject({ ok: false, code: "unreachable" });
    expect(await net.secrets.set("jev", "v", { hosts: ["local"] })).toMatchObject({ ok: false });
  });

  it("finds the relay only on a desktop preload", () => {
    expect(netRelayBridge({})).toBeNull();
    expect(netRelayBridge({ neoDesktop: { backup: () => undefined } })).toBeNull();
    const desktop = { net: async () => undefined };
    expect(netRelayBridge({ neoDesktop: desktop })).toBe(desktop);
  });
});

describe("the context wiring", () => {
  it("gives ctx.net only to a mod with a network grant", () => {
    setModNetControl((id, grants) => createModNet({ modId: id, modName: id, grants, relay: null, fetch: undefined as never, storage: null }));
    try {
      expect(modPluginContext("squire", {}, undefined, {}, { capabilities: caps("network:local") }).net?.transport).toBe("page");
      expect(modPluginContext("squire", {}, undefined, {}, { capabilities: caps("command:add") }).net).toBeUndefined();
    } finally {
      setModNetControl(undefined);
    }
  });

  it("passes resumeAutoplayer to the roster only when the roll-on gate agrees for this mod", async () => {
    const created: unknown[] = [];
    const saves = {
      list: async () => ({ ok: true, entries: [] }),
      load: async () => ({ ok: true }),
      rename: async () => ({ ok: true }),
      delete: async () => ({ ok: true }),
      create: async (options: unknown) => {
        created.push(options);
        return { ok: true };
      },
    } as unknown as ModSaves;
    let armed: string | null = null;
    let disarmed = 0;
    const autoplayerRollOn = {
      arm: (id: string) => id === "squire" ? ((armed = id), { ok: true as const }) : { ok: false as const, reason: "not yours" },
      disarm: () => void disarmed++,
    };
    const session = (id: string) => ({ capabilities: CapabilitySet.fromManifest({
      id, name: id, version: "1.0.0", shape: "plugin", modApi: 1, capabilities: ["saves:manage"],
    }), saves, autoplayerRollOn });
    const other = modPluginContext("other", {}, undefined, {}, session("other"));
    expect(await other.saves?.create?.({ resumeAutoplayer: true })).toEqual({ ok: false, reason: "not yours" });
    expect(created).toHaveLength(0);
    const squire = modPluginContext("squire", {}, undefined, {}, session("squire"));
    expect(await squire.saves?.create?.({ like: { race: "Human", cls: "Warrior" }, resumeAutoplayer: true })).toEqual({ ok: true });
    expect(armed).toBe("squire");
    expect(await squire.saves?.create?.({})).toEqual({ ok: true });
    expect(created).toHaveLength(2);
    expect(disarmed).toBe(0);
  });

  it("offers markNondeterministic only to the controller's owner", () => {
    const marked: string[] = [];
    setModDriverControl({
      current: () => ({ kind: "controller", owner: "squire" }),
      release: () => undefined,
      setStatus: () => undefined,
      markNondeterministic: (id) => void marked.push(id),
    });
    try {
      const state = {} as GameState;
      modPluginContext("squire", {}, state, {}, {}).controller?.markNondeterministic();
      expect(modPluginContext("other", {}, state, {}, {}).controller).toBeUndefined();
      expect(marked).toEqual(["squire"]);
    } finally {
      setModDriverControl(undefined);
    }
  });

  it("the host wires the net factory, the roll-on gate and the nondeterministic mark", () => {
    expect(MAIN_TS_SOURCE).toMatch(/setModNetControl\(\(id, grants\) => createModNet\(/);
    expect(MAIN_TS_SOURCE).toMatch(/setModAutoplayerRollOn\(\{/);
    expect(MAIN_TS_SOURCE).toMatch(/markNondeterministic: \(id\) => \{/);
    expect(MAIN_TS_SOURCE).toMatch(/if \(holder\.onDeath === "end"\) return false;/);
    expect(MAIN_TS_SOURCE).toMatch(/emitPlayerCommand\(cmd, "play"/);
  });
});
