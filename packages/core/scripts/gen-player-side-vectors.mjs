/**
 * Regenerate player-side-vectors.json.
 *
 * THIS OVERWRITES THE EVIDENCE. The file it writes is a recording of what
 * project_p did BEFORE the dispatch switch became a registry, and the test that
 * reads it is the only thing standing between a refactor of live player
 * behaviour and a silent parity break. Running this after a change does not
 * prove the change was safe - it erases the record that could have said.
 *
 * Run it only to ADD scenarios to the grid, and only from a tree whose
 * behaviour you have separately established is correct.
 *
 *   node packages/core/scripts/gen-player-side-vectors.mjs
 *
 * Reads dist/, so `pnpm build` first.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { recordAllPlayerSide } = await import(
  "../dist/game/player-side-vectors.js"
);
const { playerSideFixtures } = await import(
  "../dist/game/player-side-vectors.fixtures.js"
);

const vectors = recordAllPlayerSide(playerSideFixtures());

/* One vector per line: a diff then names the scenarios that moved instead of
 * reformatting the whole file. */
const body = vectors.map((v) => `  ${JSON.stringify(v)}`).join(",\n");
const out = fileURLToPath(
  new URL("../src/game/player-side-vectors.json", import.meta.url),
);
writeFileSync(out, `[\n${body}\n]\n`, "utf8");

const messages = vectors.reduce((n, v) => n + v.messages.length, 0);
const moved = vectors.filter(
  (v) => v.grid[0] !== vectors[0].grid[0] || v.grid[1] !== vectors[0].grid[1],
).length;
console.log(
  `wrote ${vectors.length} vectors: ${messages} messages, ` +
    `${vectors.filter((v) => v.timed.length > 0).length} left a timed effect, ` +
    `${vectors.filter((v) => v.xtra > 0).length} returned extra damage, ` +
    `${moved} moved the player`,
);
console.log(
  `distinct messages: ${new Set(vectors.flatMap((v) => v.messages)).size}`,
);
