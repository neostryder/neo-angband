#!/usr/bin/env node
/**
 * Regenerate `src/obj/tval-vectors.json` from the code as it stands now.
 *
 * THIS OVERWRITES THE EVIDENCE. The fixture's whole value is that it was
 * recorded before the tval registry existed, so running this converts "the
 * refactor changed nothing" into "the refactor agrees with itself". Run it only
 * when a predicate's answer is deliberately changing - or when a predicate or a
 * tval is deliberately ADDED, which is the other way the table legitimately
 * grows - and say which, in the commit message, alongside the diff of what
 * moved.
 *
 * Reads `dist/`, so run `pnpm build` first - the same rule the rest of this
 * repo's cross-package work follows.
 *
 *   node packages/core/scripts/gen-tval-vectors.mjs
 */

import { writeFileSync } from "node:fs";
import { computeTvalVectors } from "../dist/obj/tval-vectors.js";

const vectors = computeTvalVectors();
const out = new URL("../src/obj/tval-vectors.json", import.meta.url);

/* One vector per line, so a diff names the item class that moved instead of
 * reflowing the whole file. */
const body = vectors.map((v) => `  ${JSON.stringify(v)}`).join(",\n");
writeFileSync(out, `[\n${body}\n]\n`, "utf8");

const predicates = Object.keys(vectors[0]?.answers ?? {}).length;
console.log(
  `[tval-vectors] wrote ${vectors.length} tvals x ${predicates} predicates ` +
    `(${vectors.length * predicates} answers) to ${out.pathname}`,
);
