import { describe, expect, it, vi } from "vitest";
import { MAX_BIRTH_POINTS, Rng, startGame } from "@rpgm-tools/neo-angband-core";
import type { BirthDeps } from "./birth";
import { BIRTH_NAME_MAX, createBirthSession, type BirthSessionDeps } from "./birth-session";
import { BIRTH_CAPABILITY, installBirth, offerBirth, setBirthPresenter } from "./birth-runtime";
import { loadGamePack } from "./pack";

const { booted, players } = startGame(loadGamePack(), { seed: 7, depth: 1 });

const birthDeps: BirthDeps = {
  bodyFor: (raceName) => {
    const race = players.raceByName(raceName);
    return race ? players.bodies[race.body] ?? null : null;
  },
  historyChartFor: (raceName) => {
    const race = players.raceByName(raceName);
    return race ? players.historyChart(race) : null;
  },
  properties: players.properties,
  elementNames: (booted.registries.projections ?? []).map((p) => p.name),
};

function session(over: Partial<BirthSessionDeps> = {}) {
  return createBirthSession({
    races: players.races,
    classes: players.classes,
    deps: birthDeps,
    rng: new Rng(11),
    quickstart: null,
    birthOptions: {},
    randomName: () => "Randal",
    pinnedName: null,
    ...over,
  });
}

const human = players.races.find((r) => r.name === "Human")!;
const warrior = players.classes.find((c) => c.name === "Warrior")!;
const mage = players.classes.find((c) => c.name === "Mage")!;

describe("ctx birth session catalogue", () => {
  it("lists every race and class with their traits and the point budget", () => {
    const cat = session().session.catalogue();
    expect(cat.races.map((r) => r.name)).toEqual(players.races.map((r) => r.name));
    expect(cat.classes.map((c) => c.name)).toEqual(players.classes.map((c) => c.name));
    const dwarf = cat.races.find((r) => r.name === "Dwarf")!;
    expect(dwarf.infravisionFeet).toBeGreaterThan(0);
    expect(Object.keys(dwarf.skills)).toContain("STEALTH");
    expect(cat.classes.find((c) => c.name === "Mage")!.magic.length).toBeGreaterThan(0);
    expect(cat.classes.find((c) => c.name === "Warrior")!.magic).toEqual([]);
    expect(cat.pointBudget).toBe(MAX_BIRTH_POINTS);
    expect(cat.nameMax).toBe(BIRTH_NAME_MAX);
    expect(cat.previous).toBeNull();
    expect(Object.isFrozen(cat.races[0])).toBe(true);
  });
});

describe("ctx birth session draft", () => {
  it("opens a race and class at the suggested spread, as the birth screens do", () => {
    const { session: s } = session();
    expect(s.draft().preview).toBeNull();
    expect(s.buy(0)).toMatchObject({ ok: false });
    s.chooseRace(human.name);
    s.chooseClass(warrior.name);
    const d = s.draft();
    expect(d.race).toBe(human.name);
    expect(d.method).toBe("point");
    expect(d.pointsLeft).toBeLessThanOrEqual(MAX_BIRTH_POINTS);
    expect(d.history.length).toBeGreaterThan(0);
    expect(d.preview?.stats).toHaveLength(5);
    expect(d.preview?.panels.map((p) => p.key)).toEqual(["topleft", "misc", "midleft", "combat", "skills"]);
    expect(d.ready).toBe(false);
  });

  it("buys and sells within the budget, and a new class replaces the work", () => {
    const { session: s } = session();
    s.chooseRace(human.name);
    s.chooseClass(warrior.name);
    s.reset();
    expect(s.draft().stats).toEqual([10, 10, 10, 10, 10]);
    expect(s.draft().pointsLeft).toBe(MAX_BIRTH_POINTS);
    expect(s.buy(0)).toEqual({ ok: true });
    expect(s.draft().stats[0]).toBe(11);
    expect(s.sell(0)).toEqual({ ok: true });
    expect(s.sell(0)).toMatchObject({ ok: false });
    s.buy(1);
    s.chooseClass(mage.name);
    expect(s.draft().stats).not.toEqual([10, 11, 10, 10, 10]);
  });

  it("rolls from the game stream and swaps back to the previous roll", () => {
    const rng = new Rng(11);
    const { session: s } = session({ rng });
    s.chooseRace(human.name);
    s.chooseClass(warrior.name);
    const history = s.draft().history;
    expect(history.length).toBeGreaterThan(0);
    s.roll();
    const first = s.draft().stats;
    expect(s.draft().method).toBe("roller");
    expect(s.draft().canPreviousRoll).toBe(false);
    s.roll();
    expect(s.draft().canPreviousRoll).toBe(true);
    s.previousRoll();
    expect(s.draft().stats).toEqual(first);
  });

  it("accepts a named draft into the choice the birth screens return", async () => {
    const { session: s, outcome } = session();
    s.chooseRace(human.name);
    s.chooseClass(warrior.name);
    expect(s.accept()).toMatchObject({ ok: false });
    expect(s.setName("x".repeat(BIRTH_NAME_MAX + 1))).toMatchObject({ ok: false });
    s.setName("Beren");
    s.setHistory("A plain background.");
    expect(s.setOption("birth_randarts", true)).toEqual({ ok: true });
    expect(s.setOption("rogue_like_commands", true)).toMatchObject({ ok: false });
    expect(s.draft().ready).toBe(true);
    expect(s.accept()).toEqual({ ok: true });
    const choice = await outcome;
    expect(choice).toMatchObject({
      raceName: human.name,
      className: warrior.name,
      name: "Beren",
      roller: "point",
      history: "A plain background.",
    });
    expect(choice?.stats).toHaveLength(5);
    expect(choice?.birthOptions?.birth_randarts).toBe(true);
    expect(s.chooseRace(human.name)).toMatchObject({ ok: false });
  });

  it("cancels to null and reuses the previous character", async () => {
    const { session: s, outcome } = session({
      quickstart: { raceName: human.name, className: mage.name, stats: [17, 10, 12, 14, 16] },
      previousName: "Aragorn II",
    });
    expect(s.catalogue().previous).toEqual({ race: human.name, cls: mage.name, name: "Aragorn II" });
    expect(s.draft().name).toBe("Aragorn III");
    s.usePrevious();
    expect(s.draft()).toMatchObject({ race: human.name, cls: mage.name, method: "point" });
    expect(s.draft().stats).toEqual([17, 10, 12, 14, 16]);
    s.cancel();
    expect(await outcome).toBeNull();
  });

  it("keeps a pinned name", () => {
    const { session: s } = session({ pinnedName: "Pinned" });
    expect(s.draft().name).toBe("Pinned");
    expect(s.setName("Other")).toMatchObject({ ok: false });
    expect(s.randomName()).toMatchObject({ ok: false });
    expect(s.catalogue().namePinned).toBe(true);
  });
});

describe("birth runtime", () => {
  const manifest = (caps: string[]) => ({ id: "m", name: "M", version: "1.0.0", shape: "plugin", capabilities: caps }) as never;

  it("needs the grant, and falls through when the presenter declines or throws", () => {
    const fault = vi.fn();
    const show = vi.fn(() => undefined);
    expect(installBirth([{ id: "m", manifest: manifest([]), plugin: { birth: () => ({ show }) } }], () => ({}) as never, fault)).toBeNull();
    expect(fault).toHaveBeenCalledTimes(1);

    const installed = installBirth([{ id: "m", manifest: manifest([BIRTH_CAPABILITY]), plugin: { birth: () => ({ show }) } }], () => ({}) as never, fault);
    expect(installed?.id).toBe("m");
    setBirthPresenter(installed, fault);
    const { session: s, outcome } = session();
    expect(offerBirth(s, outcome)).toBeUndefined();
    expect(show).toHaveBeenCalledWith(s);

    setBirthPresenter({ id: "m", presenter: { show: () => { throw new Error("boom"); } } }, fault);
    expect(offerBirth(s, outcome)).toBeUndefined();
    expect(fault).toHaveBeenCalledTimes(2);
    setBirthPresenter(null);
  });

  it("hands the outcome back when the presenter takes creation", async () => {
    setBirthPresenter({ id: "m", presenter: { show: () => true } });
    const { session: s, outcome } = session();
    const taken = offerBirth(s, outcome);
    expect(taken).toBeDefined();
    s.cancel();
    expect(await taken).toBeNull();
    setBirthPresenter(null);
  });
});
