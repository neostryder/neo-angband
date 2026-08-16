/**
 * Regenerate project-feat-vectors.json.
 *
 * THIS OVERWRITES THE EVIDENCE. The file it writes is a recording of what
 * project_f did BEFORE the dispatch switch became a registry, and the test that
 * reads it is the only thing standing between a refactor of live terrain
 * behaviour and a silent parity break. Running this after a change does not
 * prove the change was safe - it erases the record that could have said.
 *
 * Run it only to ADD scenarios to the grid, and only from a tree whose
 * behaviour you have separately established is correct.
 *
 *   node packages/core/scripts/gen-project-feat-vectors.mjs
 *
 * Reads dist/, so `pnpm build` first.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { recordAllProjectFeat } = await import(
  "../dist/game/project-feat-vectors.js"
);
const { projectFeatFixtures } = await import(
  "../dist/game/project-feat-vectors.fixtures.js"
);

const vectors = recordAllProjectFeat(projectFeatFixtures());

/* One vector per line: a diff then names the scenarios that moved instead of
 * reformatting the whole file. */
const body = vectors.map((v) => `  ${JSON.stringify(v)}`).join(",\n");
const out = fileURLToPath(
  new URL("../src/game/project-feat-vectors.json", import.meta.url),
);
writeFileSync(out, `[\n${body}\n]\n`, "utf8");

const changed = vectors.filter((v) => v.feat !== v.terrain).length;
const messages = vectors.reduce((n, v) => n + v.messages.length, 0);
console.log(
  `wrote ${String(vectors.length)} vectors: ${String(changed)} changed the terrain, ` +
    `${String(vectors.filter((v) => v.obvious).length)} were observed, ` +
    `${String(messages)} messages`,
);
