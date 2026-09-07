// Shared fixture for tests that exercise the packaged Windows desktop build.
// The package is launched with a short-lived profile beneath the supplied audit
// directory, keeping these tests away from any installed player's profile.
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { test as base, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const AUDIT_ROOT = "C:\\Temp\\na\\audit-1.10.2";
const executablePath =
  process.env.NEO_ANGBAND_ELECTRON_EXECUTABLE ?? path.join(AUDIT_ROOT, "app", "Neo Angband.exe");
const userDataRoot = process.env.NEO_ANGBAND_ELECTRON_USER_DATA_ROOT ?? AUDIT_ROOT;

type ElectronTestFixtures = {
  gamePage: Page;
};

type ElectronWorkerFixtures = {
  electronApp: ElectronApplication;
};

export type ObservedKeyEvent = {
  type: string;
  key: string;
  code: string;
  ctrlKey: boolean;
};

declare global {
  interface Window {
    electronKeyEvents: ObservedKeyEvent[];
  }
}

export const test = base.extend<ElectronTestFixtures, ElectronWorkerFixtures>({
  electronApp: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires object destructuring here.
    async ({}, use) => {
      const userDataDirectory = fs.mkdtempSync(path.join(userDataRoot, "playwright-electron-"));
      let electronApp: ElectronApplication | undefined;

      try {
        electronApp = await electron.launch({
          executablePath,
          args: [`--user-data-dir=${userDataDirectory}`],
        });
        await use(electronApp);
      } finally {
        await electronApp?.close();
        fs.rmSync(userDataDirectory, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
  gamePage: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await page.addInitScript(() => {
      const events: ObservedKeyEvent[] = [];
      const record = (event: KeyboardEvent): void => {
        events.push({
          type: event.type,
          key: event.key,
          code: event.code,
          ctrlKey: event.ctrlKey,
        });
      };

      window.addEventListener("keydown", record, true);
      window.addEventListener("keyup", record, true);
      window.electronKeyEvents = events;
    });
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.body.innerText.includes("Neo Angband"));
    await page.bringToFront();
    await use(page);
  },
});

export { expect };
