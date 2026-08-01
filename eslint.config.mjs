// Flat ESLint config. `.mjs` rather than `.js`: the root package.json has no
// `"type"`, so Node parsed this as CommonJS, failed, and re-parsed it as ESM on
// every single run - printing MODULE_TYPELESS_PACKAGE_JSON each time. Same fix
// as vitest.config.mts.
//
// Fast, non-type-checked preset by design:
// we want quick feedback and no floating-promise noise on a faithful C port.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output, vendored C tree, deps, generated types, coverage, and the
    // CommonJS Electron shims are not linted.
    ignores: [
      "**/dist/**",
      "**/dist-web/**",
      "**/dist-desktop/**",
      "reference/**",
      "node_modules/**",
      "**/*.d.ts",
      "coverage/**",
      "**/*.cjs",
      // Agent worktrees live inside the repo root, so a checkout of this same
      // tree would otherwise be linted a second time with no tsconfig behind
      // it - 1400+ parser errors that say nothing about the source.
      "**/.claude/worktrees/**",
    ],
  },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    // A disable comment that no longer suppresses anything is a claim about the
    // code that has stopped being true. Three had already rotted.
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // ------------------------------------------------------------------
      // OFF, because the rule is wrong about THIS codebase. Measured, not
      // assumed: each note says what was counted on 2026-08-01.
      // ------------------------------------------------------------------

      // 37 hits, and every one sampled was a C-style default-init local that is
      // overwritten before use - `let doStun = false;`, `let hurtMsg = "";`,
      // `let pit = pits[0];`. The C declares them that way and the port mirrors
      // it, so "fixing" them is a deviation. A rule that is wrong 37 times out
      // of 37 does not train anyone to read warnings.
      "no-useless-assignment": "off",
      // 7 hits, 6 of them RNG. The rule assumes conditions are pure, and this
      // port's conditions call the generator: `if (rng.oneIn(3)) ... else if
      // (rng.oneIn(3))` is two independent rolls, not a duplicate. The 7th
      // (borg/src/store/home.ts:645) is real and is a FAITHFUL port of an
      // upstream dead branch, marked as such in place.
      "no-dupe-else-if": "off",
      // Non-null assertions are idiomatic in this port; leave them alone.
      "@typescript-eslint/no-non-null-assertion": "off",

      // ------------------------------------------------------------------
      // ERROR. These reached zero on 2026-08-01 and stay there: 51 unused
      // imports removed, 8 `let`s that were never reassigned, one unbraced case
      // block, one dead escape, three throws that dropped their cause. They
      // were "warn" for months and the count only grew, because a warning in a
      // run of 136 is invisible. Deliberate exceptions carry a per-site
      // eslint-disable naming the C function or the gap - see
      // packages/core/src/dice.ts and packages/borg/src/fight/attack.ts.
      // ------------------------------------------------------------------
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "prefer-const": "error",
      "no-case-declarations": "error",
      "no-useless-escape": "error",
      "no-control-regex": "error",
      "preserve-caught-error": "error",

      // ------------------------------------------------------------------
      // WARN. Still non-zero, and each hit needs a judgement rather than a
      // mechanical fix.
      // ------------------------------------------------------------------
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": "warn",
      "no-constant-condition": ["warn", { checkLoops: false }],
    },
  },
);
