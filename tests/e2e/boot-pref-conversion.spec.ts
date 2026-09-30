// Boots the built web front end with an old-style user pref file that still
// carries a subwindow layout, the state a player is in the first time a JSON
// build meets a profile whose layout document is missing. Converting that file
// runs during boot, before most of main.ts has initialized, so applying the
// converted layout there reached the graphics menus while they were still
// undefined and stopped the game on the crash screen.
//
// Needs `pnpm -C packages/web bundle` first; the spec serves dist-web itself.
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { expect, test } from "@playwright/test";

const DIST = join(__dirname, "..", "..", "packages", "web", "dist-web");

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};

let server: Server;
let origin = "";

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    /* A page on the same origin that runs no game code, so storage can be
     * seeded before the first boot rather than after a throwaway one. */
    if (path === "/blank.html") {
      res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>blank</title>");
      return;
    }
    const file = normalize(join(DIST, path === "/" ? "index.html" : path));
    if (!file.startsWith(normalize(DIST))) {
      res.writeHead(403).end();
      return;
    }
    readFile(file).then(
      (body) => res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body),
      () => res.writeHead(404).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no server address");
  origin = `http://127.0.0.1:${String(address.port)}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("a pref file with a subwindow layout converts at boot without crashing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  const layout = JSON.stringify({
    enabled: { messages: true },
    tree: {
      kind: "split", axis: "v", ratio: 0.7,
      first: { kind: "leaf", id: "main" }, second: { kind: "leaf", id: "messages" },
    },
    mapTileMode: 0,
  });
  await page.goto(`${origin}/blank.html`);
  await page.evaluate((line) => {
    localStorage.clear();
    localStorage.setItem("neo-angband-user:Bilbo.prf", `color:1:0:4:5:6\n${line}`);
  }, `neo-subwindows:${layout}`);

  await page.goto(`${origin}/index.html`);
  /* The converter removes the old file only after every document, the layout
   * included, has been written and applied, so its absence means boot got
   * through the conversion. */
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("neo-angband-user:Bilbo.prf")), { timeout: 30_000 })
    .toBeNull();
  /* The failure was an async rejection that landed after the old file was
   * removed, so let boot settle for a couple of frames before looking. */
  await page.waitForFunction(() => document.body.innerText.includes("Neo Angband"));
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  await expect(page.getByText("Neo Angband hit a bug and stopped.")).toHaveCount(0);
  expect(errors).toEqual([]);

  const stored = await page.evaluate(() => localStorage.getItem("neo-angband:subwindows"));
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored ?? "{}").data.enabled.messages).toBe(true);
});
