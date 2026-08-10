#!/usr/bin/env node
/**
 * Regenerate `src/obj/rune-vectors.json` from the code as it stands now.
 *
 * THIS OVERWRITES THE EVIDENCE. The fixture's whole value is that it was
 * recorded before `RuneRegistry` existed, so running this converts "the
 * refactor changed nothing" into "the refactor agrees with itself". Run it only
 * when a rune's name, description, learn message or object test is deliberately
 * changing - or when the pack deliberately gains a rune, which is the other way
 * the grid legitimately grows - and say which, in the commit message, alongside
 * the diff of what moved.
 *
 * Reads `dist/`, so run `pnpm build` first - the same rule the rest of this
 * repo's cross-package work follows.
 *
 *   node packages/core/scripts/gen-rune-vectors.mjs
 */

import { writeFileSync } from "node:fs";

import { TV } from "../dist/generated/tvals.js";
import { recordRuneVectors } from "../dist/obj/rune-vectors.js";
import { runeVectorWorld } from "../dist/obj/rune-vectors.fixtures.js";

const vectors = recordRuneVectors(runeVectorWorld(), TV.RING);

/* One row per line, so a diff names the rune that moved instead of reflowing
 * the whole file. */
const runes = vectors.runes.map((v) => `    ${JSON.stringify(v)}`).join(",\n");
const mods = vectors.modMessages
  .map((v) => `    ${JSON.stringify(v)}`)
  .join(",\n");
const out = new URL("../src/obj/rune-vectors.json", import.meta.url);
writeFileSync(
  out,
  `{\n  "runes": [\n${runes}\n  ],\n  "modMessages": [\n${mods}\n  ]\n}\n`,
  "utf8",
);

const varieties = new Set(vectors.runes.map((v) => v.variety));
console.log(
  `[rune-vectors] wrote ${vectors.runes.length} runes across ` +
    `${varieties.size} varieties and ${vectors.modMessages.length} modifier ` +
    `message pairs to ${out.pathname}`,
);
