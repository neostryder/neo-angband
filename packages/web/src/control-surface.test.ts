import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlSurface, controlSurface, controlKey } from "./control-surface";
import { getAimDir, getCheck, getRepDir, itemSelect, promptTextInline, selectFromMenu, AIM_STAR } from "./overlay";
import type { GridPointerInput, GridSurface } from "./term";
import { setKeymapResolver } from "./input-door";

const term = {
  size: () => ({ cols: 80, rows: 24 }),
  clear: () => {}, print: () => {}, prt: () => {}, eraseToEol: () => {},
  setCursor: () => {},
} as unknown as GridSurface & GridPointerInput;

function invoke(label: string): void {
  const snapshot = controlSurface.current()!;
  const action = [...snapshot.context.rows ?? [], ...snapshot.context.replies ?? []]
    .find((candidate) => candidate.label === label)!;
  expect(action, label).toBeDefined();
  expect(controlSurface.invoke(snapshot.token, action.id)).toBe(true);
}

afterEach(() => { setKeymapResolver(undefined); });

describe("control context lifetimes", () => {
  it("shares root commands while guarding modal, busy and disabled invocation", () => {
    const surface = new ControlSurface();
    const run = vi.fn();
    let ready = true;
    surface.setCommands(() => ready, () => [
      { id: "throw", label: "Throw", category: "Items", run },
      { id: "blocked", label: "Blocked", category: "Items", disabled: true, run },
    ]);
    expect(surface.invokeCommand("throw")).toBe(true);
    expect(surface.invokeCommand("blocked")).toBe(false);
    const prompt = surface.push({ kind: "item", label: "Throw which item?" });
    expect(surface.invokeCommand("throw")).toBe(false);
    prompt.dispose();
    ready = false;
    expect(surface.invokeCommand("throw")).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("rejects stale, hidden and disabled answers and restores a parent with a fresh token", () => {
    const surface = new ControlSurface();
    const run = vi.fn();
    const parent = surface.push({ kind: "menu", label: "Book", rows: [{ id: "a", label: "Book", run }] });
    const old = surface.current()!.token;
    const child = surface.push({ kind: "check", label: "Confirm", replies: [{ id: "a", label: "No", disabled: true, run }] });
    expect(surface.invoke(old, "a")).toBe(false);
    expect(surface.invoke(surface.current()!.token, "a")).toBe(false);
    child.dispose();
    expect(surface.invoke(old, "a")).toBe(false);
    expect(surface.invoke(surface.current()!.token, "a")).toBe(true);
    parent.dispose();
    expect(run).toHaveBeenCalledTimes(1);
    expect(surface.current()).toBeUndefined();
  });
});

describe("real prompt producers through the control surface", () => {
  it.each([false, true])("selects item source, navigates without inscription digit collision, then aims (rogue=%s)", async (rogue) => {
    let emitted: unknown;
    let aimReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => { aimReady = resolve; });
    const flow = (async () => {
      const item = await itemSelect(term, "Throw which item?", [
        { label: "Inven", items: [{ label: "Ration", inscrip: "@v2" }, { label: "Flask" }] },
        { label: "Quiver", items: [{ label: "Arrow", tag: "0" }] },
      ], 0, "v", undefined, rogue);
      if (!item) return;
      const pendingAim = getAimDir(term, false);
      aimReady();
      const dir = await pendingAim;
      if (dir !== null) emitted = { item, dir };
    })();
    controlKey("ArrowDown");
    expect(controlSurface.current()!.context.rows?.find((row) => row.selected)?.label).toBe("Flask");
    invoke("Quiver");
    const previous = controlSurface.current()!;
    invoke("Arrow");
    await ready;
    expect(controlSurface.current()?.context.label).toBe("Aim");
    expect(controlSurface.invoke(previous.token, "row:0")).toBe(false);
    invoke("NE");
    await flow;
    expect(emitted).toEqual({ item: { source: 1, index: 0 }, dir: 9 });
  });

  it("hands aim to a target picker and can cancel the next aim without executing", async () => {
    const aim = getAimDir(term, false);
    invoke("Choose target");
    expect(await aim).toBe(AIM_STAR);
    const reprompt = getAimDir(term, false);
    invoke("Cancel");
    expect(await reprompt).toBeNull();
  });

  it("keeps book, spell, effect item, confirmation and direction answers distinct", async () => {
    const book = selectFromMenu(term, "test:book", "Book", [{ label: "Book" }]);
    invoke("Book");
    expect(await book).toBe(0);
    const spell = selectFromMenu(term, "test:spell", "Spell", [{ label: "Unavailable", disabled: true }, { label: "Spell" }]);
    invoke("Spell");
    expect(await spell).toBe(1);
    const item = itemSelect(term, "Effect item", [{ label: "Inven", items: [{ label: "Weapon" }] }]);
    invoke("Weapon");
    expect(await item).toEqual({ source: 0, index: 0 });
    const check = getCheck(term, "Proceed?");
    invoke("Yes");
    expect(await check).toBe(true);
    const direction = getRepDir(term, true);
    invoke("Self");
    expect(await direction).toBe(5);
  });

  it("bounds native text replies and prevents a keymap from changing a named answer", async () => {
    const resolver = vi.fn(() => [{ key: { key: "n", modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false } }]);
    setKeymapResolver(resolver);
    const check = getCheck(term, "Keep?");
    invoke("Yes");
    expect(await check).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
    const text = promptTextInline(term, "Rest", "&", 4);
    const token = controlSurface.current()!.token;
    expect(controlSurface.submit(token, "12345")).toBe(true);
    expect(await text).toBe("1234");
    expect(controlSurface.submit(token, "9999")).toBe(false);
  });
});
