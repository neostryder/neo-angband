/**
 * The service worker's navigation fallback, and the one page it must not answer.
 *
 * The generated worker binds every navigation to index.html, which is the right
 * behaviour for a single-page game: a deep link lands on the title screen rather
 * than a 404. It is also, with no denylist, the behaviour for the one path on
 * this origin that is a real document - public/docs/index.html, the page the
 * title screen's first link points at.
 *
 * That bug was invisible from outside and total from inside. A worker intercepts
 * before the network, so anyone with one installed - which is everyone after
 * their first visit, and always the installed app - got the game back instead of
 * the docs. Anyone checking the URL with a fetch got the redirect and concluded
 * the link was fine.
 *
 * Both halves are DERIVED here rather than written down: the denied paths come
 * out of vite.config.ts, and the link comes out of the title screen's own runs.
 * A hardcoded "/docs" on either side would keep passing after the link moved,
 * which is the same shape of silence the bug already had.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_INFORMATION } from "./news";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The `navigateFallbackDenylist` patterns, read from the build config.
 *
 * Scanned rather than matched with one regex. The obvious `\[([^\]]*)\]` stops
 * at the first `]` in the array, which is fine until a pattern contains a
 * character class - and the pattern this file exists to protect contains
 * `[?#]`. That truncated the array mid-literal, found no regex in the remains,
 * and failed every case here with "declared but empty" while the config was
 * correct. A parser that breaks on the very syntax its subject needs is worse
 * than no parser, so this walks the array instead and knows when it is inside
 * a literal.
 */
function denylist(): RegExp[] {
  const config = readFileSync(join(webRoot, "vite.config.ts"), "utf8");
  const key = config.indexOf("navigateFallbackDenylist:");
  expect(key, "vite.config.ts declares no navigateFallbackDenylist").toBeGreaterThan(-1);

  const open = config.indexOf("[", key);
  expect(open, "navigateFallbackDenylist is not an array literal").toBeGreaterThan(-1);

  const patterns: RegExp[] = [];
  let i = open + 1;
  while (i < config.length && config[i] !== "]") {
    if (config[i] !== "/") {
      i += 1;
      continue;
    }
    /* A regex literal: everything to the next unescaped `/`, then its flags. */
    let j = i + 1;
    let source = "";
    while (j < config.length && config[j] !== "/") {
      if (config[j] === "\\") {
        source += config.slice(j, j + 2);
        j += 2;
        continue;
      }
      source += config[j];
      j += 1;
    }
    let flags = "";
    j += 1;
    while (j < config.length && /[gimsuy]/u.test(config[j] ?? "")) {
      flags += config[j];
      j += 1;
    }
    patterns.push(new RegExp(source, flags));
    i = j;
  }

  expect(patterns.length, "the denylist is declared but empty").toBeGreaterThan(0);
  return patterns;
}

/** Every external link the title screen actually paints. */
function titleHrefs(): string[] {
  return PROJECT_INFORMATION.flatMap((line) => line.runs ?? [])
    .map((run) => run.href)
    .filter((href): href is string => href !== undefined);
}

describe("the /docs page is reachable from inside the installed app", () => {
  it("denies the navigation fallback for the docs link the title screen paints", () => {
    const docs = titleHrefs().filter((href) => new URL(href).host.endsWith("rpgm.world"));
    expect(docs, "the title screen paints no link on this project's own site").not.toEqual([]);
    const patterns = denylist();
    for (const href of docs) {
      const { pathname } = new URL(href);
      expect(
        patterns.some((p) => p.test(pathname)),
        `${href} would be answered with index.html, not the page itself`,
      ).toBe(true);
    }
  });

  it("denies both spellings of the path, since the link carries no trailing slash", () => {
    /* GitHub Pages 301s /docs to /docs/, and the worker never lets that request
     * reach it. Covering only the slashed form would deny the redirect target
     * and swallow the link that is actually painted. */
    const patterns = denylist();
    expect(patterns.some((p) => p.test("/docs"))).toBe(true);
    expect(patterns.some((p) => p.test("/docs/"))).toBe(true);
  });

  it("denies the path when a query string or fragment is attached", () => {
    /* Workbox matches a navigation against `pathname + search`, not the path on
     * its own, so a pattern anchored with a bare `$` stops matching the moment
     * anything is appended. That is not a hypothetical spelling: it is what a
     * link shared through anywhere that tags its outbound URLs looks like, and
     * it would have been swallowed silently while the plain path worked. */
    const patterns = denylist();
    for (const path of ["/docs?utm_source=discord", "/docs/?ref=x", "/docs#quick-start"]) {
      expect(
        patterns.some((p) => p.test(path)),
        `${path} would be answered with index.html, not the page itself`,
      ).toBe(true);
    }
  });

  it("still falls back to the game for the paths a deep link uses", () => {
    /* The denylist is a hole in a rule that is otherwise correct. A pattern
     * loose enough to catch the game's own entry points would turn every
     * refresh of a running install into a network request, and an offline one
     * into a failure. */
    const patterns = denylist();
    for (const path of ["/", "/index.html", "/play", "/documentation", "/docs-old"]) {
      expect(
        patterns.some((p) => p.test(path)),
        `${path} is excluded from the fallback and would not load offline`,
      ).toBe(false);
    }
  });
});
