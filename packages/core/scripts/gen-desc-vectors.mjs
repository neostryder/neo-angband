#!/usr/bin/env node
/**
 * Regenerate `src/obj/desc-vectors.json` from the code as it stands now.
 *
 * THIS OVERWRITES THE EVIDENCE. The fixture's whole value is that it was
 * recorded before the naming registry existed, so running this converts "the
 * refactor changed nothing" into "the refactor agrees with itself". Run it only
 * when a name is deliberately changing - or when the pack gains an item class,
 * which is the other way the table legitimately grows - and say which, in the
 * commit message, alongside the diff of what moved.
 *
 * Reads `dist/`, so run `pnpm build` first - the same rule the rest of this
 * repo's cross-package work follows.
 *
 *   node packages/core/scripts/gen-desc-vectors.mjs
 */

import { writeFileSync } from "node:fs";
import { computeDescVectors } from "../dist/obj/desc-vectors.js";
import { descVectorFixtures } from "../dist/obj/desc-vectors.fixtures.js";
import { TVAL_ENTRIES } from "../dist/generated/tvals.js";

const tvalName = (tval) => TVAL_ENTRIES[tval]?.name ?? `TVAL_${String(tval)}`;
const vectors = computeDescVectors(descVectorFixtures(), tvalName);
const out = new URL("../src/obj/desc-vectors.json", import.meta.url);

/* One vector per line, so a diff names the item that moved instead of
 * reflowing the whole file. */
const body = vectors.map((v) => `  ${JSON.stringify(v)}`).join(",\n");
writeFileSync(out, `[\n${body}\n]\n`, "utf8");

const axes = new Set(vectors.map((v) => v.axes)).size;
console.log(
  `[desc-vectors] wrote ${vectors.length} descriptions ` +
    `(${vectors.length / axes} kinds x ${axes} axes) to ${out.pathname}`,
);
