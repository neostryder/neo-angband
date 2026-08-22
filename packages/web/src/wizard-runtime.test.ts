/**
 * `ctx.wizard`, and the two properties it exists for.
 *
 * The commands themselves are core's and are tested where they live. What this
 * door adds is a gate and a catalogue, so those are what these tests read.
 *
 * THE GATE IS THE WHOLE BARGAIN: not one method does anything until the session has
 * been cut loose from its save. That is a claim about ORDER, and order is the kind
 * of claim that quietly stops being true, so it is checked per method rather than
 * once - a surface with twenty entries and one gate check has nineteen chances to
 * grow a twenty-first that forgot.
 *
 * THE CATALOGUE'S CLAIM is that a mod's own records are distinguishable from core's
 * without keeping a list of what vanilla contains, which is what makes "show me my
 * content first" possible at all.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModWizard, MAX_AT_ONCE } from "./wizard-runtime";
import type { ModWizard, ModWizardOutcome } from "./mod-plugin";
import { resetSlotWriteSurrender, setActiveId } from "./roster";
import type { WizardUiCtx } from "./wizard";

/** localStorage's shape: the sandbox reads the active slot id out of it. */
class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

interface Log {
  readonly said: string[];
  readonly marked: number[];
}

/**
 * A wizard context over fake registries.
 *
 * NOTHING HERE IS CORE'S REAL BUNDLE, on the same terms the spawn door's tests set
 * that out: what is under test is the gate and the resolution, so the engine calls
 * are observed rather than performed. A `wiz*` function handed a bundle with no
 * `effect` or `expDeps` returns false, which is exactly what a refused command
 * looks like from here - so a command that reaches the engine reports `ok: false`,
 * and reaching it at all is the thing being measured.
 */
function wizardStub(log: Log, opts: { marked?: boolean } = {}): () => WizardUiCtx {
  const player = {
    noscore: opts.marked === true ? 0x0008 : 0, // NOSCORE.DEBUG
    lev: 22,
    exp: 15000,
    au: 400,
    statCur: [18, 12, 10, 16, 17],
    statMax: [18, 12, 10, 16, 17],
  };
  const kinds = [
    null, // upstream's tables start at 1, and a hole must not become an entry
    { name: "Wooden Torch", level: 1 },
    { name: "Bag of Holding", level: 20, from: { owner: "builder" } },
  ];
  /* Index 0 is upstream's reserved `<player>` pseudo-race, which has a REAL name
   * and so survives a filter that only drops holes and blanks. Present in the
   * fixture on purpose: it is the row that has to not appear. */
  const races = [
    { name: "<player>", level: 0 },
    { name: "Snarl", level: 3 },
    { name: "Bag Wraith", level: 40, from: { owner: "builder" } },
  ];
  const artifacts = [null, { name: "The Phial of Galadriel", level: 5 }];
  return () =>
    ({
      state: {
        actor: { player },
        chunk: { depth: 18 },
        z: { maxDepth: 101 },
      },
      deps: {
        debug: (player.noscore & 0x0008) !== 0,
        races,
        artifacts,
        makeDeps: { reg: { kinds } },
        markNoscore: (bits: number) => {
          log.marked.push(bits);
          player.noscore |= bits;
        },
        msg: (line: string) => log.said.push(line),
      },
      say: (line: string) => log.said.push(line),
      refresh: () => {},
      raceByName: (name: string) => races.find((r) => r?.name === name) ?? null,
    }) as unknown as WizardUiCtx;
}

function log(): Log {
  return { said: [], marked: [] };
}

const realStorage = globalThis.localStorage;

beforeEach(() => {
  /* The surrender latch is one way per PAGE and each test is a page. Without this,
   * every test after the first `sandbox()` would find the gate already open and
   * "the gate refuses" would pass by not being exercised. */
  resetSlotWriteSurrender();
  Object.defineProperty(globalThis, "localStorage", {
    value: new FakeStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: realStorage,
    configurable: true,
    writable: true,
  });
});

/**
 * Every command, called with arguments that are legal in themselves.
 *
 * ONE LIST, DRIVEN TWICE - once attached and once sandboxed - so "the gate is on
 * every method" is measured rather than sampled. `where`, `catalogue`, `sandboxed`
 * and `attached` are deliberately absent: they read, and reading is what a player
 * does to decide whether to detach at all.
 */
const COMMANDS: readonly { name: string; run: (w: ModWizard) => ModWizardOutcome }[] = [
  { name: "spawnItem", run: (w) => w.spawnItem("Wooden Torch") },
  { name: "spawnCreature", run: (w) => w.spawnCreature("Snarl") },
  { name: "spawnArtifact", run: (w) => w.spawnArtifact("The Phial of Galadriel") },
  { name: "goToDepth", run: (w) => w.goToDepth(40) },
  { name: "grantExperience", run: (w) => w.grantExperience(500) },
  { name: "setExperience", run: (w) => w.setExperience(500) },
  { name: "setGold", run: (w) => w.setGold(500) },
  { name: "setStat", run: (w) => w.setStat("STR", 18) },
  { name: "maxOut", run: (w) => w.maxOut() },
  { name: "heal", run: (w) => w.heal() },
  { name: "rerollLife", run: (w) => w.rerollLife() },
  { name: "acquire", run: (w) => w.acquire(2) },
  { name: "summonRandom", run: (w) => w.summonRandom(2) },
  { name: "banish", run: (w) => w.banish(10) },
  { name: "killVisible", run: (w) => w.killVisible() },
  { name: "teleport", run: (w) => w.teleport(20) },
  { name: "mapLevel", run: (w) => w.mapLevel() },
  { name: "lightLevel", run: (w) => w.lightLevel() },
  { name: "findCreatures", run: (w) => w.findCreatures() },
  { name: "learnItems", run: (w) => w.learnItems(30) },
  { name: "learnCreatures", run: (w) => w.learnCreatures() },
];

describe("nothing works until the session is cut loose", () => {
  it("refuses every command while the character is still being saved", () => {
    const l = log();
    setActiveId("slot-1"); // a real character, being autosaved
    const w = createModWizard("builder", { wizard: wizardStub(l, { marked: true }) });

    const allowed = COMMANDS.filter(({ run }) => run(w).ok);

    expect(allowed.map((c) => c.name)).toEqual([]);
    /* And the refusal says what to do about it, because "not available" is the
     * answer that leaves a mod author guessing. */
    expect(w.mapLevel()).toEqual({
      ok: false,
      problem:
        "mapping the level needs this session cut loose from its save first. Call sandbox() and tell the " +
        "player what it costs them, then try again",
    });
    /* Nothing reached the engine, so nothing was said to the message log. */
    expect(l.said).toEqual([]);
  });

  it("lets every command through afterwards", () => {
    const l = log();
    setActiveId("slot-1");
    const w = createModWizard("builder", { wizard: wizardStub(l) });
    w.sandbox();

    /* Past the gate, each one reaches core and core refuses it - the stub carries
     * no engine bundles. `ok: false` with the ENGINE's refusal rather than the
     * gate's is the proof that the gate is what moved. */
    const stillGated = COMMANDS.filter(
      ({ run }) => run(w).ok === false && String((run(w) as { problem: string }).problem).includes("cut loose"),
    );
    expect(stillGated.map((c) => c.name)).toEqual([]);
  });

  it("refuses when the session is loose but the character was never marked", () => {
    /* A throwaway behind the character select is already loose and has taken no
     * mark. Every wiz* function is gated on that bit and would no-op silently, so
     * this is the difference between a control that is off and one that lies. */
    const l = log();
    setActiveId(null);
    const w = createModWizard("builder", { wizard: wizardStub(l) });
    expect(w.mapLevel()).toEqual({
      ok: false,
      problem: "mapping the level needs the debug mark on this character, which sandbox() sets. Call it first",
    });
  });
});

describe("sandbox() is the consent moment, and it marks the character", () => {
  it("takes the debug mark itself rather than posing the game's question", () => {
    /* `ctx.debug` asks the game's own once-per-character question because it acts
     * on a character that is still being saved. Here the character has already
     * stopped being written down, so the question has no consequence left to warn
     * about - and it would have to be posed on the character grid, underneath
     * whatever the mod is drawing. Detaching is the consent. */
    const l = log();
    setActiveId("slot-1");
    const w = createModWizard("builder", { wizard: wizardStub(l) });

    expect(w.sandbox().ok).toBe(true);

    expect(l.marked).toEqual([0x0008]); // NOSCORE.DEBUG, through the same hook ^A uses
    expect(w.sandboxed()).toBe(true);
  });

  it("says in the message log that the character on disk is safe", () => {
    /* In a sandboxed session the log is the only trace there is, because nothing
     * is written down. */
    const l = log();
    setActiveId("slot-1");
    const w = createModWizard("builder", { wizard: wizardStub(l) });
    w.sandbox();
    expect(l.said.join(" ")).toContain("Nothing from here on is saved");
  });

  it("is idempotent", () => {
    const l = log();
    setActiveId("slot-1");
    const w = createModWizard("builder", { wizard: wizardStub(l) });
    expect(w.sandbox().ok).toBe(true);
    expect(w.sandbox().ok).toBe(true);
  });
});

describe("the catalogue", () => {
  const catalogue = (): ReturnType<ModWizard["catalogue"]> =>
    createModWizard("builder", { wizard: wizardStub(log()) }).catalogue();

  it("says which pack added each record, and leaves core's silent", () => {
    /* Absent `from` means core's own - the same convention `provenanceOf` uses -
     * which is what lets a browser put a mod's content first without keeping its
     * own list of what vanilla contains. */
    const items = catalogue().items;
    expect(items).toEqual([
      { name: "Wooden Torch", index: 1, level: 1 },
      { name: "Bag of Holding", index: 2, level: 20, from: "builder" },
    ]);
  });

  it("keeps the registry index each record actually has", () => {
    /* The index is what `wizCreateObj` looks up, and the array starts at 1 because
     * upstream's tables do. An entry list that renumbered from zero would conjure
     * the wrong item and nothing would report it. */
    expect(catalogue().items.map((i) => i.index)).toEqual([1, 2]);
    expect(catalogue().creatures.map((c) => c.index)).toEqual([1, 2]);
  });

  it("leaves out the reserved <player> pseudo-race", () => {
    /* `r_info[0]` has a real name, so a filter that only dropped holes and blanks
     * kept it - and its level is 0, so it sorted to the very front and "conjure the
     * player" was the first row a builder was offered. Seen on screen in a running
     * game, not deduced. Core skips index 0 everywhere it walks the table for
     * something a player can meet. */
    expect(catalogue().creatures.map((c) => c.name)).toEqual(["Snarl", "Bag Wraith"]);
  });

  it("is readable before the session is cut loose", () => {
    /* Deciding what to test is how a player decides whether to detach. A browser
     * that only filled in after they had agreed would be asking them to agree to
     * something they cannot see. */
    setActiveId("slot-1");
    expect(catalogue().creatures.length).toBe(2);
  });

  it("answers with empty lists rather than throwing when there is no game", () => {
    const w = createModWizard("builder", {
      wizard: () => {
        throw new Error("no game");
      },
    });
    expect(w.catalogue()).toEqual({ items: [], creatures: [], artifacts: [] });
    expect(w.where()).toBeNull();
  });
});

describe("where() fills in a panel's fields", () => {
  it("reports the depth, the level, the purse and the stats by name", () => {
    setActiveId("slot-1");
    const w = createModWizard("builder", { wizard: wizardStub(log()) });
    expect(w.where()).toEqual({
      depth: 18,
      /* One less than `z.maxDepth`, because that is the deepest level `wizJumpLevel`
       * will accept - handing a panel the exclusive bound would put a slider's top
       * stop on a refusal. */
      maxDepth: 100,
      level: 22,
      experience: 15000,
      gold: 400,
      stats: [
        { name: "STR", value: 18 },
        { name: "INT", value: 12 },
        { name: "WIS", value: 10 },
        { name: "DEX", value: 16 },
        { name: "CON", value: 17 },
      ],
    });
  });
});

describe("arguments are checked before the engine sees them", () => {
  const armed = (): ModWizard => {
    setActiveId("slot-1");
    const w = createModWizard("builder", { wizard: wizardStub(log()) });
    w.sandbox();
    return w;
  };

  it("names what was not found", () => {
    expect(armed().spawnItem("Sword of Nothing")).toEqual({
      ok: false,
      problem: 'there is no item called "Sword of Nothing" in this game',
    });
    expect(armed().spawnCreature(99)).toEqual({
      ok: false,
      problem: "there is no creature at index 99 in this game",
    });
  });

  it("refuses a depth this game's dungeon does not have", () => {
    /* Rather than passing it through to a function whose out-of-range answer is a
     * silent false, which reads to a player as a button that does nothing. */
    expect(armed().goToDepth(500)).toEqual({
      ok: false,
      problem: "this game's dungeon stops at level 100",
    });
  });

  it("caps how many of one thing a single call may make", () => {
    /* These are loops over a placement routine that walks the floor. A mistyped
     * number should be a refusal, not a wedged page. */
    const outcome = armed().spawnCreature("Snarl", MAX_AT_ONCE + 1);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.problem).toContain(`${MAX_AT_ONCE} is the most`);
  });

  it("refuses a stat it has no name for", () => {
    expect(armed().setStat("LUK", 18)).toEqual({
      ok: false,
      problem: 'there is no stat called "LUK"',
    });
  });
});
