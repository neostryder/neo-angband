import { describe, expect, it } from "vitest";
import type { MenuTransformRow } from "@rpgm-tools/neo-angband-core";
import { MenuRegistry } from "./menu-registry";

const ROWS: readonly MenuTransformRow[] = [
  {
    id: "core:game-menu:inventory",
    label: "Inventory",
    semantic: { kind: "command", ref: "inventory" },
  },
];

describe("MenuRegistry", () => {
  it("layers a later mod by handing it the installed transformer", () => {
    const problems: string[] = [];
    const menus = new MenuRegistry((_owner, problem) => problems.push(problem));
    menus.forOwner("first").register("core:game-menu", (_id, rows) => [
      ...rows,
      { id: "first:rest", label: "Rest", semantic: { kind: "command", ref: "rest" } },
    ]);
    const previous = menus.forOwner("second").handlerFor("core:game-menu")!;
    menus.forOwner("second").register("core:game-menu", (id, rows) => [
      { id: "second:top", label: "Top", semantic: { kind: "command", ref: "top" } },
      ...previous(id, rows),
    ]);

    expect(menus.transform("core:game-menu", ROWS).map((row) => row.id)).toEqual([
      "second:top",
      "core:game-menu:inventory",
      "first:rest",
    ]);
    expect(problems).toEqual([]);
  });

  it("keeps the original menu when a transformer throws, and attributes the fault", () => {
    const problems: Array<[string | null, string]> = [];
    const menus = new MenuRegistry((owner, problem) => problems.push([owner, problem]));
    menus.forOwner("broken").register("core:game-menu", () => {
      throw new Error("no menu today");
    });

    expect(menus.transform("core:game-menu", ROWS)).toBe(ROWS);
    expect(problems).toEqual([["broken", 'menu "core:game-menu" transformer threw: no menu today']]);
  });

  it("keeps the original menu when a transformer returns something other than rows", () => {
    const problems: Array<[string | null, string]> = [];
    const menus = new MenuRegistry((owner, problem) => problems.push([owner, problem]));
    menus.forOwner("invalid").register("core:game-menu", (() => ({ nope: true })) as never);

    expect(menus.transform("core:game-menu", ROWS)).toBe(ROWS);
    expect(problems).toEqual([
      ["invalid", 'menu "core:game-menu" transformer returned rows that are not menu rows'],
    ]);
  });
});
