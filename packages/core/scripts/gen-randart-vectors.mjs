#!/usr/bin/env node
/**
 * Regenerate `src/obj/randart-vectors.json` from the code as it stands now.
 *
 * THIS OVERWRITES THE EVIDENCE. The fixture's whole value is that it was
 * recorded before the randart registries existed, so running this converts "the
 * refactor changed nothing" into "the refactor agrees with itself". Only run it
 * when artifact generation is deliberately changing, and say so in the commit
 * message alongside the diff of what moved.
 *
 * Reads `dist/`, so run `pnpm build` first - the same rule the rest of this
 * repo's cross-package work follows.
 *
 *   node packages/core/scripts/gen-randart-vectors.mjs
 */

import { writeFileSync } from "node:fs";
import { computeRandartVectors } from "../dist/obj/randart-vectors.js";
import { randartVectorFixtures } from "../dist/obj/randart-vectors.fixtures.js";

const vectors = computeRandartVectors(randartVectorFixtures());
const out = new URL("../src/obj/randart-vectors.json", import.meta.url);

/* One vector per line: a diff then names the artifact or the ability that
 * moved, instead of reflowing the whole file. */
const body = vectors.map((v) => `  ${JSON.stringify(v)}`).join(",\n");
writeFileSync(out, `[\n${body}\n]\n`, "utf8");

console.log(`[randart-vectors] wrote ${vectors.length} vectors to ${out.pathname}`);
