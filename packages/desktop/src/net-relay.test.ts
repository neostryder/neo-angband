/**
 * The relay's transport maps public test names onto a loopback fixture. The
 * production transport's connection checks have separate adversarial tests.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { createDesktopAuthority, createNetRelay, type NetRelayDeps } from "./net-relay.js";

const [{ createModNet }, bindings, snapshots, store] = await Promise.all([
  "../../web/src/mod-net.ts", "../../web/src/mod-consent-binding.ts", "../../web/src/mod-code-snapshot.ts", "../../web/src/mod-store.ts",
].map((modulePath) => import(modulePath)));

interface Seen {
  path: string;
  auth: string | undefined;
  host: string | undefined;
}

let server: http.Server;
let port = 0;
let seen: Seen[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ path: req.url ?? "", auth: req.headers.authorization, host: req.headers.host });
    if (req.url === "/redirect-away") {
      res.writeHead(302, { location: "https://example.com/elsewhere" });
      res.end();
      return;
    }
    if (req.url === "/redirect-home") {
      res.writeHead(307, { location: "/hello" });
      res.end();
      return;
    }
    if (req.url === "/redirect-other-name") {
      res.writeHead(302, { location: `https://other.example.com:${port}/hello` });
      res.end();
      return;
    }
    if (req.url === "/big") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x".repeat(4 * 1024 * 1024 + 10));
      return;
    }
    res.writeHead(201, { "content-type": "application/json", "X-Custom": "yes" });
    res.end(JSON.stringify({ path: req.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
});

function relayWith(overrides: Partial<NetRelayDeps> = {}) {
  const authority = overrides.authority ?? createDesktopAuthority();
  let file: string | null = null;
  const asks: { modName: string; variables: readonly string[]; hosts: readonly string[] }[] = [];
  const relay = createNetRelay({
    authority,
    fetch: (input, init) => {
      const target = new URL(String(input));
      target.protocol = "http:";
      target.hostname = "127.0.0.1";
      return fetch(target, init);
    },
    resolveHost: async () => ["93.184.216.34"],
    env: (name) => ({ TYPESAFE_API_KEY: "env-key" } as Record<string, string>)[name],
    encryption: {
      available: () => true,
      encrypt: (value) => Buffer.from([...value].reverse().join("")).toString("base64"),
      decrypt: (encoded) => [...Buffer.from(encoded, "base64").toString()].reverse().join(""),
    },
    readStore: () => file,
    writeStore: (text) => {
      file = text;
    },
    confirmEnv: async (ask) => {
      asks.push(ask);
      return true;
    },
    ...overrides,
  });
  const handles = new Map<string, Promise<Record<string, unknown>>>();
  return { authority, rawRelay: relay, relay: {
    async handle(op: unknown, arg: unknown, owner = -1): Promise<unknown> {
      if (op === "info") return relay.handle(op, arg, owner);
      const a = arg as Record<string, unknown>;
      const slot = `${owner}:${String(a["modId"])}`;
      const previous = handles.get(slot);
      const authorization = (async () => {
        const prior = await previous;
        const hosts = (a["grants"] ?? prior?.["hosts"] ?? [here()]) as string[];
        if (prior && JSON.stringify(hosts) === JSON.stringify(prior["hosts"])) return prior;
        const destinations = [...new Set([...hosts.filter((host) => host !== "*" && host !== "local"), here(), `other.example.com:${port}`])]
          .filter((host) => hosts.includes("*") || hosts.includes(host));
        const answer = await authority.report({ modId: a["modId"], digest: "a".repeat(64), grants: hosts.map((host) => `network:${host}`),
          destinations, ...(prior ? { installation: prior["installation"] } : {}) }, owner, async () => true) as Record<string, unknown>;
        return { ...answer, hosts };
      })();
      handles.set(slot, authorization);
      const answer = await authorization;
      return relay.handle(op, { ...a, installation: answer["installation"] }, owner);
    },
  }, asks, file: () => file };
}

const here = () => `api.example.com:${port}`;
const url = (path: string) => `https://${here()}${path}`;

describe("desktop installation authority", () => {
  const decision = () => ({ modId: "squire", digest: "a".repeat(64), grants: [`network:${here()}`], destinations: [here()] });
  const allow = async () => true;

  it("carries a measured renderer caller through native consent to the relay transport and revokes it", async () => {
    const digest = vi.spyOn(snapshots, "modPayloadDigest").mockReturnValue("a".repeat(64));
    const { authority, rawRelay } = relayWith();
    const reports: unknown[] = [];
    const relay = {
      consent: async (decision: unknown) => {
        reports.push(decision);
        return authority.report(decision, 1, allow);
      },
      net: (op: unknown, arg: unknown) => rawRelay.handle(op, arg, 1),
    };
    try {
      bindings.setConsentBindings(new Map([["squire", "binding"]]));
      store.setModStorage(null);
      store.setSessionConsents({ squire: ["network:*"] });
      const net = createModNet({ modId: "squire", modName: "Squire", grants: ["*"], relay, fetch: undefined, storage: null });
      const results = await Promise.all([net.request({ url: url("/hello") }), net.request({ url: `https://other.example.com:${port}/hello` })]);
      expect(results.every((result: { ok: boolean }) => result.ok)).toBe(true);
      expect(reports).toHaveLength(2);
      expect(await net.secrets.set("key", "fixture-value", { hosts: [here()] })).toMatchObject({ ok: true });
      expect(reports).toHaveLength(2);
      store.setSessionConsents({});
      bindings.invalidateModConsent("squire");
      expect(await net.request({ url: url("/hello") })).toMatchObject({ ok: false, code: "not-declared" });
      expect(seen).toHaveLength(2);
      expect(reports[2]).toMatchObject({ modId: "squire", revoke: true });
    } finally {
      bindings.setConsentBindings(new Map());
      store.setSessionConsents({});
      digest.mockRestore();
    }
  });

  it("refuses spoofed identities, invented grants, unapproved destinations, and foreign windows without sending", async () => {
    let sent = 0;
    const { authority, rawRelay } = relayWith({ fetch: async () => { sent++; return new Response("ok"); } });
    const handle = await authority.report(decision(), 1, allow) as Record<string, unknown>;
    const base = { installation: handle["installation"], request: { url: url("/hello") } };
    for (const arg of [
      { modId: "squire", grants: ["*"], request: base.request },
      { ...base, modId: "victim" },
      { ...base, digest: "b".repeat(64) },
      { ...base, grants: ["*"] },
      { ...base, grants: ["network:*"] },
      { ...base, request: { url: "https://evil.example.com/" } },
    ]) expect(await rawRelay.handle("request", arg, 1)).toMatchObject({ ok: false, code: "not-declared" });
    expect(await rawRelay.handle("request", base, 2)).toMatchObject({ ok: false });
    expect(sent).toBe(0);
    expect(await rawRelay.handle("request", base, 1)).toMatchObject({ ok: true });
  });

  it("requires a native decision for forged reports, widening, and duplicate handle requests", async () => {
    const { authority, rawRelay } = relayWith();
    const report = decision();
    expect(await authority.report({ ...report, accepted: true }, 1, allow)).toMatchObject({ ok: false });
    expect(await authority.report(report, 1, async () => false)).toMatchObject({ ok: false });
    const handle = await authority.report(report, 1, allow) as Record<string, unknown>;
    const installation = handle["installation"];
    expect(await authority.report(report, 1, async () => false)).toMatchObject({ ok: false });
    expect(await authority.report({ ...report, installation, grants: ["network:*"], destinations: [here(), "evil.example.com"] }, 1, async () => false)).toMatchObject({ ok: false });
    expect(await rawRelay.handle("request", { installation, request: { url: "https://evil.example.com/" } }, 1)).toMatchObject({ ok: false });
    expect(authority.lookup({ installation }, 1)?.grants).toEqual(report.grants);
    const ask = vi.fn(allow);
    for (const forged of [{ ...report, digest: "bad" }, { ...report, grants: Array(257).fill("network:*") },
      { ...report, destinations: ["*"] }, { ...report, destinations: ["evil.example.com"] }]) {
      expect(await authority.report(forged, 1, ask)).toMatchObject({ ok: false });
    }
    expect(ask).not.toHaveBeenCalled();
  });

  it("bounds pending confirmations, confirmation frequency, and table size without creating extra authority", async () => {
    const authority = createDesktopAuthority();
    let finish: (allowed: boolean) => void = () => {};
    const pending = authority.report(decision(), 1, () => new Promise((resolve) => { finish = resolve; }));
    const ask = vi.fn(allow);
    expect(await authority.report({ ...decision(), modId: "second" }, 1, ask)).toMatchObject({ ok: false });
    expect(ask).not.toHaveBeenCalled();
    finish(true);
    await pending;
    for (let i = 1; i < 10; i++) await authority.report({ ...decision(), modId: `mod-${i}` }, 1, ask);
    expect(await authority.report({ ...decision(), modId: "rate-excess" }, 1, ask)).toMatchObject({ ok: false });
    expect(ask).toHaveBeenCalledTimes(9);
    const full = createDesktopAuthority();
    for (let i = 0; i < 128; i++) await full.report(decision(), i, allow);
    expect(await full.report(decision(), 128, ask)).toMatchObject({ ok: false });
    expect(ask).toHaveBeenCalledTimes(9);
  });

  it("keeps existing requests authorized when native consent only adds destinations", async () => {
    const authority = createDesktopAuthority();
    const handle = await authority.report(decision(), 1, allow) as Record<string, unknown>;
    const before = authority.lookup(handle, 1)!;
    const wider = await authority.report({ ...decision(), installation: handle["installation"], grants: ["network:*"],
      destinations: [here(), "other.example.com"] }, 1, allow) as Record<string, unknown>;
    expect(before.signal.aborted).toBe(true);
    const current = authority.lookup(wider, 1)!;
    const added = await authority.report({ ...decision(), installation: wider["installation"], grants: ["network:*"],
      destinations: [here(), "other.example.com", "third.example.com"] }, 1, allow) as Record<string, unknown>;
    expect(added["installation"]).toBe(wider["installation"]);
    expect(current.signal.aborted).toBe(false);
    expect(current.destinations).not.toContain("third.example.com");
    authority.revokeWindow(1);
    expect(current.signal.aborted).toBe(true);
  });

  it("rechecks approved destinations on redirects even when network:* is granted", async () => {
    let sent = 0;
    const { authority, rawRelay } = relayWith({ fetch: async () => {
      sent++;
      return new Response(null, { status: 302, headers: { location: "https://evil.example.com/" } });
    } });
    const handle = await authority.report({ ...decision(), grants: ["network:*"] }, 1, allow) as Record<string, unknown>;
    expect(await rawRelay.handle("request", { installation: handle["installation"], request: { url: url("/hello") } }, 1)).toMatchObject({ ok: false, code: "redirect" });
    expect(sent).toBe(1);
  });

  it("aborts an in-flight body, drops its bytes, and rejects a revoked handle after a new epoch", async () => {
    let started: () => void = () => {};
    const reading = new Promise<void>((resolve) => { started = resolve; });
    let canceled = false;
    let signal: AbortSignal | undefined;
    const { authority, rawRelay } = relayWith({ fetch: async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Response(new ReadableStream({ pull() { started(); }, cancel() { canceled = true; } }));
    } });
    const handle = await authority.report(decision(), 1, allow) as Record<string, unknown>;
    const arg = { installation: handle["installation"], request: { url: url("/hello") } };
    const pending = rawRelay.handle("request", arg, 1);
    await reading;
    await authority.report({ ...decision(), revoke: true }, 1, allow);
    expect(await pending).toMatchObject({ ok: false, code: "not-declared" });
    expect(canceled).toBe(true);
    expect(signal?.aborted).toBe(true);
    await authority.report(decision(), 1, allow);
    expect(await rawRelay.handle("request", arg, 1)).toMatchObject({ ok: false, code: "not-declared" });
  });

  it("does not resurrect a pending confirmation after revoke or navigation and starts empty after restart", async () => {
    const authority = createDesktopAuthority();
    for (const navigate of [false, true]) {
      let finish: (allowed: boolean) => void = () => {};
      const pending = authority.report(decision(), 1, () => new Promise((resolve) => { finish = resolve; }));
      if (navigate) authority.revokeWindow(1);
      else await authority.report({ ...decision(), revoke: true }, 1, allow);
      finish(true);
      expect(await pending).toMatchObject({ ok: false });
    }
    const handle = await authority.report(decision(), 1, allow);
    expect(createDesktopAuthority().lookup(handle, 1)).toBeNull();
    authority.revokeWindow(1);
    expect(authority.lookup(handle, 1)).toBeNull();
  });

  it("cancels a pending widening when an authenticated decision removes authority", async () => {
    const authority = createDesktopAuthority();
    const handle = await authority.report(decision(), 1, allow) as Record<string, unknown>;
    let finish: (allowed: boolean) => void = () => {};
    const pending = authority.report({ ...decision(), installation: handle["installation"], grants: ["network:*"] }, 1,
      () => new Promise((resolve) => { finish = resolve; }));
    const narrowed = await authority.report({ ...decision(), installation: handle["installation"], grants: [], destinations: [] }, 1, allow);
    finish(true);
    expect(await pending).toMatchObject({ ok: false });
    expect(authority.lookup(narrowed, 1)?.grants).toEqual([]);
    expect(authority.lookup(handle, 1)).toBeNull();
  });

  it("does not store an environment binding after its grant is revoked during confirmation", async () => {
    const authority = createDesktopAuthority();
    const handle = await authority.report(decision(), 1, allow) as Record<string, unknown>;
    const { rawRelay, file } = relayWith({ authority, confirmEnv: async () => {
      await authority.report({ ...decision(), revoke: true }, 1, allow);
      return true;
    } });
    expect(await rawRelay.handle("secret-env", { installation: handle["installation"], name: "key", variables: ["TEST_KEY"], hosts: [here()] }, 1)).toMatchObject({ ok: false });
    expect(file()).toBeNull();
  });
});

describe("net relay requests", () => {
  it("sends a request to a declared host and returns status, headers and body", async () => {
    const { relay } = relayWith();
    const r = await relay.handle("request", { modId: "squire", grants: [here()], request: { url: url("/hello") } }) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true, status: 201, body: JSON.stringify({ path: "/hello" }) });
    expect((r["headers"] as Record<string, string>)["x-custom"]).toBe("yes");
    expect(r["secretStorage"]).toBeUndefined();
  });

  it("refuses an undeclared host without sending anything", async () => {
    const { relay } = relayWith();
    const r = await relay.handle("request", { modId: "squire", grants: ["api.example.com"], request: { url: url("/hello") } });
    expect(r).toMatchObject({ ok: false, code: "not-declared" });
    expect(seen).toHaveLength(0);
  });

  it("refuses network:local for a loopback server without sending a request", async () => {
    const { relay } = relayWith();
    const r = await relay.handle("request", { modId: "squire", grants: ["local"], request: { url: `http://127.0.0.1:${port}/hello` } });
    expect(r).toMatchObject({ ok: false, code: "not-declared" });
    expect(seen).toHaveLength(0);
  });

  it("follows a redirect to a declared host and refuses one to an undeclared host", async () => {
    const { relay } = relayWith();
    const home = await relay.handle("request", { modId: "squire", grants: [here()], request: { url: url("/redirect-home") } });
    expect(home).toMatchObject({ ok: true, status: 201, body: JSON.stringify({ path: "/hello" }) });
    const away = await relay.handle("request", { modId: "squire", grants: [here()], request: { url: url("/redirect-away") } });
    expect(away).toMatchObject({ ok: false, code: "redirect" });
  });

  it("refuses a response over the size limit", async () => {
    const { relay } = relayWith();
    const r = await relay.handle("request", { modId: "squire", grants: [here()], request: { url: url("/big") } });
    expect(r).toMatchObject({ ok: false, code: "too-large" });
  });

  it("refuses a private DNS answer and a redirect to metadata without sending to either address", async () => {
    const privateRelay = relayWith({ resolveHost: async () => ["93.184.216.34", "10.0.0.1"] }).relay;
    expect(await privateRelay.handle("request", { modId: "squire", grants: ["*"], request: { url: url("/hello") } })).toMatchObject({ ok: false, code: "not-declared" });
    expect(seen).toHaveLength(0);
    let fetches = 0;
    const redirectRelay = relayWith({ fetch: async () => {
      fetches++;
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    } }).relay;
    expect(await redirectRelay.handle("request", { modId: "squire", grants: ["*"], request: { url: url("/hello") } })).toMatchObject({ ok: false, code: "redirect" });
    expect(fetches).toBe(1);
  });

  it("refuses oversized bodies, headers, and URL credentials before sending", async () => {
    const { relay } = relayWith();
    for (const request of [
      { url: url("/hello"), method: "POST", body: "x".repeat(1024 * 1024 + 1) },
      { url: url("/hello"), headers: { "x-large": "x".repeat(16 * 1024) } },
      { url: `https://user:password@${here()}/hello` },
    ]) {
      expect(await relay.handle("request", { modId: "squire", grants: [here()], request })).toMatchObject({ ok: false });
    }
    expect(seen).toHaveLength(0);
  });

  it("removes raw authorization and proxy credentials and does not return cookies", async () => {
    let headers: Headers | undefined;
    const { relay } = relayWith({ fetch: async (_input, init) => {
      headers = new Headers(init?.headers);
      return new Response("ok", { headers: { "set-cookie": "session=ambient" } });
    } });
    const result = await relay.handle("request", { modId: "squire", grants: [here()], request: {
      url: url("/hello"), headers: { Authorization: "Bearer ambient", "Proxy-Authorization": "Basic ambient" },
    } });
    expect(result).toMatchObject({ ok: true, headers: {} });
    expect(headers?.has("authorization")).toBe(false);
    expect(headers?.has("proxy-authorization")).toBe(false);
    expect(await relay.handle("request", { modId: "squire", grants: [here()], request: { url: url("/hello"), headers: { Cookie: "ambient" } } })).toMatchObject({ ok: false });
  });

  it("does not send URL credentials supplied by a redirect", async () => {
    let fetches = 0;
    const { relay } = relayWith({ fetch: async () => {
      fetches++;
      return new Response(null, { status: 302, headers: { location: `https://user:password@${here()}/hello` } });
    } });
    expect(await relay.handle("request", { modId: "squire", grants: [here()], request: { url: url("/hello") } })).toMatchObject({ ok: false, code: "redirect" });
    expect(fetches).toBe(1);
  });

  it("caps headers after replacing credential references without sending the expanded values", async () => {
    const { relay } = relayWith();
    await relay.handle("secret-set", { modId: "squire", grants: [here()], name: "jev", value: "x".repeat(4096), hosts: [here()] });
    expect(await relay.handle("request", { modId: "squire", grants: [here()], request: {
      url: url("/hello"), headers: { "x-key": "{secret:jev}".repeat(5) },
    } })).toMatchObject({ ok: false, code: "too-large" });
    expect(seen).toHaveLength(0);
  });

  it("shares the rate limit across spoofed ids in one window and recovers after the interval", async () => {
    let clock = 0;
    let fetches = 0;
    const { relay } = relayWith({ now: () => clock, fetch: async () => {
      fetches++;
      return new Response("ok");
    } });
    for (let i = 0; i < 60; i++) await relay.handle("info", {}, 1);
    expect(await relay.handle("request", { modId: "another-mod", grants: ["*"], request: { url: url("/hello") } }, 1)).toMatchObject({ ok: false, code: "bad-request" });
    expect(fetches).toBe(0);
    clock = 10_000;
    expect(await relay.handle("request", { modId: "squire", grants: [here()], request: { url: url("/hello") } }, 1)).toMatchObject({ ok: true });
    expect(fetches).toBe(1);
  });

  it("refuses a ninth concurrent request before opening a connection", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let fetches = 0;
    const { relay } = relayWith({ fetch: async () => {
      fetches++;
      await gate;
      return new Response("ok");
    } });
    const request = { modId: "squire", grants: [here()], request: { url: url("/hello") } };
    const pending = Array.from({ length: 8 }, () => relay.handle("request", request));
    expect(await relay.handle("request", request)).toMatchObject({ ok: false, code: "bad-request" });
    release();
    expect((await Promise.all(pending)).every((result) => (result as { ok: boolean }).ok)).toBe(true);
    expect(fetches).toBe(8);
  });

  it("times out a stalled DNS lookup without opening a connection", async () => {
    vi.useFakeTimers();
    try {
      const { relay } = relayWith({ resolveHost: () => new Promise(() => {}) });
      const pending = relay.handle("request", { modId: "squire", grants: [here()], request: { url: url("/hello"), timeoutMs: 1000 } });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toMatchObject({ ok: false, code: "timeout" });
      expect(seen).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an unreachable server as a problem rather than throwing", async () => {
    const { relay } = relayWith();
    const r = await relay.handle("request", { modId: "squire", grants: ["api.example.com:1"], request: { url: "http://api.example.com:1/x", timeoutMs: 2000 } });
    expect(r).toMatchObject({ ok: false });
    expect(["unreachable", "timeout"]).toContain((r as { code: string }).code);
  });
});

describe("net relay secrets", () => {
  it("substitutes a stored secret, keeps it encrypted on disk, and never returns it", async () => {
    const { relay, file } = relayWith();
    const set = await relay.handle("secret-set", { modId: "squire", grants: [here()], name: "jev", value: "sk-secret", hosts: [here()] });
    expect(set).toEqual({ ok: true, storage: "os" });
    expect(file()).not.toContain("sk-secret");
    expect(await relay.handle("secret-has", { modId: "squire", name: "jev" })).toEqual({ present: true, storage: "os" });
    const r = await relay.handle("request", {
      modId: "squire", grants: [here()],
      request: { url: url("/hello"), headers: { Authorization: "Bearer {secret:jev}" } },
    }) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true, secretStorage: "os" });
    expect(JSON.stringify(r)).not.toContain("sk-secret");
    expect(seen[0]?.auth).toBe("Bearer sk-secret");
  });

  it("does not send a secret to a host it was not stored for", async () => {
    const { relay } = relayWith();
    await relay.handle("secret-set", { modId: "squire", grants: [here(), `other.example.com:${port}`], name: "jev", value: "sk-secret", hosts: [here()] });
    const r = await relay.handle("request", {
      modId: "squire", grants: [here(), `other.example.com:${port}`],
      request: { url: `https://other.example.com:${port}/hello`, headers: { Authorization: "Bearer {secret:jev}" } },
    });
    expect(r).toMatchObject({ ok: false, code: "secret-host" });
    expect(seen).toHaveLength(0);
  });

  it("refuses a redirect that would carry a secret to another host", async () => {
    const { relay } = relayWith();
    const grants = [here(), `other.example.com:${port}`];
    await relay.handle("secret-set", { modId: "squire", grants, name: "jev", value: "sk-secret", hosts: [here()] });
    const r = await relay.handle("request", {
      modId: "squire", grants,
      request: { url: url("/redirect-other-name"), headers: { Authorization: "Bearer {secret:jev}" } },
    });
    expect(r).toMatchObject({ ok: false, code: "redirect" });
    expect(seen.map((s) => s.path)).toEqual(["/redirect-other-name"]);
  });

  it("keeps each mod's secrets apart", async () => {
    const { relay } = relayWith();
    await relay.handle("secret-set", { modId: "squire", grants: [here()], name: "jev", value: "sk-secret", hosts: [here()] });
    const r = await relay.handle("request", {
      modId: "other", grants: [here()],
      request: { url: url("/hello"), headers: { Authorization: "Bearer {secret:jev}" } },
    });
    expect(r).toMatchObject({ ok: false, code: "secret-missing" });
  });

  it("refuses to bind a secret to a host outside the mod's grants", async () => {
    const { relay } = relayWith();
    const r = await relay.handle("secret-set", { modId: "squire", grants: [here()], name: "jev", value: "v", hosts: ["evil.example.com"] });
    expect(r).toMatchObject({ ok: false, code: "not-declared" });
  });

  it("refuses to store a secret when the OS offers no encryption", async () => {
    const { relay, file } = relayWith({
      encryption: { available: () => false, encrypt: () => "", decrypt: () => "" },
    });
    const r = await relay.handle("secret-set", { modId: "squire", grants: [here()], name: "jev", value: "v", hosts: [here()] });
    expect(r).toMatchObject({ ok: false });
    expect(file()).toBeNull();
  });

  it("does not store an oversized secret", async () => {
    const { relay, file } = relayWith();
    expect(await relay.handle("secret-set", { modId: "squire", grants: [here()], name: "jev", value: "x".repeat(8193), hosts: [here()] })).toMatchObject({ ok: false, code: "too-large" });
    expect(file()).toBeNull();
  });

  it("asks once before reading environment variables, then sends the first one set", async () => {
    const { relay, asks } = relayWith();
    const bind = { modId: "squire", modName: "Squire", grants: [here()], name: "jev", variables: ["MISSING_KEY", "TYPESAFE_API_KEY"], hosts: [here()] };
    expect(await relay.handle("secret-env", bind)).toEqual({ ok: true, storage: "environment" });
    expect(await relay.handle("secret-env", bind)).toEqual({ ok: true, storage: "environment" });
    expect(asks).toEqual([{ modName: "squire", variables: ["MISSING_KEY", "TYPESAFE_API_KEY"], hosts: [here()] }]);
    const r = await relay.handle("request", {
      modId: "squire", grants: [here()],
      request: { url: url("/hello"), headers: { Authorization: "Bearer {secret:jev}" } },
    });
    expect(r).toMatchObject({ ok: true, secretStorage: "environment" });
    expect(seen[0]?.auth).toBe("Bearer env-key");
    await relay.handle("secret-env", { ...bind, hosts: [here(), "extra.example.com"], grants: [here(), "extra.example.com"] });
    expect(asks).toHaveLength(2);
  });

  it("stores nothing when the player declines to share an environment variable", async () => {
    const { relay, file } = relayWith({ confirmEnv: async () => false });
    const r = await relay.handle("secret-env", { modId: "squire", grants: [here()], name: "jev", variables: ["TYPESAFE_API_KEY"], hosts: [here()] });
    expect(r).toMatchObject({ ok: false });
    expect(file()).toBeNull();
  });

  it("reports a missing environment variable by name", async () => {
    const { relay } = relayWith();
    await relay.handle("secret-env", { modId: "squire", grants: [here()], name: "jev", variables: ["NOT_SET_HERE"], hosts: [here()] });
    const r = await relay.handle("request", {
      modId: "squire", grants: [here()],
      request: { url: url("/hello"), headers: { Authorization: "Bearer {secret:jev}" } },
    }) as { ok: boolean; problem: string };
    expect(r.ok).toBe(false);
    expect(r.problem).toContain("NOT_SET_HERE");
    expect(seen).toHaveLength(0);
  });

  it("deletes a secret", async () => {
    const { relay } = relayWith();
    await relay.handle("secret-set", { modId: "squire", grants: [here()], name: "jev", value: "v", hosts: [here()] });
    expect(await relay.handle("secret-delete", { modId: "squire", name: "jev" })).toEqual({ ok: true });
    expect(await relay.handle("secret-has", { modId: "squire", name: "jev" })).toEqual({ present: false });
  });
});
