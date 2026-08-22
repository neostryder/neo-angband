/**
 * `ctx.authoring` and `ctx.composedRecords`, measured over the game's own
 * content rather than over a fixture.
 *
 * WHAT THIS FILE IS FOR. Both seams compile against anything. A context handing
 * over an empty object and a context handing over the shipped pack are the same
 * shape, type-check identically, and only one of them is worth having - so a
 * test that asserted the fields merely EXIST would pass in exactly the state the
 * seams were added to escape. Every assertion below therefore runs the real
 * producers: `loadGamePack` reads the shipped pack, `composedRecords` is the
 * host's own memoised composition, `modPluginContext` is the real context
 * builder, and the authoring functions are called through `ctx.authoring` rather
 * than imported here.
 *
 * WHY BOTH IN ONE FILE. They are one seam used twice: the authoring functions
 * take a record set and the record set is the other field, so a test of either
 * alone can be green while the pair is useless. The evidence that matters is
 * `ctx.authoring.peersFor(..., ctx.composedRecords)` returning real peers.
 *
 * A drift guard at the end reads `main.ts`, because every assertion here builds
 * its own latch and none of them can see whether the shipped boot path sets one.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { bindCore } from "@rpgm-tools/neo-angband-core";
import { composedObjects } from "@rpgm-tools/neo-angband-mod-sdk";
import type { JsonRecord } from "@rpgm-tools/neo-angband-mod-sdk";
import { composedRecords, loadGamePack } from "./pack";
import {
  modPluginContext,
  setModComposedRecords,
  setModRegistries,
} from "./mod-context";
import type { ModPluginContext } from "./mod-plugin";

const MAIN_TS_SOURCE = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/** One monster of the shipped pack, named exactly as monster.json spells it. */
const GRIP = "Grip, Farmer Maggot's Dog";

/** The real context, over the real composition, through the real latch. */
let ctx: ModPluginContext;

beforeAll(() => {
  setModComposedRecords(composedObjects(composedRecords()));
  ctx = modPluginContext("authoring-probe", {});
});

describe("ctx.authoring is the SDK's live barrel", () => {
  /* Present unconditionally, unlike registries and composedRecords: there is no
   * boot state it waits on. A context built with no latches set at all still has
   * it, which is the difference this asserts. */
  it("is there on a context built before anything is latched", () => {
    setModRegistries(undefined);
    setModComposedRecords(undefined);
    const bare = modPluginContext("bare", {});
    expect(bare.authoring).toBeDefined();
    expect(bare.composedRecords).toBeUndefined();
    expect(bare.registries).toBeUndefined();
    /* Put the real one back for everything below. */
    setModComposedRecords(composedObjects(composedRecords()));
    ctx = modPluginContext("authoring-probe", {});
  });

  it("carries the authoring functions the workshop names, as functions", () => {
    for (const name of [
      "blueprintFor",
      "checkRecords",
      "describeFile",
      "draftRecord",
      "fieldUsage",
      "modProject",
      "peersFor",
      "recordKey",
      "requiredFields",
      "suggestFields",
      "templateRecord",
      "validateManifest",
    ] as const) {
      expect(typeof ctx.authoring[name], name).toBe("function");
    }
    expect(Array.isArray(ctx.authoring.BLUEPRINT_FILES)).toBe(true);
    expect(ctx.authoring.RECORD_BLUEPRINTS).toBeTypeOf("object");
    expect(ctx.authoring.COMPANION_RULES).toBeTypeOf("object");
  });

  /* The blueprints are MEASURED from core's data at build time, so a barrel that
   * resolved to a stub would answer here with nothing. */
  it("its blueprints describe the real content, not an empty set", () => {
    expect(ctx.authoring.BLUEPRINT_FILES.length).toBeGreaterThan(20);
    const monster = ctx.authoring.blueprintFor("monster");
    expect(monster).toBeDefined();
    expect(monster?.records).toBeGreaterThan(500);
    expect(ctx.authoring.requiredFields("monster")).toContain("base");
  });
});

describe("ctx.composedRecords is the game's own content", () => {
  it("holds the shipped pack, keyed by file stem with no extension", () => {
    const records = ctx.composedRecords;
    expect(records).toBeDefined();
    if (!records) return;
    for (const file of ["monster", "object", "store"]) {
      expect(Object.keys(records), file).toContain(file);
    }
    /* No `.json` anywhere in the keys: the stem is the contract the SDK's
     * `records[file]` lookups are written against. */
    expect(Object.keys(records).filter((k) => k.includes("."))).toEqual([]);
    expect((records["monster"] ?? []).length).toBeGreaterThan(500);
    /* The whole composition, not one file of it. The measured total is over
     * three thousand; a floor well under it survives content being added. */
    const total = Object.values(records).reduce((n, list) => n + list.length, 0);
    expect(total).toBeGreaterThan(2500);
  });

  /* THE POINT OF THE SEAM, and the one thing `ctx.registries` cannot do. A bound
   * MonsterRace has no `base`: the binder resolved it into a pointer and dropped
   * the name. An authoring tool asking what the dogs near depth 3 declare is
   * asking about this shape. */
  it("carries the RAW JSON field names the binder consumed, which registries drops", () => {
    const monsters = (ctx.composedRecords?.["monster"] ?? []) as readonly JsonRecord[];
    const named = monsters.find((m) => m["name"] === GRIP);
    expect(named, "the shipped pack's monster.json is what was composed").toBeDefined();
    expect(named?.["base"]).toBe("canine");
    expect(named?.["depth"]).toBe(2);

    /* AND THE BOUND TWIN DOES NOT ANSWER THE SAME QUESTION, which is what makes
     * this a measurement rather than a restatement of the doc comment. The
     * binder resolved `base` into a pointer at a MonsterBase, so the string the
     * author wrote - the thing a peer table groups on - is not on the bound
     * race. Binding the real pack is not cheap, so it happens once, here. */
    const race = bindCore(loadGamePack()).monsters.races.find((r) => r.name === GRIP);
    expect(race, "the same monster, bound").toBeDefined();
    expect(typeof (race as unknown as Record<string, unknown>)["base"]).not.toBe("string");
  });

  /* Every element is an object. Passthrough files hold arrays and scalars, and
   * the authoring functions read Object.entries off each element, so a host that
   * skipped `composedObjects` would hand them something that throws. */
  it("holds only record objects, never arrays or scalars", () => {
    for (const [file, list] of Object.entries(ctx.composedRecords ?? {})) {
      for (const record of list) {
        expect(record === null || typeof record !== "object" || Array.isArray(record), file).toBe(
          false,
        );
      }
    }
  });
});

describe("the two seams together answer a question the stub only demonstrated", () => {
  /* peersFor over the real pool: comparable records plus the sentence saying why
   * they are comparable. Against a fixture this returns a handful of invented
   * dogs; against the game it returns the game's. */
  it("peersFor finds real comparable monsters and says why", () => {
    const { peers, because } = ctx.authoring.peersFor(
      "monster",
      { name: "Test hound", base: "canine", depth: 3 },
      ctx.composedRecords,
    );
    expect(peers.length).toBeGreaterThan(2);
    expect(because).toBeTruthy();
    /* Drawn from the pool that was passed in, not conjured. */
    const pool = new Set((ctx.composedRecords?.["monster"] ?? []).map((m) => m["name"]));
    for (const peer of peers) expect(pool.has(peer["name"])).toBe(true);
    for (const peer of peers) expect(peer["base"]).toBe("canine");
  });

  it("suggestFields proposes values with a reason attached", () => {
    const suggestions = ctx.authoring.suggestFields(
      "monster",
      { name: "Test hound", base: "canine", depth: 3 },
      ctx.composedRecords,
    );
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.field).toBeTruthy();
      expect(s.because).toBeTruthy();
    }
  });

  it("draftRecord fills a new record from a real model", () => {
    const drafted = ctx.authoring.draftRecord(
      "monster",
      { name: "Test hound", base: "canine" },
      ctx.composedRecords,
    );
    expect(drafted.record["name"]).toBe("Test hound");
    expect(Object.keys(drafted.record).length).toBeGreaterThan(3);
  });

  /* checkRecords over the whole composition. The game's own content is what the
   * rules were measured from, so a clean run on it is the honest baseline, and a
   * deliberately broken draft has to produce a finding against it. */
  it("checkRecords runs over the composition and faults a bad reference", () => {
    const all = ctx.composedRecords;
    expect(all).toBeDefined();
    if (!all) return;
    const broken: Readonly<Record<string, readonly JsonRecord[]>> = {
      monster: [{ name: "Nonsense hound", base: "no-such-base-anywhere", depth: 3 }],
    };
    const findings = ctx.authoring.checkRecords(broken, all);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => JSON.stringify(f).includes("no-such-base-anywhere"))).toBe(true);
  });

  /* The `recordKey` half: the ref a record will be addressed by, over a real
   * record rather than an invented one. */
  it("recordKey names a real composed record", () => {
    const first = (ctx.composedRecords?.["monster"] ?? [])[0];
    expect(first).toBeDefined();
    expect(ctx.authoring.recordKey("monster", first)).toBeTruthy();
  });
});

/**
 * THE SHIPPED WIRING. Everything above latches its own value, so all of it could
 * be green while no boot path ever sets one - which is exactly the state
 * `ctx.registries` has a drift guard for, and these two are set on the same two
 * lines for the reason that guard exists.
 */
describe("the boot path latches both halves of one composition", () => {
  it("main.ts sets the composed records beside the registries it bound", () => {
    expect(MAIN_TS_SOURCE).toMatch(/setModRegistries\(booted\.registries\);/u);
    expect(MAIN_TS_SOURCE).toMatch(/setModComposedRecords\(composedObjects\(composedRecords\(\)\)\);/u);
  });
});
