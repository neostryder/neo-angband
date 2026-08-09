#!/usr/bin/env node
/**
 * Regenerate `src/gen/glyph-vectors.json` from the code as it stands now.
 *
 * THIS OVERWRITES THE EVIDENCE. The fixture's whole value is that it was
 * recorded before the glyph registry existed, so running this converts "the
 * refactor changed nothing" into "the refactor agrees with itself". Only run it
 * when a glyph's decoding is deliberately changing, and say so in the commit
 * message alongside the diff of what moved.
 *
 * Reads `dist/`, so run `pnpm build` first - the same rule the rest of this
 * repo's cross-package work follows.
 *
 *   node packages/core/scripts/gen-glyph-vectors.mjs
 */

import { writeFileSync } from "node:fs";
import { computeGlyphVectors } from "../dist/gen/glyph-vectors.js";
import { glyphVectorFixtures } from "../dist/gen/glyph-vectors.fixtures.js";

const vectors = computeGlyphVectors(glyphVectorFixtures());
const out = new URL("../src/gen/glyph-vectors.json", import.meta.url);

/* One vector per line: a diff then names the template or vault that moved,
 * instead of reflowing the whole file. */
const body = vectors.map((v) => `  ${JSON.stringify(v)}`).join(",\n");
writeFileSync(out, `[\n${body}\n]\n`, "utf8");

console.log(`[glyph-vectors] wrote ${vectors.length} vectors to ${out.pathname}`);
