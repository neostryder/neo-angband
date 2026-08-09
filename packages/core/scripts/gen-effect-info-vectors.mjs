#!/usr/bin/env node
/**
 * Regenerate `src/effects/effect-info-vectors.json` from the code as it stands
 * now.
 *
 * THIS OVERWRITES THE EVIDENCE. The fixture's whole value is that it was
 * recorded before the effect-info registry existed, so running this converts
 * "the refactor changed nothing" into "the refactor agrees with itself". Only
 * run it when what the game SAYS about an effect is deliberately changing, and
 * say so in the commit message alongside the diff of what moved.
 *
 * Reads `dist/`, so run `pnpm build` first - the same rule the rest of this
 * repo's cross-package work follows.
 *
 *   node packages/core/scripts/gen-effect-info-vectors.mjs
 */

import { writeFileSync } from "node:fs";
import { computeEffectInfoVectors } from "../dist/effects/effect-info-vectors.js";
import { effectInfoVectorFixtures } from "../dist/effects/effect-info-vectors.fixtures.js";

const vectors = computeEffectInfoVectors(effectInfoVectorFixtures());
const out = new URL("../src/effects/effect-info-vectors.json", import.meta.url);

/* One vector per line: a diff then names the effect and the scenario that
 * moved, instead of reflowing the whole file. */
const body = vectors.map((v) => `  ${JSON.stringify(v)}`).join(",\n");
writeFileSync(out, `[\n${body}\n]\n`, "utf8");

console.log(`[effect-info-vectors] wrote ${vectors.length} vectors to ${out.pathname}`);
