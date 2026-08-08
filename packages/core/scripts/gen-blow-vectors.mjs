#!/usr/bin/env node
/**
 * Regenerate `src/combat/blow-vectors.json` from the code as it stands now.
 *
 * THIS OVERWRITES THE EVIDENCE. The fixture's whole value is that it was
 * recorded before the blow-effect registry existed, so running this converts
 * "the refactor changed nothing" into "the refactor agrees with itself". Only
 * run it when a blow's behaviour is deliberately changing, and say so in the
 * commit message alongside the diff of what moved.
 *
 * Reads `dist/`, so run `pnpm build` first - the same rule the rest of this
 * repo's cross-package work follows.
 *
 *   node packages/core/scripts/gen-blow-vectors.mjs
 */

import { writeFileSync } from "node:fs";
import { computeBlowVectors } from "../dist/combat/blow-vectors.js";
import { blowVectorFixtures } from "../dist/combat/blow-vectors.fixtures.js";

const vectors = computeBlowVectors(blowVectorFixtures());
const out = new URL("../src/combat/blow-vectors.json", import.meta.url);

/* One vector per line: a diff then names the blow that moved, instead of
 * reflowing the whole file. */
const body = vectors.map((v) => `  ${JSON.stringify(v)}`).join(",\n");
writeFileSync(out, `[\n${body}\n]\n`, "utf8");

console.log(`[blow-vectors] wrote ${vectors.length} vectors to ${out.pathname}`);
