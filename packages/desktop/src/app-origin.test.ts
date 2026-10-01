import { describe, expect, it } from "vitest";
import { APP_ORIGIN, appRequestPath, isGameUrl, isLegacyProbe, legacyOrigin } from "./app-origin.js";
import { ORIGIN_PROBE_ROUTE } from "./routes.js";

describe("the game's own origin", () => {
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
