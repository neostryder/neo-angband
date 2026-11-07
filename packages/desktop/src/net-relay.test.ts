/**
 * The relay's transport maps public test names onto a loopback fixture. The
 * production transport's connection checks have separate adversarial tests.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { createNetRelay, type NetRelayDeps } from "./net-relay.js";

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
  let file: string | null = null;
  const asks: { modName: string; variables: readonly string[]; hosts: readonly string[] }[] = [];
  const relay = createNetRelay({
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
  return { relay, asks, file: () => file };
}

const here = () => `api.example.com:${port}`;
const url = (path: string) => `https://${here()}${path}`;

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
    expect(asks).toEqual([{ modName: "Squire", variables: ["MISSING_KEY", "TYPESAFE_API_KEY"], hosts: [here()] }]);
    const r = await relay.handle("request", {
      modId: "squire", grants: [here()],
      request: { url: url("/hello"), headers: { Authorization: "Bearer {secret:jev}" } },
    });
    expect(r).toMatchObject({ ok: true, secretStorage: "environment" });
    expect(seen[0]?.auth).toBe("Bearer env-key");
    await relay.handle("secret-env", { ...bind, hosts: [here(), "local"], grants: [here(), "local"] });
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
