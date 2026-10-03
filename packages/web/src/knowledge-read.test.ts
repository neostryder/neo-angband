import { describe, expect, it, vi } from "vitest";
import { Rng } from "@rpgm-tools/neo-angband-core";
import { createModKnowledge, withRngRestored, type KnowledgeCategorySource, type KnowledgeSources } from "./knowledge-read";
import { freezeView, SCREEN_FOOTER, type ScreenView } from "./screen-view";

interface Thing { id: number; name: string }

function page(title: string): ScreenView {
  return freezeView({ id: "core:test-recall", title, footer: SCREEN_FOOTER, blocks: [] });
}

function thingSource(groups: { name: string; members: Thing[] }[]): KnowledgeCategorySource<Thing> {
  return {
    groups: () => ({
      title: "things",
      groups: groups.map((g) => ({
        name: g.name,
        rows: g.members.map((m) => ({
          label: m.name,
          color: "#fff",
          member: m,
          cells: [{ text: "x", color: "#f00", col: 64 }],
        })),
      })),
    }),
    key: (m, group) => `${m.id}:${group}`,
    recall: (m, group) => page(`${group} ${m.name}`),
  };
}

const sources = (s: KnowledgeCategorySource<Thing>): KnowledgeSources =>
  ({ egos: s }) as unknown as KnowledgeSources;

describe("ctx.knowledge", () => {
  it("lists only the categories it has sources for, with their counts", () => {
    const k = createModKnowledge(sources(thingSource([
      { name: "Swords", members: [{ id: 1, name: "of Slay Evil" }] },
      { name: "Empty", members: [] },
      { name: "Polearms", members: [{ id: 1, name: "of Slay Evil" }, { id: 2, name: "(Holy Avenger)" }] },
    ])), () => undefined);
    expect(k.categories()).toEqual([{ id: "egos", title: "things", count: 3 }]);
  });

  it("drops empty groups, keeps the cells and freezes the listing", () => {
    const k = createModKnowledge(sources(thingSource([
      { name: "Empty", members: [] },
      { name: "Swords", members: [{ id: 1, name: "of Slay Evil" }] },
    ])), () => undefined);
    const list = k.list("egos")!;
    expect(list.groups.map((g) => g.name)).toEqual(["Swords"]);
    expect(list.groups[0]!.entries[0]).toEqual({
      id: "1:Swords",
      name: "of Slay Evil",
      color: "#fff",
      known: true,
      cells: [{ text: "x", color: "#f00" }],
    });
    expect(Object.isFrozen(list.groups[0]!.entries[0])).toBe(true);
    expect(k.list("objects")).toBeNull();
    expect(k.list("nonsense")).toBeNull();
  });

  it("marks an entry the player has not identified", () => {
    const source = thingSource([{ name: "Potions", members: [{ id: 1, name: "Smoky" }, { id: 2, name: "Cure Light Wounds" }] }]);
    const groups = source.groups;
    source.groups = () => {
      const view = groups();
      view.groups[0]!.rows[0]!.known = false;
      return view;
    };
    const entries = createModKnowledge(sources(source), () => undefined).list("egos")!.groups[0]!.entries;
    expect(entries.map((e) => [e.name, e.known])).toEqual([["Smoky", false], ["Cure Light Wounds", true]]);
  });

  it("recalls an entry through its own group, and nothing the player does not know", () => {
    const k = createModKnowledge(sources(thingSource([
      { name: "Swords", members: [{ id: 1, name: "of Slay Evil" }] },
      { name: "Polearms", members: [{ id: 1, name: "of Slay Evil" }] },
    ])), () => undefined);
    expect(k.recall("egos", "1:Polearms")?.title).toBe("Polearms of Slay Evil");
    expect(k.recall("egos", "9:Swords")).toBeNull();
    expect(k.recall("traps", "1:Swords")).toBeNull();
  });

  it("reads the live game on every call", () => {
    const members: Thing[] = [];
    const k = createModKnowledge(sources(thingSource([{ name: "Swords", members }])), () => undefined);
    expect(k.categories()[0]!.count).toBe(0);
    members.push({ id: 4, name: "of Westernesse" });
    expect(k.categories()[0]!.count).toBe(1);
    expect(k.recall("egos", "4:Swords")?.title).toBe("Swords of Westernesse");
  });

  it("puts the random stream back after a recall that draws from it", () => {
    const rng = new Rng(77);
    const drawing: KnowledgeCategorySource<Thing> = {
      ...thingSource([{ name: "Swords", members: [{ id: 1, name: "x" }] }]),
      recall: (m) => {
        rng.randint0(100);
        return page(m.name);
      },
    };
    const k = createModKnowledge(sources(drawing), () => rng);
    const before = JSON.stringify(rng.getState());
    k.recall("egos", "1:Swords");
    expect(JSON.stringify(rng.getState())).toBe(before);
  });
});

describe("withRngRestored", () => {
  it("restores the stream when the read throws", () => {
    const rng = new Rng(5);
    const before = JSON.stringify(rng.getState());
    expect(() => withRngRestored(rng, () => {
      rng.randint0(10);
      throw new Error("boom");
    })).toThrow("boom");
    expect(JSON.stringify(rng.getState())).toBe(before);
  });

  it("keeps a quick generator quick, on the same value", () => {
    const rng = new Rng(9, { quick: true });
    rng.randint0(10);
    const before = rng.getState();
    withRngRestored(rng, () => rng.randint0(10));
    expect(rng.getState()).toEqual(before);
    const control = new Rng(9, { quick: true });
    control.randint0(10);
    expect(rng.randint0(1000)).toBe(control.randint0(1000));
  });

  it("runs the read as is without a generator", () => {
    const read = vi.fn(() => 3);
    expect(withRngRestored(undefined, read)).toBe(3);
  });
});
