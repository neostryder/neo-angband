// Proves each configured engine actually launches and can be scripted. It
// touches no game code on purpose: when a real spec fails, this one answers
// whether the engine itself is the problem.
import { expect, test } from "@playwright/test";

test("engine launches and evaluates in-page", async ({ page, browserName }) => {
  await page.goto("about:blank");
  const answer = await page.evaluate(() => 6 * 7);
  expect(answer).toBe(42);
  const ua = await page.evaluate(() => navigator.userAgent);
  expect(ua.length).toBeGreaterThan(0);
  console.log(`${browserName}: ${ua}`);
});
