/**
 * The mod network relay against a real HTTP server on loopback, with Electron's
 * safeStorage and dialog replaced by stand-ins.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
      res.writeHead(302, { location: `http://localhost:${port}/hello` });
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
    fetch: (input, init) => fetch(input, init),
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

const here = () => `127.0.0.1:${port}`;
const url = (path: string) => `http://${here()}${path}`;

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

  it("accepts network:local for a loopback server", async () => {
    const { relay } = relayWith();
    const r = await relay.handle("request", { modId: "squire", grants: ["local"], request: { url: url("/hello") } });
    expect(r).toMatchObject({ ok: true, status: 201 });
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

  it("reports an unreachable server as a problem rather than throwing", async () => {
    const { relay } = relayWith();
    const r = await relay.handle("request", { modId: "squire", grants: ["local"], request: { url: "http://127.0.0.1:1/x", timeoutMs: 2000 } });
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
    await relay.handle("secret-set", { modId: "squire", grants: [here(), `localhost:${port}`], name: "jev", value: "sk-secret", hosts: [here()] });
    const r = await relay.handle("request", {
      modId: "squire", grants: [here(), `localhost:${port}`],
      request: { url: `http://localhost:${port}/hello`, headers: { Authorization: "Bearer {secret:jev}" } },
    });
    expect(r).toMatchObject({ ok: false, code: "secret-host" });
    expect(seen).toHaveLength(0);
  });

  it("refuses a redirect that would carry a secret to another host", async () => {
    const { relay } = relayWith();
    const grants = [here(), `localhost:${port}`];
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
