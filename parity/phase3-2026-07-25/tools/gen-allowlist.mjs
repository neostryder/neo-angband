/**
 * Freeze the current C-public-API shortfall into the ratchet's allow-list.
 * Run once to seed it; after that the allow-list is edited by ADJUDICATION
 * (deleting entries as they are wired or ruled N/A with a reason), never by
 * re-running this.
 *
 * Usage: node parity/phase3-2026-07-25/tools/gen-allowlist.mjs
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { extractCHeaderFunctions, extractPortSymbols, normKey } from "./c-api.mjs";

const REPO = resolve(import.meta.dirname, "../../..");
const OUT = join(REPO, "parity/phase3-2026-07-25/c-api-allowlist.json");

const cFns = extractCHeaderFunctions(REPO);
const { declared, mentioned } = extractPortSymbols(REPO);
const declaredKeys = new Set([...declared].map(normKey));
const mentionedKeys = new Set([...mentioned].map(normKey));

const missing = [];
for (const fn of cFns) {
  const k = normKey(fn.name);
  if (declaredKeys.has(k)) continue;
  missing.push({
    name: fn.name,
    header: fn.header,
    line: fn.line,
    /* "mentioned" means the identifier appears somewhere in the port but not as
     * a declaration -- inlined, a method, or only named in a comment. Weaker
     * evidence of a real gap, so it is worth adjudicating separately. */
    status: mentionedKeys.has(k) ? "unreviewed-mentioned" : "unreviewed",
    reason: "",
  });
}
missing.sort((a, b) => a.header.localeCompare(b.header) || a.name.localeCompare(b.name));

const byHeader = {};
for (const m of missing) byHeader[m.header] = (byHeader[m.header] ?? 0) + 1;

writeFileSync(
  OUT,
  JSON.stringify(
    {
      note:
        "Frozen shortfall of reference/src/*.h public functions with no port " +
        "counterpart, guarded by packages/core/src/c-api-coverage.test.ts. This " +
        "list may only SHRINK: delete an entry when the function is ported/wired, " +
        "or set status to 'na' with a reason when the port legitimately has no " +
        "counterpart. Do not add entries -- a new unmatched C function must be " +
        "ported, not allow-listed.",
      cHeaderFunctions: cFns.length,
      missing: missing.length,
      byHeader,
      entries: missing,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `c header functions: ${cFns.length}; port-declared symbols: ${declared.size}; ` +
    `unmatched: ${missing.length} (${missing.filter((m) => m.status === "unreviewed").length} not even mentioned)`,
);
