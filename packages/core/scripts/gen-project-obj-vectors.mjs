/**
 * Record project_o's OBJECT-HANDLER outcomes, exhaustively.
 *
 * project_object_handler is pure - (typ, obj) in, {doKill, ignore, noteKill}
 * out, no rng - so its behaviour can be recorded COMPLETELY rather than
 * sampled. That is the whole reason this file exists: the 37-case terrain
 * switch needed 6,552 sampled vectors because its handlers roll dice; this one
 * does not, so "every projection against every element/flag combination" is a
 * finite table and a total statement.
 *
 * Run before a refactor, replay after:
 *   node packages/core/scripts/gen-project-obj-vectors.mjs
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ELEM, PROJ } from "../dist/generated/index.js";
import { EL_INFO_HATES, EL_INFO_IGNORE } from "../dist/obj/types.js";
import { runObjectHandler } from "../dist/game/project-obj.js";

const FLAGS = [
  ["none", 0],
  ["hates", EL_INFO_HATES],
  ["hates+ignore", EL_INFO_HATES | EL_INFO_IGNORE],
  ["ignore", EL_INFO_IGNORE],
];

const elementNames = Object.keys(ELEM);

/** An object carrying `flags` on exactly one element, and nothing else. */
function oneElement(elem, flags, number) {
  const elInfo = elementNames.map(() => ({ flags: 0, res_level: 0 }));
  elInfo[ELEM[elem]] = { flags, res_level: 0 };
  return { number, elInfo };
}

/** An object that hates EVERY element, which is what separates the multi-element arms. */
function allElements(flags, number) {
  return {
    number,
    elInfo: elementNames.map(() => ({ flags, res_level: 0 })),
  };
}

const subjects = [];
for (const elem of elementNames) {
  for (const [label, flags] of FLAGS) {
    for (const number of [1, 2]) {
      subjects.push({ subject: `${elem}/${label}/n=${number}`, obj: oneElement(elem, flags, number) });
    }
  }
}
for (const [label, flags] of FLAGS) {
  for (const number of [1, 2]) {
    subjects.push({ subject: `ALL/${label}/n=${number}`, obj: allElements(flags, number) });
  }
}

const vectors = [];
for (const [code, typ] of Object.entries(PROJ)) {
  for (const { subject, obj } of subjects) {
    const out = runObjectHandler(typ, obj);
    vectors.push({
      code,
      subject,
      doKill: out.doKill,
      ignore: out.ignore,
      noteKill: out.noteKill,
    });
  }
}

const path = fileURLToPath(
  new URL("../src/game/project-obj-vectors.json", import.meta.url),
);
writeFileSync(path, `${JSON.stringify(vectors, null, 0)}\n`);
console.log(`recorded ${String(vectors.length)} vectors over ${String(subjects.length)} objects`);
