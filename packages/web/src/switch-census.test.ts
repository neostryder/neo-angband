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
 * All 38 now carry one, and the distribution is the finding: 9 are content
 * dispatch a mod would want, and 29 are not. That number is asserted here
 * rather than described in a document, because "we looked at all of them" is
 * exactly the sort of claim that is true on the day it is written.
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

interface Row {
  file: string;
  cases: number;
  hasDefault: boolean;
  verdict: string;
}
interface Manifest {
  threshold: number;
  switches: Row[];
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

/** Re-run the census over the CURRENT tree. */
function live(): { file: string; cases: number }[] {
  const out = execFileSync(
    process.execPath,
    [fileURLToPath(new URL("tools/switch-census.mjs", root))],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const [cases, file] = l.trim().split(/\s+/);
      return { file: file as string, cases: Number(cases) };
    });
}

describe("the switch census", () => {
  it("matches the tree (run `node tools/switch-census.mjs --update`)", () => {
    const now = live().map((r) => `${r.file} ${String(r.cases)}`);
    const was = manifest.switches.map((r) => `${r.file} ${String(r.cases)}`);
    /* Both directions in one compare: a switch added, removed, grown or shrunk
     * all surface here. */
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

  it("classifies all 34 into a CLOSED vocabulary", () => {
    /* The class distribution is the actual finding, so it is measured rather
     * than written in prose: of 34 switches, ZERO are content dispatch a mod
     * would want. That is the finish line MOD_REACH gap list set - every one
     * of the eighteen candidates the 2026-08-09 census opened with is now a
     * registry, obj/knowledge.ts (gap 16) last. What is left is UI routing,
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
      HOST: 3,
      INTERNAL: 2,
      LOCALIZATION: 3,
      PARSER: 3,
      REACHABLE: 6,
      UI: 12,
    });
    /* The counts have to add up to the census, or a class went missing. */
    expect([...byClass.values()].reduce((a, b) => a + b, 0)).toBe(
      manifest.switches.length,
    );
    /* The biggest switch left is the wizard/debug menu, which is DEBUG - the
     * 87-case randart one that used to head this list became a registry. */
    expect(manifest.switches[0]?.verdict).toContain("DEBUG");
  });

  it("is measuring something: 34 switches, 463 case labels", () => {
    /* Control for the census ITSELF. A scanner that silently matched nothing -
     * a broken regex, a wrong root - would make both tests above pass forever
     * against an empty tree. */
    expect(manifest.threshold).toBe(8);
    expect(manifest.switches.length).toBeGreaterThanOrEqual(32);
    expect(
      manifest.switches.reduce((sum, r) => sum + r.cases, 0),
    ).toBeGreaterThanOrEqual(460);
    /* And it finds the biggest one we know about by name. */
    expect(manifest.switches[0]?.file).toBe("packages/web/src/wizard.ts");
  });

  it("no longer lists the fifteen switches that became registries", () => {
    /* The whole project_f / project_o / project_p family, the three
     * room-template / vault glyph decoders, the five effect-info switches, and
     * the four randart ones. Their absence is the census
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
     * claimed without being made; this fails if a glyph switch comes back. */
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
