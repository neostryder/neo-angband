// Playwright configuration for the browser-engine test lane.
//
// Three projects, one per engine, so a spec can be run against Chromium, Gecko
// and WebKit from the same invocation:
//
//   pnpm test:e2e                 all three browser engines
//   pnpm test:e2e:electron        packaged desktop app
//
// WebKit is the reason this lane exists. Windows has no Safari, so Playwright's
// bundled WebKit build is the only real WebKit engine available on this
// platform; a Chromium-only pass says nothing about how the web front end
// behaves there.
//
// Deliberately minimal: no `webServer` and no `baseURL`. A spec that needs the
// web front end running is responsible for starting and addressing it, because
// the front end has several launch shapes (dev server, built bundle, installed
// PWA, Electron) and hard-coding one here would quietly constrain the rest.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // Engine binaries live outside the repository, in the Playwright browser
  // cache, so a machine that has not run `playwright install` fails loudly
  // rather than skipping an engine and reporting a pass it never earned.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  projects: [
    {
      name: "chromium",
      testIgnore: "**/*.electron.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      testIgnore: "**/*.electron.spec.ts",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: "**/*.electron.spec.ts",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "electron",
      testMatch: "**/*.electron.spec.ts",
      workers: 1,
    },
  ],
});
