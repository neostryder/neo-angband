// The Worker isolation probe under Electron: the repository's own Electron
// build, the desktop shell's `neo-angband://` scheme with its registered
// privileges, its cross-origin isolation headers and its window sandbox. The
// main process is a small stand-in for the shell (fixtures/mod-isolation-
// electron-main.mjs), because the packaged-app fixture beside this file needs a
// release build on disk; what the probe depends on is the scheme, the headers
// and the webPreferences, and those are the shell's own.
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { buildProbeFiles, GAME_SECRETS, isolatedResults, NETWORK_CHECKS, STORAGE_CHECKS, type IsolatedRun, type ProbeResults } from "./mod-isolation.fixture.js";

const root = path.resolve(__dirname, "..", "..");
const desktopRequire = createRequire(path.join(root, "packages", "desktop", "package.json"));

let app: ElectronApplication;
let page: Page;
let scratch: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "neo-angband-isolation-"));
  const files = await buildProbeFiles();
  const filesPath = path.join(scratch, "files.json");
  fs.writeFileSync(filesPath, JSON.stringify(files.files));
  const esbuild = (await import(pathToFileURL(desktopRequire.resolve("esbuild")).href)) as {
    build(options: Record<string, unknown>): Promise<unknown>;
  };
  const mainPath = path.join(scratch, "main.cjs");
  await esbuild.build({
    entryPoints: [path.join(__dirname, "fixtures", "mod-isolation-electron-main.mjs")],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: mainPath,
    logLevel: "warning",
  });
  app = await electron.launch({
    executablePath: desktopRequire("electron") as unknown as string,
    args: [mainPath, `--user-data-dir=${path.join(scratch, "profile")}`],
    env: { ...process.env, NEO_ANGBAND_PROBE_FILES: filesPath },
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => "probeIsolated" in window);
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(scratch, { recursive: true, force: true });
});

async function hits(): Promise<Record<string, number>> {
  return app.evaluate(() => ({ ...(globalThis as unknown as { probeHits: Record<string, number> }).probeHits }));
}

test("the game window is the shell's cross-origin-isolated neo-angband:// origin", async () => {
  const facts = await page.evaluate(() => ({ origin: location.origin, isolated: crossOriginIsolated, secure: isSecureContext }));
  console.log(`electron page: ${JSON.stringify(facts)}`);
  expect(facts).toEqual({ origin: "neo-angband://game", isolated: true, secure: true });
});

for (const lockDown of [true, false]) {
  test(`an isolated Worker mod reaches no storage and no network under Electron (global lockdown ${lockDown ? "on" : "off"})`, async () => {
    test.setTimeout(90_000);
    const before = await hits();
    const run = await page.evaluate((flag) => (window as unknown as { probeIsolated(flag: boolean): Promise<IsolatedRun> }).probeIsolated(flag), lockDown);
    const after = await hits();
    console.log(`electron isolated lockdown=${String(lockDown)}: ${JSON.stringify(run)} hits before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    expect(run.failure).toBeNull();
    expect(run.problems).toEqual([]);
    expect(run.framesWhileRunning).toBe(1);
    expect(run.framesAfterTeardown).toBe(0);
    const results = isolatedResults(run);
    expect(results["origin"]).toBe("null");
    for (const check of NETWORK_CHECKS) expect.soft(results[check], check).toMatch(/^blocked:/u);
    for (const check of STORAGE_CHECKS) expect.soft(results[check], check).not.toMatch(GAME_SECRETS);
    expect.soft(results["eval"]).toMatch(/^blocked:/u);
    expect.soft(results["nestedWorker"]).not.toBe("open:fetched");
    if (lockDown) expect.soft(results["globals"]).toBe("");
    for (const check of STORAGE_CHECKS) expect.soft(results[check], check).toMatch(/^blocked:/u);
    expect(after).toEqual(before);
  });
}

test("the control under Electron: a plain Worker of the game's origin reaches the game's store", async () => {
  test.setTimeout(90_000);
  const before = await hits();
  const results = await page.evaluate(() => (window as unknown as { probeControl(): Promise<ProbeResults> }).probeControl());
  const after = await hits();
  console.log(`electron control: ${JSON.stringify(results)} hits before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  expect(results["origin"]).toBe("neo-angband://game");
  expect(results["indexedDB"]).toBe("open:game-secret");
  expect(results["fetchGame"]).toBe("open:game-secret-file");
  /* The counters in the main process see the control's requests, so an empty
   * difference in the isolated runs means nothing left the frame. */
  expect(after["/secret.txt"] ?? 0).toBeGreaterThan(before["/secret.txt"] ?? 0);
  expect(after["remote.test"] ?? 0).toBeGreaterThan(before["remote.test"] ?? 0);
});
