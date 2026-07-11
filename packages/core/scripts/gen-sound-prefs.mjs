// Regenerates packages/core/src/sound/sound-prefs-data.ts from the upstream
// reference/lib/customize/sound.prf.
//
// This extracts ONLY the `sound:<MSG_NAME>:<space-separated sample names>`
// directives - the message->sound NAME MAPPING (functional data). It does
// NOT copy, bundle, or reference any audio asset (.mp3 etc): the Dubtrain
// audio pack is Creative-Commons NON-COMMERCIAL and stays out of the repo;
// users supply their own pack at runtime (see packages/web).
//
// Usage (from repo root):
//   node packages/core/scripts/gen-sound-prefs.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const prfPath = resolve(here, "../../../reference/lib/customize/sound.prf");
const outPath = resolve(here, "../src/sound/sound-prefs-data.ts");

const text = readFileSync(prfPath, "utf8");

/** @type {{type: string, sounds: string}[]} */
const entries = [];
for (const raw of text.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line.startsWith("sound:")) continue;
  // Faithful to SOUND_PRF_FORMAT "sound sym type str sounds": the symbol is
  // up to the next ':', the rest of the line is the sounds string.
  const rest = line.slice("sound:".length);
  const colon = rest.indexOf(":");
  if (colon < 0) continue;
  const type = rest.slice(0, colon);
  const sounds = rest.slice(colon + 1);
  entries.push({ type, sounds });
}

const body = entries
  .map((e) => `  { type: ${JSON.stringify(e.type)}, sounds: ${JSON.stringify(e.sounds)} },`)
  .join("\n");

const out = `// Generated from reference/lib/customize/sound.prf by
// scripts/gen-sound-prefs.mjs. Do not edit.
//
// The message->sound NAME MAPPING (functional data) from the Dubtrain
// Angband sound config. Each entry is one \`sound:<MSG_NAME>:<samples>\`
// directive: 'type' is the MSG_ name (message_lookup_by_name), 'sounds' is
// the raw space-separated list of sample base-names (no path, no extension).
//
// NO AUDIO ASSETS are bundled: the Dubtrain .mp3 pack is Creative-Commons
// NON-COMMERCIAL. This repo has commercial intent, so only the name mapping
// is ported. A web front end loads user-supplied audio from a configurable
// base URL (see packages/web/src/sound.ts).

/** One parsed \`sound:\` directive from sound.prf. */
export interface SoundPrefEntry {
  /** MSG_ name (feeds message_lookup_by_name). */
  readonly type: string;
  /** Space-separated sample base-names, exactly as in the prf. */
  readonly sounds: string;
}

/** Every \`sound:\` directive from sound.prf, in file order. */
export const SOUND_PREF_ENTRIES: readonly SoundPrefEntry[] = [
${body}
];
`;

writeFileSync(outPath, out, "utf8");
console.log(`Wrote ${entries.length} sound directives to ${outPath}`);
