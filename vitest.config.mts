import { defaultExclude, defineConfig } from "vitest/config";

/**
 * Root test config. The only thing it changes is WHERE tests are collected from.
 *
 * Agent worktrees live inside the repo (.claude/worktrees/<branch>), and the
 * older ones were plain sibling directories, so each one is a second checkout of
 * this same tree - with its own copy of every *.test.ts. Vitest's default globs
 * happily collect those too, which ran the whole suite twice (310 duplicate test
 * files at the time this was added) and let a stale branch's tests decide the
 * result of a run on master. `pnpm lint` had the same problem and the same fix
 * (eslint.config.js ignores).
 */
export default defineConfig({
  test: {
    /*
     * Generates packages/web/public/tiles when it is absent. The root `build`
     * script is `tsc -b` and never runs sync-tiles, so the documented local
     * gate does not supply the art two web tests need - and an established
     * checkout only passes them because an earlier `bundle` left it behind.
     * See tools/vitest-global-setup.mjs.
     */
    globalSetup: ["./tools/vitest-global-setup.mjs"],
    exclude: [
      ...defaultExclude,
      /*
       * `**\/dist/**` is written down here rather than inherited, because vitest 4
       * shrank `defaultExclude` to just node_modules and .git. `tsc -b` emits a
       * compiled *.test.js next to every *.test.ts, so the moment that default
       * changed, the run went from 375 files to 750 - each test collected once
       * from source and once from whatever the last build left behind. That is
       * worse than a slow suite: dist is STALE by definition between builds, so
       * half the run would have been grading a previous edit. Measured on
       * vitest 4.1.10; the duplicate half was exactly 375 files.
       */
      "**/dist/**",
      "**/.claude/worktrees/**",
      // Sibling checkouts from the pre-.claude/worktrees era.
      "na-wt-*/**",
      ".integration-*/**",
      "reference/**",
    ],
  },
});
