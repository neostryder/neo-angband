/**
 * Put the served tilesets in place before any test collects, if they are absent.
 *
 * WHY THIS EXISTS, and it is a gate defect rather than a convenience. The
 * documented local gate is "run `pnpm build` first, or believe nothing about a
 * cross-package change" (CLAUDE.md). But the root `build` script is `tsc -b`,
 * which does NOT run each package's own `build` - so it never reaches
 * `packages/web/scripts/sync-tiles.mjs`. `packages/web/public/tiles` is
 * gitignored and generated, so a fresh clone or a fresh agent worktree that
 * follows the documented procedure exactly gets failures in
 * `tile-catalog.test.ts` and `linoleum-equivalence.test.ts` that are about
 * missing art and say nothing about the code.
 *
 * The dangerous half is the other direction. An established checkout PASSES
 * those tests - not because the documented gate provides the art, but because
 * some earlier `pnpm --dir packages/web bundle` or `dev` left it behind. So the
 * documented gate had never been the thing making them pass locally, and the
 * only reason CI stayed green is that `ci.yml` runs `bundle` (which does call
 * sync-tiles) before `pnpm test`. A green run resting on a leftover artefact is
 * the shape this project keeps re-earning: the check that passes for a reason
 * nobody wrote down stops being evidence the moment the leftover is gone.
 *
 * CHEAP ON THE COMMON PATH, deliberately. sync-tiles compares bytes across
 * every served file, which is not something to pay on `vitest run <one file>`.
 * So this only looks for the generated tree and runs the script when it is not
 * there. Keeping the tree CURRENT is a different question and already has its
 * own answer: `sync-tiles.mjs --check`, which reports stale and differing files
 * and is what should judge that, not a setup hook that would hide a difference
 * by silently repairing it.
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVED = join(ROOT, "packages", "web", "public", "tiles");
const SYNC = join(ROOT, "packages", "web", "scripts", "sync-tiles.mjs");

/** Our own committed files live there too, so their presence proves nothing. */
const OURS = new Set(["CREDITS.md"]);

export function setup() {
  let generated = [];
  try {
    generated = readdirSync(SERVED).filter((name) => !OURS.has(name));
  } catch {
    /* The whole tree is absent, which is the fresh-clone case. */
  }
  if (generated.length > 0) return;
  console.log("vitest: packages/web/public/tiles is empty; running sync-tiles");
  execFileSync(process.execPath, [SYNC], { cwd: ROOT, stdio: "inherit" });
}
