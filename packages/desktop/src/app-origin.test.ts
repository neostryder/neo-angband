import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { APP_ORIGIN, GAME_PAGE_CSP, appRequestPath, hostPayloadDigest, isGameBridgeFrame, isGameUrl, isLegacyProbe, legacyOrigin } from "./app-origin.js";
import { ORIGIN_PROBE_ROUTE } from "./routes.js";

describe("host installation measurement", () => {
  let base: string;
  let web: string;
  let host: string;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(process.cwd(), "neo-authority-"));
    web = path.join(base, "web");
    host = path.join(base, "main.cjs");
    fs.mkdirSync(web);
    fs.writeFileSync(host, "host");
    fs.writeFileSync(path.join(base, "preload.cjs"), "preload");
    fs.writeFileSync(path.join(web, "index.html"), "page");
  });
  afterEach(() => {
    if (path.dirname(path.resolve(base)) !== process.cwd()) throw new Error("The fixture left the workspace.");
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("binds the host and web bytes and canonical file names", () => {
    const initial = hostPayloadDigest(web, host);
    expect(hostPayloadDigest(web, host)).toBe(initial);
    fs.writeFileSync(host, "changed host");
    expect(hostPayloadDigest(web, host)).not.toBe(initial);
    fs.writeFileSync(host, "host");
    fs.writeFileSync(path.join(base, "preload.cjs"), "changed preload");
    expect(hostPayloadDigest(web, host)).not.toBe(initial);
    fs.writeFileSync(path.join(base, "preload.cjs"), "preload");
    fs.writeFileSync(path.join(web, "index.html"), "changed page");
    expect(hostPayloadDigest(web, host)).not.toBe(initial);
    fs.writeFileSync(path.join(web, "index.html"), "page");
    fs.renameSync(path.join(web, "index.html"), path.join(web, "other.html"));
    expect(hostPayloadDigest(web, host)).not.toBe(initial);
  });

  it("refuses linked and oversized host payloads instead of issuing a digest", () => {
    const target = path.join(base, "target");
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(web, "linked"), "junction");
    expect(() => hostPayloadDigest(web, host)).toThrow("link");
    fs.unlinkSync(path.join(web, "linked"));
    fs.writeFileSync(path.join(web, "huge"), "");
    fs.truncateSync(path.join(web, "huge"), 256 * 1024 * 1024 + 1);
    expect(() => hostPayloadDigest(web, host)).toThrow("limit");
  });
});

describe("the game's own origin", () => {
  it("denies unlisted loads, inline scripts, eval, embedding, and form submissions in the proposed page policy", () => {
    const directives = GAME_PAGE_CSP.split("; ");
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain("script-src 'self' blob:");
    expect(directives).toContain("object-src 'none'");
    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives).toContain("form-action 'none'");
    expect(GAME_PAGE_CSP).not.toContain("unsafe-eval");
  });
  it("has no port in it", () => {
    expect(APP_ORIGIN).toBe("neo-angband://game");
    expect(new URL(`${APP_ORIGIN}/`).port).toBe("");
  });

  it("accepts its own pages and nothing that only starts like one", () => {
    expect(isGameUrl("neo-angband://game/")).toBe(true);
    expect(isGameUrl("neo-angband://game/index.html?agent=demo-wanderer")).toBe(true);
    for (const url of [
      "neo-angband://game.example/",
      "neo-angband://other/",
      "neo-angband://user:password@game/",
      "http://game/",
      "http://127.0.0.1:45871/",
      "javascript:alert(1)",
      "file:///C:/Windows/System32/cmd.exe",
      "not a url",
      "",
    ]) {
      expect(isGameUrl(url), url).toBe(false);
    }
  });

  it("refuses a subframe, a missing frame, and a main frame on another origin", () => {
    const main = { url: `${APP_ORIGIN}/` };
    expect(isGameBridgeFrame(main, main)).toBe(true);
    expect(isGameBridgeFrame({ url: main.url }, main)).toBe(false);
    expect(isGameBridgeFrame(null, main)).toBe(false);
    const foreign = { url: "https://example.com/" };
    expect(isGameBridgeFrame(foreign, foreign)).toBe(false);
  });

  it("hands routes.ts the path and query of a game URL", () => {
    expect(appRequestPath("neo-angband://game/")).toBe("/");
    expect(appRequestPath("neo-angband://game/mods/linoleum/a.png?v=2")).toBe("/mods/linoleum/a.png?v=2");
    expect(appRequestPath("http://127.0.0.1:45871/")).toBeNull();
  });
});

describe("reaching an old loopback origin without its port", () => {
  const ports = new Set([45871, 45872]);

  it("answers only the blank page, and only on the ports being read", () => {
    expect(isLegacyProbe(`${legacyOrigin(45871)}${ORIGIN_PROBE_ROUTE}`, ports)).toBe(true);
    expect(isLegacyProbe(`${legacyOrigin(45872)}${ORIGIN_PROBE_ROUTE}`, ports)).toBe(true);
    expect(isLegacyProbe(`${legacyOrigin(45873)}${ORIGIN_PROBE_ROUTE}`, ports)).toBe(false);
    expect(isLegacyProbe(`${legacyOrigin(45871)}/`, ports)).toBe(false);
    expect(isLegacyProbe(`${legacyOrigin(45871)}/index.html`, ports)).toBe(false);
    expect(isLegacyProbe(`${legacyOrigin(45871)}${ORIGIN_PROBE_ROUTE}?x=1`, ports)).toBe(false);
    expect(isLegacyProbe(`http://localhost:45871${ORIGIN_PROBE_ROUTE}`, ports)).toBe(false);
    expect(isLegacyProbe(`https://127.0.0.1:45871${ORIGIN_PROBE_ROUTE}`, ports)).toBe(false);
  });
});


describe("main window child policy", () => {
  it("denies every renderer child, including blank and same-origin mod pages", async () => {
    const { runInNewContext } = await import("node:vm");
    const source = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const policy = source.match(/win\.webContents\.setWindowOpenHandler\([\s\S]*?\r?\n {2}\}\);/u)?.[0];
    expect(policy).toBeDefined();
    const register = vi.fn();
    const external = vi.fn();
    runInNewContext(policy!, { win: { webContents: { setWindowOpenHandler: register } }, isGameUrl, confirmExternalOpen: external });
    const handler = register.mock.calls[0]![0] as (details: { url: string }) => { action: string };
    for (const url of ["neo-angband://game/", "neo-angband://game/mods/untrusted/index.html", "about:blank", "data:text/html,test", "blob:neo-angband://game/test", "file:///test", "https://github.com/neostryder/neo-angband/releases"]) {
      expect(handler({ url }), url).toEqual({ action: "deny" });
    }
  });
});
