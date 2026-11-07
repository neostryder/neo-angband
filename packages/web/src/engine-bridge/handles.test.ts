import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HandleTable } from "./handles";
import { BRIDGE_LIMITS } from "./types";

const authority = { installation: "installation-a", epoch: 1, granted: true };

afterEach(() => vi.restoreAllMocks());

describe("host-owned handle table", () => {
  it("uses 256 random bits and keeps the live object only on the host", () => {
    const random = vi.spyOn(crypto, "getRandomValues");
    const table = new HandleTable(authority.installation, authority.epoch);
    const target = { id: "player", liveEngine: { hostOnly: true } };
    const handle = table.issue(authority, target);
    expect(typeof handle).toBe("string");
    expect(handle).toMatch(/^1:[a-f0-9]{64}$/u);
    expect(random).toHaveBeenCalledOnce();
    expect(random.mock.calls[0]?.[0]?.byteLength).toBe(32);
    expect(table.resolve(authority, handle)).toBe(target);
    expect(table.size).toBe(1);
  });

  it("refuses missing grants, foreign identities, old epochs, and guessed ids", () => {
    const table = new HandleTable(authority.installation, authority.epoch);
    const handle = table.issue(authority, { id: "player" });
    for (const caller of [
      { ...authority, granted: false },
      { ...authority, installation: "installation-b" },
      { ...authority, epoch: 0 },
    ]) {
      expect(() => table.resolve(caller, handle)).toThrow("not-authorized");
      expect(() => table.issue(caller, { id: "other" })).toThrow("not-authorized");
      expect(table.size).toBe(1);
    }
    expect(() => table.resolve(authority, "0".repeat(64))).toThrow("invalid-handle");
    expect(table.size).toBe(1);
  });

  it("caps retained objects and leaves the table unchanged on overflow", () => {
    const table = new HandleTable(authority.installation, authority.epoch);
    for (let index = 0; index < BRIDGE_LIMITS.handles; index++) table.issue(authority, { id: String(index) });
    expect(() => table.issue(authority, { id: "overflow" })).toThrow("limit");
    expect(table.size).toBe(BRIDGE_LIMITS.handles);
  });

  it("bounds random-id collision retries without replacing an existing target", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((bytes) => bytes);
    const table = new HandleTable(authority.installation, authority.epoch);
    const target = { id: "player" };
    const handle = table.issue(authority, target);
    expect(() => table.issue(authority, { id: "replacement" })).toThrow("limit");
    expect(table.resolve(authority, handle)).toBe(target);
    expect(table.size).toBe(1);
    expect(crypto.getRandomValues).toHaveBeenCalledTimes(5);
  });

  it("clears handles on epoch advance and cannot rewind or restart after stop", () => {
    const table = new HandleTable(authority.installation, authority.epoch);
    const handle = table.issue(authority, { id: "player" });
    for (const epoch of [0, 1, -1, 1.5, Infinity]) {
      expect(() => table.advanceEpoch(epoch)).toThrow("not-authorized");
      expect(table.size).toBe(1);
    }
    table.advanceEpoch(2);
    expect(table.size).toBe(0);
    const current = { ...authority, epoch: 2 };
    expect(() => table.resolve(current, handle)).toThrow("invalid-handle");
    table.issue(current, { id: "other" });
    table.stop();
    table.stop();
    expect(table.size).toBe(0);
    expect(() => table.issue(current, { id: "restart" })).toThrow("not-authorized");
    expect(() => table.advanceEpoch(3)).toThrow("not-authorized");
  });

  it("cannot reissue an earlier epoch's handle even if random bytes repeat", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((bytes) => bytes);
    const table = new HandleTable(authority.installation, authority.epoch);
    const old = table.issue(authority, { id: "old" });
    table.advanceEpoch(2);
    const current = { ...authority, epoch: 2 };
    const next = table.issue(current, { id: "new" });
    expect(next).not.toBe(old);
    expect(() => table.resolve(current, old)).toThrow("invalid-handle");
    expect(table.resolve(current, next).id).toBe("new");
  });

  it("retains nothing when the random source fails", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation(() => { throw new Error("No random source."); });
    const table = new HandleTable(authority.installation, authority.epoch);
    expect(() => table.issue(authority, { id: "player" })).toThrow("No random source.");
    expect(table.size).toBe(0);
  });

  it.each(["", "installation-a"])("rejects invalid initial scopes for %s", (installation) => {
    expect(() => new HandleTable(installation, -1)).toThrow("not-authorized");
    expect(() => new HandleTable(installation, 0.5)).toThrow("not-authorized");
    if (!installation) expect(() => new HandleTable(installation, 1)).toThrow("not-authorized");
  });

  it("releases live targets after stop and epoch advance while the table stays alive", () => {
    const modules = Object.fromEntries(["types", "handles"].map((name) => [
      `./${name}`,
      transpileModule(readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8"), {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
      }).outputText,
    ]));
    // A separate process gives this lifetime check an explicit garbage collector.
    const child = spawnSync(process.execPath, ["--expose-gc", "-e", `
      const sources = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      const cache = {};
      function load(name) {
        if (cache[name]) return cache[name];
        const exports = cache[name] = {};
        new Function("require", "exports", sources[name])(load, exports);
        return exports;
      }
      const { HandleTable } = load("./handles");
      const scope = { installation: "installation-a", epoch: 1, granted: true };
      async function check(action) {
        const table = new HandleTable(scope.installation, scope.epoch);
        const weak = (() => {
          const target = { id: "player", live: { marker: "host-only" } };
          table.issue(scope, target);
          return new WeakRef(target);
        })();
        await new Promise(setImmediate);
        global.gc();
        if (!weak.deref()) throw new Error("The table did not retain its live target.");
        if (action === "stop") table.stop();
        else table.advanceEpoch(2);
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise(setImmediate);
          global.gc();
        }
        if (weak.deref() !== undefined || table.size !== 0) throw new Error("The table retained a revoked target.");
      }
      (async () => {
        await check("stop");
        await check("epoch");
        process.stdout.write("released after stop and epoch change\\n");
      })().catch((error) => { process.stderr.write(error.message); process.exitCode = 1; });
    `], { input: JSON.stringify(modules), encoding: "utf8", windowsHide: true, timeout: 15_000 });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    expect(child.stdout).toBe("released after stop and epoch change\n");
  });
});
