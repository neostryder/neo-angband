#!/usr/bin/env node
/**
 * Regenerate `src/store/mass-produce-vectors.json` from the code as it stands.
 *
 * THIS OVERWRITES THE EVIDENCE. The fixture's value is that it was recorded
 * before `massProduce` became a registry; running this turns "the refactor
 * changed nothing" into "the refactor agrees with itself". Only run it when a
 * store's stack sizes are deliberately changing, and say so in the commit.
 *
 * Reads `dist/`, so run `pnpm build` first.
 */

import { writeFileSync } from "node:fs";
import { computeMassProduceVectors } from "../dist/store/mass-produce-vectors.js";
import { massProduceFixtures } from "../dist/store/mass-produce-vectors.fixtures.js";

const vectors = computeMassProduceVectors(massProduceFixtures());
const out = new URL("../src/store/mass-produce-vectors.json", import.meta.url);
const body = vectors.map((v) => `  ${JSON.stringify(v)}`).join(",\n");
writeFileSync(out, `[\n${body}\n]\n`, "utf8");
console.log(`[mass-produce-vectors] wrote ${vectors.length} vectors`);
