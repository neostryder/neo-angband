/**
 * Guard the RUNNER, not the engine: notice when vitest starts collecting files
 * it should not.
 *
 * `tsc -b` compiles the tests too, so after a build there is a *.test.js beside
 * every *.test.ts under packages/<pkg>/dist. Vitest 3 skipped those because its
 * `defaultExclude` contained `**\/dist/**`; vitest 4 shrank that default to
 * node_modules and .git, and the root config spread the default rather than
 * naming dist itself. The measured effect of the upgrade, before this file
 * existed: 375 test files became 750.
 *
 * Running each test twice is the harmless half. The harmful half is that dist is
 * STALE between builds, so the duplicate run grades an older edit of the same
 * test and reports it beside the current one - two verdicts on one file, and no
 * indication which is which. The same trap took the suite for a ride once
 * already with agent worktrees, where 310 duplicate files let a stale branch
 * decide a run on master.
 *
 * The comment in vitest.config.mts explains the exclusion; a comment is not a
 * mechanism. This is the mechanism, and it works by being collected: if the
 * exclusion is ever dropped, the dist COPY of this file runs, sees `dist` in its
 * own path, and fails. Delete `**\/dist/**` from the config, build, and watch it
 * go red - that is the only way to know a guard can fire.
 */

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

describe("what vitest collects", () => {
  it("is running this test from source, not from build output", () => {
    const self = fileURLToPath(import.meta.url).replaceAll("\\", "/");
    /* Deliberately checks the path SEGMENT. A package legitimately named
     * something-dist, or a checkout under C:/dist-work, must not trip it. */
    const segments = self.split("/");
    expect(
      segments,
      `collected from build output: ${self} - vitest.config.ts must exclude **/dist/**`,
    ).not.toContain("dist");
  });

  it("is running this test from the checkout, not from an agent worktree", () => {
    const self = fileURLToPath(import.meta.url).replaceAll("\\", "/");
    expect(self, `collected from a worktree: ${self}`).not.toMatch(/\.claude\/worktrees\//u);
  });
});
