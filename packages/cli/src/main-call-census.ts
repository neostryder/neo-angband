/**
 * `pnpm --filter @rpgm-tools/neo-angband-cli call-census` - print the call-site census.
 *
 * TIER 1 is the gate (call-census.test.ts): the port DEFINES a function of that
 * name and nothing in the port mentions it. That is dead ported code, and it is
 * the exact shape of the bugs this exists to catch - a correct, tested function
 * whose caller was never wired.
 *
 * TIER 2 (--shortfall) and TIER 3 (--unmatched) are reports, not gates. Tier 2
 * is "used, but from fewer places than the C", which is a real signal buried in
 * legitimate shape differences (the port routes msg through a state seam, so it
 * shows 124 call sites against upstream's 622). Tier 3 is "no port symbol of
 * that name", mostly static helpers inlined into their caller or deliberate
 * renames.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runCallCensus } from "./call-census.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const { cFns, underCalled, unmatched } = runCallCensus(ROOT);
const showUnmatched = process.argv.includes("--unmatched");
const showShortfall = process.argv.includes("--shortfall");
const limit = 40;

/** Tier 1: defined in the port, mentioned nowhere in the port. */
const dead = underCalled.filter((u) => u.portCalls === 0 && u.portRefs === 0);
const short = underCalled.filter((u) => u.portCalls > 0 || u.portRefs > 0);

process.stdout.write(`upstream functions in scope:    ${cFns.length}\n`);
process.stdout.write(`ported but NEVER used (tier 1): ${dead.length}\n`);
process.stdout.write(`ported, fewer calls (tier 2):   ${short.length}\n`);
process.stdout.write(`no port symbol of name (tier 3):${unmatched.length}\n\n`);

process.stdout.write(
  "TIER 1 - the port defines it and nothing in the port mentions it\n",
);
for (const u of dead) {
  process.stdout.write(
    `  ${u.name} -> ${u.portName}  C calls it from ${u.cCalls} place(s)` +
      `  (${u.cFile}:${u.cLine})\n`,
  );
  for (const site of u.cCallSites) process.stdout.write(`      ${site}\n`);
}

if (showShortfall) {
  process.stdout.write(
    "\nTIER 2 - ported and used, but from fewer places than the C\n",
  );
  for (const u of short) {
    process.stdout.write(
      `  ${u.name} -> ${u.portName}  C ${u.cCalls} / port ${u.portCalls}` +
        ` (+${u.portRefs} ref)  (${u.cFile}:${u.cLine})\n`,
    );
  }
}

if (showUnmatched) {
  process.stdout.write(
    `\nTIER 3 - no port symbol of that name (top ${limit} by C call count)\n`,
  );
  for (const u of unmatched.slice(0, limit)) {
    process.stdout.write(
      `  ${u.name}  ${u.cCalls} call site(s)  (${u.cFile}:${u.cLine})\n`,
    );
  }
  process.stdout.write(
    `\nMost of tier 3 is static helpers inlined into their caller, or a\n` +
      `deliberate rename (do_cmd_go_down is the "descend" command handler).\n` +
      `It is a list to mine, not a list of defects.\n`,
  );
}

if (!showShortfall || !showUnmatched) {
  process.stdout.write(
    "\nPass --shortfall / --unmatched for the tier-2 / tier-3 reports.\n",
  );
}
