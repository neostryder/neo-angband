/**
 * The moddability gap list needs a DENOMINATOR nobody maintains by hand.
 *
 * MOD_REACH.md's inventory of dispatch switches was written by reading the
 * code, and a hand-written inventory only ever gets smaller: converting one to
 * a registry gets its row updated, ADDING one gets no row at all, and the list
 * quietly stops being a census while still reading like one. Several rows in
 * that document have already gone stale exactly that way.
 *
 * So `tools/switch-census.json` records every switch of >= 8 cases with a
 * hand-written verdict, and this test fails when the tree and the manifest
 * disagree. A new switch, or one that grew or shrank, breaks the list compare;
 * regenerating stamps it UNADJUDICATED, which breaks the verdict gate; the
 * only way to green is to write a verdict.
 *
 * task #260: a switch can leave a SWITCH-only census two ways, and until now
 * they read identically. A conversion to a registry removes the dispatch
 * entirely - nothing of that shape or size is left anywhere in the file. A
 * RESHAPE just changes the switch's clothes: an if/else chain over one
 * discriminant, or a module-level array searched by key, is exactly as closed
 * to a mod as the switch was, and scored zero either way. ui-entry.ts was the
 * proof: its 32-case switch (MOD_REACH row 18) was gone, and the file was not a
 * registry - `COMBINERS` (a 9-entry lookup array) and `applyRenderer` (a
 * 6-arm `if (backend === ...)` chain) were what replaced it, and nobody wrote
 * either down, because the tool that would have noticed only ever looked for
 * `switch`.
 *
 * task #283 finished that row: both are name-keyed per-game registries now
 * (`UiEntryRegistry`), so ui-entry.ts has moved from the RESHAPED column to the
 * FIXED one and the row the widening earned it has left the census the way a
 * conversion is supposed to make a row leave. The distinction #260 bought is
 * still asserted below, against files that are still reshaped.
 *
 * So this census now also counts IF_CHAIN (an if/else chain of >= threshold
 * arms testing one discriminant) and ARRAY_LOOKUP (a module-level const array
 * of >= threshold elements, searched by a field match rather than indexed by
 * position) - see tools/switch-census.mjs for exactly what each requires. All
 * three kinds share one `cases` field: case labels for a SWITCH, arms for an
 * IF_CHAIN, elements for an ARRAY_LOOKUP - it is a size metric for whichever
 * shape the row is, not a literal case count in the other two.
 *
 * The precision claim is measured, not assumed: an earlier version of the
 * array-lookup heuristic asked only "is this array indexed by a variable
 * anywhere" and lit up on RNG tables, MD5 constants, XP tables and colour
 * palettes - EVERY sizeable array in the tree, because that is what arrays
 * are for. Requiring a field comparison (`.prop ===`) or `.find`/`.findIndex`
 * - a linear SEARCH for a matching key, not a read by position - cut that to
 * zero false positives across the whole source tree, hand-checked one by one
 * below.
 *
 * All 39 rows now carry a verdict, and the distribution is the finding: ZERO
 * are content dispatch a mod would want. That number is asserted here rather
 * than described in a document, because "all of them were looked at" is exactly
 * the sort of claim that is true on the day it is written.
 *
 * It was 51 and 22 until project_p became a registry, and the count moving on
 * its own is the point of a census: the row left because the switch did. It
 * moved again when registry:projection added a tenth arm to the consent-prompt
 * switch, which is the same mechanism running in the other direction - the row
 * came back UNADJUDICATED and had to be re-verdicted before this file was green.
 * registry:effect-info took five more rows out at once and put that same
 * consent-prompt row back on the bench for a third time; registry:randart took
 * four more, including the 87-case add_ability_aux, the biggest in the tree -
 * which is why the "biggest switch" assertion below now names a different file.
 * Widening the census for task #260 then found five more real dispatch points
 * (three IF_CHAIN/ARRAY_LOOKUP reshapes the tool could not see before, plus a
 * second array-lookup already sitting beside an existing switch in
 * host/args.ts) - the count moving DOWN on a conversion and UP on a wider lens
 * are the same honesty in both directions.
 *
 * Lives in packages/web because that is where the other repo-wide ratchets run
 * (mod-core-surface.test.ts); it reads the source tree, not this package.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const manifestPath = fileURLToPath(new URL("tools/switch-census.json", root));
const censusScriptPath = fileURLToPath(new URL("tools/switch-census.mjs", root));

interface Row {
  file: string;
  cases: number;
  hasDefault: boolean;
  kind: string;
  verdict: string;
}
interface Manifest {
  threshold: number;
  switches: Row[];
}

interface Finding {
  line: number;
  cases: number;
  hasDefault: boolean;
  kind: string;
}

interface CensusModule {
  THRESHOLD: number;
  switchesIn: (text: string) => Finding[];
  ifChainsIn: (text: string) => Finding[];
  arrayLookupsIn: (text: string) => Finding[];
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

/* Imported directly (not shelled out to) so the detector fixtures below run
 * against the SAME functions the tree-wide census uses, with no risk of the
 * two drifting apart. Importing must not walk the tree or touch the manifest
 * - tools/switch-census.mjs guards its CLI body behind an isMain check for
 * exactly this reason. */
const census = (await import(censusScriptPath)) as unknown as CensusModule;

/** Re-run the census over the CURRENT tree. */
function live(): { file: string; cases: number; kind: string }[] {
  const out = execFileSync(process.execPath, [censusScriptPath], { encoding: "utf8" });
  return out
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const [cases, kind, file] = l.trim().split(/\s+/);
      return { file: file as string, cases: Number(cases), kind: kind as string };
    });
}

describe("the switch census", () => {
  it("matches the tree (run `node tools/switch-census.mjs --update`)", () => {
    const now = live().map((r) => `${r.file} ${String(r.cases)} ${r.kind}`);
    const was = manifest.switches.map((r) => `${r.file} ${String(r.cases)} ${r.kind}`);
    /* Both directions in one compare: a dispatch point added, removed, grown,
     * shrunk, or RESHAPED into a different kind at the same file+size all
     * surface here - `kind` is part of the key precisely so a SWITCH turning
     * into an IF_CHAIN of the same file and case count cannot look like "no
     * change" to this compare. */
    expect(now).toEqual(was);
  });

  it("has a verdict on every row", () => {
    /* The backlog started at 36 of 51 and this test was a RATCHET, because a
     * wall nobody could clear is just a red build. It reached zero, so it is a
     * gate now - and a gate is only reasonable because clearing it costs one
     * line. A new switch fails the list compare above, the author runs
     * --update, the new row arrives UNADJUDICATED, and this fails until
     * somebody writes down what a mod can do about it. */
    const unadjudicated = manifest.switches.filter(
      (r) => r.verdict === "UNADJUDICATED",
    );
    expect(unadjudicated.map((r) => r.file)).toEqual([]);
    /* DERIVED FROM THE ROWS, not from a count beside them. The manifest used to
     * carry an `unadjudicated:` field as well, and regenerating dropped it -
     * leaving an assertion reading `undefined === 0` had the check been written
     * against the declared copy instead of the rows it summarises. */
    /* And a verdict has to say something. "n/a" would pass the check above. */
    expect(manifest.switches.every((r) => r.verdict.length > 40)).toBe(true);
  });

  it("classifies all 42 into a CLOSED vocabulary", () => {
    /* The class distribution is the actual finding, so it is measured rather
     * than written in prose: of 42 dispatch points, ZERO are content dispatch a
     * mod would want. That is the finish line MOD_REACH gap list set - every
     * one of the eighteen candidates the 2026-08-09 census opened with is now
     * a registry, obj/knowledge.ts (gap 16) last. What is left is UI routing,
     * parsers, host wiring, the mod system's own vocabulary, localization
     * strings, or plain control flow - and saying so is a claim that can be
     * checked against the file.
     *
     * The vocabulary is closed on purpose. Without this, a typo ("CANDIDTE - ")
     * silently opens a new bucket and quietly drops a row out of the candidate
     * count without failing anything. */
    const byClass = new Map<string, number>();
    for (const r of manifest.switches) {
      const cls = r.verdict.split(" - ")[0] as string;
      byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
    }
    expect(Object.fromEntries([...byClass].sort())).toEqual({
      "CONTROL FLOW": 3,
      DEBUG: 2,
      HOST: 4,
      /* 3 until #133 added backup:folder's two capability-KIND switches
       * (capabilities.ts's grantCovers and capability-describe.ts's
       * describeCapability) - the same class as the existing 17-case row,
       * since a mod cannot add a capability kind either. */
      /* 5 until `append`/`removeValue` took patch.ts's op switch to 8 cases.
       * A field op is the mod system's own vocabulary, like a capability kind:
       * what a mod varies is the PATH it addresses, never the verb. */
      INTERNAL: 6,
      /* 3 until the i18n sweep (neostryder/neo-angband#95) added shop.ts's
       * commentWelcome, the greeting-tier-to-translated-line switch that keeps
       * COMMENT_WELCOME's English array intact for its RNG-parity-relevant
       * .length while routing the display text through the translator. */
      LOCALIZATION: 4,
      PARSER: 3,
      REACHABLE: 6,
      /* 15 until #283. ui-entry.ts's COMBINERS row left when the array became a
       * registry, which is the count moving DOWN on a conversion - the same
       * mechanism, and the same honesty, as it moving UP on a wider lens.
       * Back to 15 when the mod manager's own detail screen reached eight action
       * arms: the count moves UP because a screen grew a control, which is the
       * same honesty in the other direction. It dropped to 14 when the unified
       * Mod options action removed the old separate rules and parts arms. */
      UI: 14,
    });
    /* The counts have to add up to the census, or a class went missing. */
    expect([...byClass.values()].reduce((a, b) => a + b, 0)).toBe(
      manifest.switches.length,
    );
    /* The biggest dispatch point left is the wizard/debug menu, which is DEBUG
     * - the 87-case randart one that used to head this list became a
     * registry. */
    expect(manifest.switches[0]?.verdict).toContain("DEBUG");
  });

  it("is measuring something: 40 dispatch points, 533 size labels", () => {
    /* Control for the census ITSELF. A scanner that silently matched nothing -
     * a broken regex, a wrong root - would make both tests above pass forever
     * against an empty tree. */
    expect(manifest.threshold).toBe(8);
    expect(manifest.switches.length).toBeGreaterThanOrEqual(36);
    expect(
      manifest.switches.reduce((sum, r) => sum + r.cases, 0),
    ).toBeGreaterThanOrEqual(508);
    /* And it finds the biggest one known by name. */
    expect(manifest.switches[0]?.file).toBe("packages/web/src/wizard.ts");
  });

  it("no longer lists the switches that became registries", () => {
    /* The whole project_f / project_o / project_p family, the three
     * room-template / vault glyph decoders, the five effect-info switches, the
     * four randart ones, and (as of #283) ui-entry.ts. Their absence is the census
     * agreeing with MOD_REACH rows 11, 12, 14, 17, 18 and 27 - and it is derived
     * rather than declared, which is the whole point of this file: nobody
     * edited a row to say project_p was done, the row left when the switch did.
     *
     * player-side.ts is named as a FILE, not as a row that shrank. Its handlers
     * are top-level functions now, so there is no smaller switch left behind to
     * mistake for progress. gen/room.ts is the same: all three of its decode
     * loops are now one `handlerFor(...)?.terrain?.(...)` call each.
     *
     * This assertion is what makes the denominator honest in BOTH directions.
     * A census that only notices switches APPEARING would let a conversion be
     * claimed without being made; this fails if a glyph switch comes back.
     *
     * task #260 strengthens what "absent" proves: `manifest.switches` now
     * carries IF_CHAIN and ARRAY_LOOKUP rows alongside SWITCH ones, so a file
     * missing from this set is missing ALL THREE shapes, not merely
     * switch-free. Before the widening, a project_p reshaped into an if-chain
     * would have passed this exact assertion; see the FIXED-vs-RESHAPED test
     * below for the file that actually happened to. */
    const files = new Set(manifest.switches.map((r) => r.file));
    expect(files.has("packages/core/src/game/project-feat.ts")).toBe(false);
    expect(files.has("packages/core/src/game/project-obj.ts")).toBe(false);
    expect(files.has("packages/core/src/game/player-side.ts")).toBe(false);
    expect(files.has("packages/core/src/gen/room.ts")).toBe(false);
    /* The five effect-info switches: the two EFINFO_* text switches, the
     * activation-summary walker, effect_subtype's arms, and requestForEffect.
     * Each is now a single `handlerFor(key)` and a call, so there is no smaller
     * switch left behind to mistake for progress. */
    expect(files.has("packages/core/src/effects/effect-info.ts")).toBe(false);
    expect(files.has("packages/core/src/effects/effect.ts")).toBe(false);
    expect(files.has("packages/core/src/obj/effects-info.ts")).toBe(false);
    expect(files.has("packages/core/src/game/effect-item.ts")).toBe(false);
    /* The four randart switches, including add_ability_aux - 87 cases, the
     * biggest dispatch the census has ever recorded. */
    expect(files.has("packages/core/src/obj/randart-build.ts")).toBe(false);
    expect(files.has("packages/core/src/obj/randart-data.ts")).toBe(false);
    /* And gap 16, the last candidate: obj/knowledge.ts's modMessage. The five
     * rune.variety switches beside it were never IN this census - each sat
     * under the eight-case threshold, and they were closed by a union type
     * rather than a switch, which the census cannot see at any threshold. That
     * is why this file's absence is worth less than it looks, and why
     * rune-registry.test.ts derives its coverage from the rune list instead. */
    expect(files.has("packages/core/src/obj/knowledge.ts")).toBe(false);
    /* And row 18 itself. ui-entry.ts left this census twice: once in #260 by
     * being RESHAPED (which the widened tool caught and gave a row back), and
     * once now by being CONVERTED. Absence means the same thing here it means
     * for project-feat.ts - zero rows of any of the three kinds. */
    expect(files.has("packages/core/src/game/ui-entry.ts")).toBe(false);
  });

  it("distinguishes a dispatch that was FIXED from one that was RESHAPED", () => {
    /* This is the actual bug task #260 was opened for. Before the census could
     * see an IF_CHAIN or an ARRAY_LOOKUP, "the file has no rows left" was the
     * ONLY signal, and it meant two different things that read identically:
     * the dispatch was converted to a registry (gone, provably), or it was
     * merely reshaped into a form this tool didn't know to look for yet (still
     * there, just invisible). ui-entry.ts is a real instance of the second
     * case that had already happened silently - MOD_REACH row 18's 32-case
     * switch left this census with no row, a verdict, or a mention in the
     * "became registries" list above, because nobody adjudicated a reshape
     * that the tool could not see. */
    const rowsFor = (file: string) => manifest.switches.filter((r) => r.file === file);

    /* FIXED: project-feat.ts's projection handlers moved into
     * PROJECT_FEAT_HANDLERS, a registry keyed by projection `code` - a Map,
     * not a const array searched by field, and not an if/else chain either.
     * Zero rows of ANY kind is what a genuine conversion looks like. */
    expect(rowsFor("packages/core/src/game/project-feat.ts")).toEqual([]);

    /* ALSO FIXED, and this one is the whole worked example. ui-entry.ts held
     * exactly one ARRAY_LOOKUP row of 9 from #260 until #283 - COMBINERS plus
     * combinerLookup's linear scan, a closed door in a different syntax. It is
     * now a name-keyed per-game registry and the row is gone, which is the same
     * evidence project-feat.ts offers. The asymmetry worth keeping in mind: it
     * left this census ONCE before by being reshaped, and that absence meant
     * nothing at all. */
    expect(rowsFor("packages/core/src/game/ui-entry.ts")).toEqual([]);

    /* STILL RESHAPED, so the distinction stays testable against something real:
     * host/args.ts's 13-element option table is searched by field, and
     * target-loop.ts is a 9-arm if/else chain over one discriminant. Both are
     * exactly as closed as a switch, both carry a row and a verdict here
     * rather than being silently absent, and neither is a candidate. */
    const argRows = rowsFor("packages/core/src/host/args.ts");
    expect(argRows.some((r) => r.kind === "ARRAY_LOOKUP" && r.cases === 13)).toBe(true);
    const targetRows = rowsFor("packages/core/src/game/target-loop.ts");
    expect(targetRows.map((r) => r.kind)).toEqual(["IF_CHAIN"]);

    /* applyRenderer, ui-entry.ts's OTHER reshape, was the honest limit of even
     * the widened tool: a 6-arm `if (backend === UI_ENTRY_RENDERER.X)` chain is
     * exactly as closed to a mod as the old switch was, and it stayed below this
     * census's 8-arm threshold - the same shape of gap as the rune.variety union
     * noted in the "became registries" test above. It never had a row, and it
     * was closed by hand-reading MOD_REACH row 18 rather than by this tool
     * noticing. That limit has not changed; only this instance of it has. */
  });

  it("finds the reshapes task #260 widened the census to see", () => {
    /* A positive ratchet to match the negative one two tests up: these five
     * rows are the actual delta this widening produced across the WHOLE tree,
     * hand-verified one by one (see the task report). If a future edit to the
     * detectors stops finding one of these, that is exactly the silent-absence
     * failure mode this file exists to catch - so the find is asserted by
     * name, not just by count.
     *
     * FOUR of the original five, since #283. The fifth was
     * `ARRAY_LOOKUP|packages/core/src/game/ui-entry.ts|9`, and it is asserted
     * ABSENT in the FIXED-vs-RESHAPED test above rather than dropped from this
     * list quietly - a row that vanishes from a positive ratchet with no note is
     * indistinguishable from a detector that stopped working. */
    const key = (r: Row) => `${r.kind}|${r.file}|${String(r.cases)}`;
    const keys = new Set(manifest.switches.map(key));
    expect(keys.has("ARRAY_LOOKUP|packages/core/src/host/args.ts|13")).toBe(true);
    expect(keys.has("ARRAY_LOOKUP|packages/mcp/src/tools.ts|19")).toBe(true);
    expect(keys.has("IF_CHAIN|packages/core/src/game/target-loop.ts|9")).toBe(true);
    expect(keys.has("IF_CHAIN|packages/web/src/mods.ts|9")).toBe(true);
  });

  it("has no CANDIDATE left, which is what the alpha gate asked for", () => {
    /* Stated separately from the distribution above so it fails by NAME. The
     * census opened at 47 switches / 723 cases / 18 candidates on the morning
     * of 2026-08-09; this is the other end of that.
     *
     * Zero candidates is not zero closed dispatch in the tree - a one-line
     * `tval === TV.STAFF` and a closed union type are both exactly as shut to a
     * mod as a switch, and this tool sees neither. It is the end of what this
     * tool can measure, and MOD_REACH.md is where the rest is tracked. */
    const candidates = manifest.switches.filter((r) =>
      r.verdict.startsWith("CANDIDATE"),
    );
    expect(candidates.map((r) => r.file)).toEqual([]);
  });
});

describe("the widened detectors, against literal fixtures", () => {
  /* Unit-level positive and negative controls for IF_CHAIN and ARRAY_LOOKUP,
   * run directly against the exported pure functions rather than through
   * files on disk - so a control belongs to no other agent's package and
   * cannot be mistaken for real source later. A detector shown only positives
   * is not calibrated; every positive below has a negative sibling that
   * differs by exactly the trait the heuristic is supposed to require. */

  it("flags an if/else chain of >= threshold arms over one discriminant", () => {
    const eightArms = `
      function route(mode: string): number {
        if (mode === "a") { return 1; }
        else if (mode === "b") { return 2; }
        else if (mode === "c") { return 3; }
        else if (mode === "d") { return 4; }
        else if (mode === "e") { return 5; }
        else if (mode === "f") { return 6; }
        else if (mode === "g") { return 7; }
        else if (mode === "h") { return 8; }
        return 0;
      }
    `;
    const found = census.ifChainsIn(eightArms);
    expect(found).toEqual([{ line: expect.any(Number) as number, cases: 8, hasDefault: false, kind: "IF_CHAIN" }]);
  });

  it("negative control: a short if/else chain under threshold is NOT flagged", () => {
    /* This is the common, legitimate shape the brief warned about: a three-arm
     * chain over a closed set is ordinary control flow, not a closed-door
     * dispatch, and the census should stay silent about it exactly as it
     * stays silent about a four-case switch. */
    const threeArms = `
      function classify(kind: string): string {
        if (kind === "a") return "alpha";
        else if (kind === "b") return "beta";
        else if (kind === "c") return "gamma";
        return "other";
      }
    `;
    expect(census.ifChainsIn(threeArms)).toEqual([]);
  });

  it("negative control: sibling ifs on DIFFERING discriminants do not chain", () => {
    /* Eight ifs, but each tests its OWN variable - never a real dispatch, and
     * exactly the case a naive "any run of adjacent ifs" heuristic would have
     * wrongly counted as one 8-arm chain. */
    const differingIdents = `
      function f(a: number, b: number, c: number, d: number, e: number, g: number, h: number, i: number): number {
        if (a === 1) { return 1; }
        if (b === 2) { return 2; }
        if (c === 3) { return 3; }
        if (d === 4) { return 4; }
        if (e === 5) { return 5; }
        if (g === 6) { return 6; }
        if (h === 7) { return 7; }
        if (i === 8) { return 8; }
        return 0;
      }
    `;
    expect(census.ifChainsIn(differingIdents)).toEqual([]);
  });

  it("flags applyRenderer's old shape ONLY once it reaches 8 arms", () => {
    /* ui-entry.ts's applyRenderer WAS 6 arms (six separate `if (backend ===
     * UI_ENTRY_RENDERER.X) { ... return ...; }` blocks, no `else`), which is
     * below THRESHOLD and correctly invisible - #260's framing of it as "the
     * same shape as COMBINERS" was about closedness to a mod, not about
     * crossing this tool's size cutoff. Adding two more arms of the identical
     * shape is what pushes it over. #283 converted the real one; the fixture
     * stays, because the threshold it calibrates is not about that file. */
    const sixArms = `
      function applyRenderer(backend: number): string {
        if (backend === 1) { return "a"; }
        if (backend === 2) { return "b"; }
        if (backend === 3) { return "c"; }
        if (backend === 4) { return "d"; }
        if (backend === 5) { return "e"; }
        if (backend === 6) { return "f"; }
        return "default";
      }
    `;
    expect(census.ifChainsIn(sixArms)).toEqual([]);

    const eightArms = `
      function applyRenderer(backend: number): string {
        if (backend === 1) { return "a"; }
        if (backend === 2) { return "b"; }
        if (backend === 3) { return "c"; }
        if (backend === 4) { return "d"; }
        if (backend === 5) { return "e"; }
        if (backend === 6) { return "f"; }
        if (backend === 7) { return "g"; }
        if (backend === 8) { return "h"; }
        return "default";
      }
    `;
    const found = census.ifChainsIn(eightArms);
    expect(found.length).toBe(1);
    expect(found[0]?.cases).toBe(8);
  });

  it("flags a module-level lookup array searched by field (the COMBINERS shape)", () => {
    const combinerLike = `
      const HANDLERS: ReadonlyArray<{ name: string; run: () => number }> = [
        { name: "A", run: () => 1 },
        { name: "B", run: () => 2 },
        { name: "C", run: () => 3 },
        { name: "D", run: () => 4 },
        { name: "E", run: () => 5 },
        { name: "F", run: () => 6 },
        { name: "G", run: () => 7 },
        { name: "H", run: () => 8 },
      ];

      function lookup(name: string): number {
        for (let i = 0; i < HANDLERS.length; i++) {
          if (HANDLERS[i]!.name === name) return i;
        }
        return -1;
      }
    `;
    expect(census.arrayLookupsIn(combinerLike)).toEqual([
      { line: expect.any(Number) as number, cases: 8, hasDefault: false, kind: "ARRAY_LOOKUP" },
    ]);
  });

  it("flags the same shape spelled with .find(...)", () => {
    const findLike = `
      const HANDLERS: ReadonlyArray<{ name: string }> = [
        { name: "A" }, { name: "B" }, { name: "C" }, { name: "D" },
        { name: "E" }, { name: "F" }, { name: "G" }, { name: "H" },
      ];
      function lookup(name: string) {
        return HANDLERS.find((h) => h.name === name);
      }
    `;
    expect(census.arrayLookupsIn(findLike).length).toBe(1);
  });

  it("negative control: a plain data array, never searched by field, is NOT flagged", () => {
    /* This is the false-positive mode the first cut of this heuristic actually
     * hit: RAND_NORMAL_TABLE, MD5's constant tables, experience tables and
     * colour palettes are all sizeable module-level arrays that get indexed
     * SOMEWHERE - that alone cannot be the signal, or every data table in the
     * tree lights up. */
    const plainData = `
      const NAMES: readonly string[] = ["a", "b", "c", "d", "e", "f", "g", "h"];
      function listNames(): string {
        return NAMES.join(", ");
      }
    `;
    expect(census.arrayLookupsIn(plainData)).toEqual([]);
  });

  it("negative control: indexing by POSITION (not searching by field) is NOT flagged", () => {
    /* The RAND_NORMAL_TABLE[mid] shape exactly: a variable index, but read
     * directly rather than compared field-by-field to a key. This is what a
     * plain lookup table looks like, and it is not a dispatch. */
    const positional = `
      const LEVELS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      function atLevel(i: number): number {
        return LEVELS[i]!;
      }
    `;
    expect(census.arrayLookupsIn(positional)).toEqual([]);
  });

  it("negative control: a function-local lookup array is NOT flagged", () => {
    /* Same field-search shape as the COMBINERS fixture above, but declared
     * inside a function rather than at module scope - one call's own private
     * table, not a mod-facing dispatch point. */
    const localLookup = `
      function lookupLocal(name: string): number {
        const HANDLERS: ReadonlyArray<{ name: string }> = [
          { name: "A" }, { name: "B" }, { name: "C" }, { name: "D" },
          { name: "E" }, { name: "F" }, { name: "G" }, { name: "H" },
        ];
        for (let i = 0; i < HANDLERS.length; i++) {
          if (HANDLERS[i]!.name === name) return i;
        }
        return -1;
      }
    `;
    expect(census.arrayLookupsIn(localLookup)).toEqual([]);
  });

  it("negative control: an array under threshold is NOT flagged even when searched", () => {
    const sevenElements = `
      const HANDLERS: ReadonlyArray<{ name: string }> = [
        { name: "A" }, { name: "B" }, { name: "C" }, { name: "D" },
        { name: "E" }, { name: "F" }, { name: "G" },
      ];
      function lookup(name: string) {
        return HANDLERS.find((h) => h.name === name);
      }
    `;
    expect(census.arrayLookupsIn(sevenElements)).toEqual([]);
    expect(census.THRESHOLD).toBe(8);
  });
});
