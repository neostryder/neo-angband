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
    exclude: [
      ...defaultExclude,
      "**/.claude/worktrees/**",
      // Sibling checkouts from the pre-.claude/worktrees era.
      "na-wt-*/**",
      ".integration-*/**",
      "reference/**",
    ],
  },
});
