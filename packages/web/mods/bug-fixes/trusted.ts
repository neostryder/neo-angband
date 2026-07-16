/**
 * The bundled `bug-fixes` mod (decision 24): a TRUSTED in-process plugin that
 * carries upstream Angband bug fixes the port deliberately does NOT bake into
 * faithful core. Core tracks the 4.2.6 tag bug-for-bug (PORT_PLAN.md decisions
 * 2, 23, 24); every fix here instead ships as an opt-in, fully-removable patch,
 * the model players know from the Skyrim / Bethesda unofficial patches.
 *
 * HOW IT WORKS (the seam): each fix lives in ported core as its faithful 4.2.6
 * branch (the default) plus an off-by-default corrected branch guarded by
 * `modRuleEnabled(state, "<flag>")` (core, game/context.ts). This plugin does
 * exactly one thing on register(): it turns those flags on, through the
 * capability-gated `host.rules` facade (core, mod/registry-host.ts, capability
 * "registry:rules"). With this mod disabled no flag is set, state.modRules is
 * empty, and core is byte-identical to 4.2.6. It declares only "registry:rules"
 * - it overrides no effect / room / command / monster / vocabulary registry.
 *
 * The design of record, every upstream citation, and per-fix implementation
 * notes are in docs/modding/BUG_FIXES.md. Enabled by default (a first-party
 * bundled mod); disable it in the mod manager to get faithful 4.2.6 back.
 */

import { defineTrustedPlugin } from "../../src/agents/trusted/runtime";

/**
 * The core rule flags this mod turns on, each paired with the upstream defect
 * it corrects. Kept as data so register() is a single loop and the set is easy
 * to audit against docs/modding/BUG_FIXES.md.
 */
const RULES: ReadonlyArray<{ flag: string; fix: string }> = [
  // #4245: a unique could log multiple "Killed X" kill-history entries via
  // shape-change / projection death paths. Dedupe once the unique is dead.
  { flag: "bugfix.uniqueKillHistory", fix: "#4245 unique returns in kill history" },
  // #4605: the noise / scent heatmaps were not saved, so save/reload could
  // change monster tracking versus uninterrupted play. Persist them.
  { flag: "bugfix.noiseScentSave", fix: "#4605 noise and scent not saved" },
  // #4664: the object-list comparator was not a strict total order under a
  // non-stable sort. Add a deterministic geometric total-key tiebreak.
  { flag: "bugfix.objectListOrder", fix: "#4664 object-list ordering" },
  // #4510: defensive re-check so an object already carrying a created artifact
  // can never be re-committed (single source of truth = the shared ArtifactState).
  { flag: "bugfix.duplicateArtifact", fix: "#4510 duplicate artifacts" },
];

export default defineTrustedPlugin({
  register(host, ctx) {
    for (const { flag } of RULES) {
      host.rules.enable(flag);
    }
    ctx.log(
      `enabled ${RULES.length} bug-fix rules: ${RULES.map((r) => r.flag).join(", ")}`,
    );
  },
  uninstall() {
    // Flags live on the live GameState; a host that supports hot-uninstall
    // clears them by rebuilding state. Nothing to release here.
  },
});
