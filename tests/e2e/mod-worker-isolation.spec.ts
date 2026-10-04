// Real-engine proof for the API-2 Worker isolation (packages/web/src/mod-worker/
// isolation.ts): a probe mod, run in the opaque-origin sandbox frame, tries every
// store and every way out it can name, and the page's request log records any
// request that left. The same probe run as a plain Worker of the game's origin
// is the control: it shows each check can see an open door.
//
// The game origin is a fake `https://game.test` answered by page.route, so no
// server is started and nothing reaches the network.
import { expect, test, type Page } from "@playwright/test";
import { buildProbeFiles, GAME_SECRETS, isolatedResults, NETWORK_CHECKS, STORAGE_CHECKS, type IsolatedRun, type ProbeFiles, type ProbeResults } from "./mod-isolation.fixture.js";

const GAME = "https://game.test";

let files: ProbeFiles;
test.beforeAll(async () => {
  files = await buildProbeFiles();
});

async function openGame(page: Page): Promise<Map<string, number>> {
  const hits = new Map<string, number>();
  const count = (key: string): void => { hits.set(key, (hits.get(key) ?? 0) + 1); };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === GAME) {
      const file = files.files[url.pathname];
      if (["/secret.txt", "/remote-module.js", "/events"].includes(url.pathname)) count(url.pathname);
      await (file === undefined
        ? route.fulfill({ status: 404, body: "" })
        : route.fulfill({ status: 200, body: file.body, contentType: file.type, headers: { "access-control-allow-origin": "*" } }));
      return;
    }
    count(url.host);
    await route.fulfill({ status: 200, body: "", headers: { "access-control-allow-origin": "*" } });
  });
  await page.routeWebSocket(/remote\.test/u, () => count("websocket"));
  await page.goto(`${GAME}/`);
  await page.waitForFunction(() => "probeIsolated" in window);
  return hits;
}

for (const lockDown of [true, false]) {
  test(`an isolated Worker mod reaches no storage and no network (global lockdown ${lockDown ? "on" : "off"})`, async ({ page, browserName }) => {
    test.setTimeout(90_000);
    const hits = await openGame(page);
    const run = await page.evaluate((flag) => (window as unknown as { probeIsolated(flag: boolean): Promise<IsolatedRun> }).probeIsolated(flag), lockDown);
    console.log(`${browserName} isolated lockdown=${String(lockDown)}: ${JSON.stringify(run)} hits=${JSON.stringify([...hits])}`);
    expect(run.failure).toBeNull();
    expect(run.problems).toEqual([]);
    expect(run.framesWhileRunning).toBe(1);
    expect(run.framesAfterTeardown).toBe(0);
    const results = isolatedResults(run);
    expect(results["origin"]).toBe("null");
    for (const check of NETWORK_CHECKS) expect.soft(results[check], check).toMatch(/^blocked:/u);
    for (const check of STORAGE_CHECKS) expect.soft(results[check], check).not.toMatch(GAME_SECRETS);
    expect.soft(results["eval"]).toMatch(/^blocked:/u);
    /* A nested Worker inherits the opaque origin and the policy, so even where
     * one may start, its own fetch is refused. */
    expect.soft(results["nestedWorker"]).not.toBe("open:fetched");
    if (lockDown) {
      expect.soft(results["globals"]).toBe("");
      for (const check of STORAGE_CHECKS) expect.soft(results[check], check).toMatch(/^blocked:/u);
    }
    expect([...hits]).toEqual([]);
  });
}

test("the control: a plain Worker of the game's origin reaches the game's store", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  const hits = await openGame(page);
  const results = await page.evaluate(() => (window as unknown as { probeControl(): Promise<ProbeResults> }).probeControl());
  console.log(`${browserName} control: ${JSON.stringify(results)} hits=${JSON.stringify([...hits])}`);
  expect(results["origin"]).toBe(GAME);
  expect(results["indexedDB"]).toBe("open:game-secret");
  expect(results["caches"]).toBe("open:[neo-angband-isolation-probe]");
  expect(results["eval"]).toBe("open:42");
  expect(results["remoteImport"]).toBe("open:reached");
});
