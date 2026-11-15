/**
 * The routing defect found by playing rather than by reading: enabling the
 * Linoleum tile mod on the desktop build "does nothing" and the map stays ASCII
 * glyphs.
 *
 * The cause was not in the tile engine, the converter, or the mod loader - all
 * three were proven working on the browser build. It was that `/mods/*` on the
 * desktop shell resolved ONLY against the player's mods folder and 404'd
 * otherwise, so the mod assets compiled into the web bundle were unreachable on
 * that host alone. These tests pin the two-candidate lookup that fixes it, and
 * would have failed before it.
 */
import { describe, expect, it } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import { planRequest, readStaticFile, safeJoin } from "./routes.js";

const ROOTS = {
  modsDir: path.normalize("/data/mods"),
  webRoot: path.normalize("/app/web"),
} as const;

const p = (...parts: string[]) => path.normalize(path.join(...parts));

/** The candidate list, or a failure message naming what arrived instead. */
function candidates(url: string): readonly string[] {
  const plan = planRequest(url, ROOTS);
  if (plan.kind !== "file") throw new Error(`expected a file plan, got ${plan.kind}`);
  return plan.candidates;
}

describe("planRequest", () => {
  it("offers a bundled mod asset as a candidate, not only the player's folder", () => {
    /* THE REGRESSION. Before the fix this produced exactly one candidate, under
     * modsDir, and a fresh install's empty mods folder turned every bundled tile
     * into a 404. */
    const got = candidates("/mods/linoleum/original-tiles/images/8/feat_granite_lit_0.png");
    expect(got).toEqual([
      p("/data/mods/linoleum/original-tiles/images/8/feat_granite_lit_0.png"),
      p("/app/web/mods/linoleum/original-tiles/images/8/feat_granite_lit_0.png"),
    ]);
  });

  it("puts the player's mods folder FIRST, so an installed mod shadows a bundled one", () => {
    const got = candidates("/mods/linoleum/manifest.json");
    expect(got[0]).toBe(p("/data/mods/linoleum/manifest.json"));
    expect(got[1]).toBe(p("/app/web/mods/linoleum/manifest.json"));
  });

  it("never falls back to index.html for a mod asset", () => {
    /* A 200 of index.html where a PNG was expected reads as "the file is there
     * but corrupt", which is a much worse trail to follow than a 404. */
    const plan = planRequest("/mods/nope/missing.png", ROOTS);
    expect(plan).toMatchObject({ kind: "file", fallbackIndex: false });
  });

  it("still serves the web bundle for non-mod paths, with the SPA fallback", () => {
    const plan = planRequest("/tiles/old/8x8.png", ROOTS);
    expect(plan).toEqual({
      kind: "file",
      candidates: [p("/app/web/tiles/old/8x8.png")],
      fallbackIndex: true,
    });
  });

  it("maps / to index.html", () => {
    expect(candidates("/")).toEqual([p("/app/web/index.html")]);
  });

  it("keeps the mods index synthesised rather than read off disk", () => {
    expect(planRequest("/mods/index.json", ROOTS)).toEqual({ kind: "mods-index" });
  });

  it("answers the service worker registration with an empty script", () => {
    expect(planRequest("/registerSW.js", ROOTS)).toEqual({ kind: "no-worker" });
  });

  it("keeps the origin probe page", () => {
    expect(planRequest("/__origin-storage", ROOTS)).toEqual({ kind: "origin-probe" });
  });

  it("refuses traversal out of the mods folder, and does not shop it to the bundle", () => {
    /* The trap in a two-candidate lookup: a `..` that escapes modsDir must not be
     * quietly retried against webRoot. Both joins are required to hold. */
    for (const url of [
      "/mods/../../secret.txt",
      "/mods/linoleum/../../../secret.txt",
      "/mods/%2e%2e%2f%2e%2e%2fsecret.txt",
    ]) {
      expect(planRequest(url, ROOTS), url).toEqual({ kind: "forbidden" });
    }
  });

  it("refuses traversal out of the web root", () => {
    expect(planRequest("/../secret.txt", ROOTS)).toEqual({ kind: "forbidden" });
  });

  it("never returns a candidate outside the root it belongs to", () => {
    /* The INVARIANT, pinned as a property rather than as one branch. The
     * two-candidate lookup made this worth stating separately: `inMods` happens
     * to be the stricter test today because <data>/mods sits one level deeper
     * than webRoot, so the bundle-side guard is currently unreachable. If that
     * nesting ever changes, this is the test that notices. */
    const nasty = [
      "/mods/../x",
      "/mods/../../x",
      "/mods/a/../../../x",
      "/mods/./../x",
      "/mods/%2e%2e/x",
      "/mods/a/%2e%2e/%2e%2e/%2e%2e/x",
      "/../x",
      "/a/../../x",
      "/mods/a//../../../x",
    ];
    for (const url of nasty) {
      const plan = planRequest(url, ROOTS);
      if (plan.kind !== "file") continue; // forbidden is the other acceptable answer
      for (const c of plan.candidates) {
        const underAnyRoot =
          c === ROOTS.modsDir ||
          c.startsWith(ROOTS.modsDir + path.sep) ||
          c === ROOTS.webRoot ||
          c.startsWith(ROOTS.webRoot + path.sep);
        expect(underAnyRoot, `${url} -> ${c}`).toBe(true);
      }
    }
  });

  it("ignores a query string when resolving a path", () => {
    expect(candidates("/tiles/old/8x8.png?v=2")).toEqual([p("/app/web/tiles/old/8x8.png")]);
  });

  it("does not treat a path merely starting with the word mods as the mods prefix", () => {
    /* `/modsomething` is a bundle path, not a mods request. */
    expect(candidates("/modsomething/x.png")).toEqual([p("/app/web/modsomething/x.png")]);
  });
});

describe("safeJoin", () => {
  it("returns the root itself for an empty path", () => {
    expect(safeJoin(p("/a/b"), "/")).toBe(p("/a/b"));
  });

  it("rejects a sibling directory that merely shares a prefix", () => {
    /* /a/bc must not pass as being under /a/b. */
    expect(safeJoin(p("/a/b"), "/../bc/x")).toBeNull();
  });
});


describe("physical static routes", () => {
  it("refuses nested junctions but serves a mods root deployed as a junction", () => {
    const base = fs.mkdtempSync(path.join(process.cwd(), "neo-static-"));
    if (path.dirname(path.resolve(base)) !== process.cwd()) throw new Error("The fixture left the workspace.");
    try {
      const root = path.join(base, "web");
      const outside = path.join(base, "outside");
      fs.mkdirSync(root);
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "held.txt"), "private");
      fs.writeFileSync(path.join(root, "asset.txt"), "normal");
      fs.symlinkSync(outside, path.join(root, "linked"), "junction");
      /* An external mod manager often deploys mods/ itself as a junction. */
      fs.symlinkSync(outside, path.join(base, "mods"), "junction");
      expect(safeJoin(root, "/asset.txt")).toBe(path.join(root, "asset.txt"));
      expect(safeJoin(root, "/linked/held.txt")).toBeNull();
      expect(safeJoin(path.join(base, "mods"), "/held.txt")).toBe(path.join(base, "mods", "held.txt"));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});


it("rechecks static assets at the read boundary after a route was planned", async () => {
  const base = fs.mkdtempSync(path.join(process.cwd(), "neo-static-read-"));
  if (path.dirname(path.resolve(base)) !== process.cwd()) throw new Error("The fixture left the workspace.");
  try {
    const root = path.join(base, "web");
    const outside = path.join(base, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(root, "pack"));
    fs.writeFileSync(path.join(root, "pack", "a.txt"), "normal");
    fs.writeFileSync(path.join(outside, "a.txt"), "private");
    const file = safeJoin(root, "/pack/a.txt")!;
    expect((await readStaticFile(root, file)).toString()).toBe("normal");
    fs.renameSync(path.join(root, "pack"), path.join(root, "original"));
    fs.symlinkSync(outside, path.join(root, "pack"), "junction");
    await expect(readStaticFile(root, file)).rejects.toThrow("refused");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});


it("serves packaged ASAR assets through Electron's filesystem", async () => {
  const { createRequire } = await import("node:module");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { buildSync } = await import("esbuild");
  const require = createRequire(import.meta.url);
  const builder = createRequire(require.resolve("electron-builder"));
  const asar = createRequire(builder.resolve("app-builder-lib"))("@electron/asar") as { createPackageFromStreams(dest: string, entries: object[]): Promise<fs.WriteStream> };
  const electronPath = (await import("electron")).default as unknown as string;
  const base = fs.mkdtempSync(path.join(process.cwd(), "neo-static-asar-"));
  if (path.dirname(path.resolve(base)) !== process.cwd()) throw new Error("The fixture left the workspace.");
  try {
    const payload = path.join(base, "payload");
    fs.mkdirSync(path.join(payload, "web"), { recursive: true });
    fs.writeFileSync(path.join(payload, "web", "index.html"), "normal packaged page");
    fs.writeFileSync(path.join(payload, "private.html"), "private");
    fs.writeFileSync(path.join(payload, "web", "unpacked.txt"), "unpacked asset");
    fs.symlinkSync(path.join(payload, "private.html"), path.join(payload, "web", "linked.html"), "file");
    const archive = path.join(base, "app.asar");
    const { finished } = await import("node:stream/promises");
    const entries = ["web/index.html", "web/unpacked.txt", "private.html"].map((file) => ({
      type: "file", path: file, stat: fs.statSync(path.join(payload, file)), unpacked: file.endsWith(".txt"), streamGenerator: () => fs.createReadStream(path.join(payload, file)),
    }));
    const output = await asar.createPackageFromStreams(archive, [...entries, { type: "link", path: "web/linked.html", symlink: "../private.html", stat: fs.lstatSync(path.join(payload, "web", "linked.html")) }]);
    await finished(output);
    for (const name of ["profile", "session", "logs"]) fs.mkdirSync(path.join(base, name));
    const bundle = path.join(base, "routes.cjs");
    buildSync({ entryPoints: [fileURLToPath(new URL("./routes.ts", import.meta.url))], bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "silent" });
    const script = path.join(base, "main.cjs");
    const literal = (file: string): string => JSON.stringify(file.split(path.sep).join("/"));
    fs.writeFileSync(script, [
      'const { app } = require("electron");',
      'app.setPath("userData", ' + literal(path.join(base, "profile")) + ');',
      'app.setPath("sessionData", ' + literal(path.join(base, "session")) + ');',
      'app.setAppLogsPath(' + literal(path.join(base, "logs")) + ');',
      'const { readStaticFile } = require(' + literal(bundle) + ');',
      '(async () => {',
      'const root = ' + literal(path.join(archive, "web")) + ';',
      'console.log((await readStaticFile(root, root + "/index.html")).toString());',
      'console.log((await readStaticFile(root, root + "/unpacked.txt")).toString());',
      'let refused = false; try { await readStaticFile(root, root + "/linked.html"); } catch { refused = true; }',
      'if (!refused) throw new Error("The archive link was accepted.");',
      'const fs = require("node:fs");',
      'fs.renameSync(' + literal(archive + ".unpacked/web") + ', ' + literal(archive + ".unpacked/held") + ');',
      'fs.symlinkSync(' + literal(payload) + ', ' + literal(archive + ".unpacked/web") + ', "junction");',
      'refused = false; try { await readStaticFile(root, root + "/unpacked.txt"); } catch { refused = true; }',
      'if (!refused) throw new Error("The unpacked junction was accepted.");',
      'console.log("linked assets refused");',
      '})().then(() => app.exit(0), error => { console.error(error); app.exit(1); });',
    ].join("\n"));
    const run = spawnSync(electronPath, [script], { cwd: base, encoding: "utf8", windowsHide: true, timeout: 30_000, env: { ...process.env, TEMP: base, TMP: base } });
    expect(run.error).toBeUndefined();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("normal packaged page");
    expect(run.stdout).toContain("unpacked asset");
    expect(run.stdout).toContain("linked assets refused");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}, 45_000);
