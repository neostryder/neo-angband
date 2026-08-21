/**
 * The DOM panel seam, and specifically the half of it that is a PRIVILEGE.
 *
 * Mounting a div is not the interesting part - a mod could always do that, with
 * no capability, because its code runs in the page (panel-runtime.ts's header
 * says so at length). What is new is that a panel can stand the game's input
 * door down, and a panel that withholds keystrokes and then does nothing with
 * them is a game that has stopped responding for no reason the player can see.
 *
 * So most of what is pinned here is the FAILING OPEN: every way a container can
 * stop being a panel, and the fact that each one hands the keyboard back rather
 * than holding it. The rest pins the player's way out, which is worth a test
 * each because a promise about a key is worth exactly nothing if the key is
 * conditional on something the mod controls.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_OPEN_PANELS,
  PLAYER_CLOSE_COOLDOWN_MS,
  closeAllModPanels,
  createModUi,
  panelKeyboardOwner,
  panelSpecFault,
  resetModPanels,
  revokeModPanels,
  setPanelGameSurface,
} from "./panel-runtime";

/* --- the smallest document a panel can be mounted into -------------------- */

interface FakeNode {
  tagName: string;
  parentNode: FakeNode | null;
  readonly children: FakeNode[];
  readonly attrs: Map<string, string>;
  readonly dataset: Record<string, string>;
  readonly style: Record<string, string>;
  readonly listeners: Map<string, Array<() => void>>;
  shadow: { host: FakeNode; readonly mode: string } | null;
  tabIndex: number;
  type: string;
  textContent: string;
  focused: boolean;
  readonly isConnected: boolean;
  readonly ownerDocument: { body: FakeNode };
  appendChild(child: FakeNode): FakeNode;
  remove(): void;
  contains(other: unknown): boolean;
  setAttribute(k: string, v: string): void;
  addEventListener(type: string, fn: () => void): void;
  attachShadow(init: { mode: string }): { host: FakeNode; mode: string };
  focus(): void;
}

let body: FakeNode;

function node(tagName: string): FakeNode {
  const self: FakeNode = {
    tagName,
    parentNode: null,
    children: [],
    attrs: new Map(),
    dataset: {},
    style: {},
    listeners: new Map(),
    shadow: null,
    tabIndex: 0,
    type: "",
    textContent: "",
    focused: false,
    get isConnected(): boolean {
      let at: FakeNode | null = self;
      while (at) {
        if (at === body) return true;
        at = at.parentNode;
      }
      return false;
    },
    get ownerDocument(): { body: FakeNode } {
      return { body };
    },
    appendChild: (child) => {
      child.parentNode?.children.splice(child.parentNode.children.indexOf(child), 1);
      child.parentNode = self;
      self.children.push(child);
      return child;
    },
    remove: () => {
      const at = self.parentNode;
      if (!at) return;
      at.children.splice(at.children.indexOf(self), 1);
      self.parentNode = null;
    },
    contains: (other) => {
      let at = other as FakeNode | null;
      while (at) {
        if (at === self) return true;
        at = at.parentNode;
      }
      return false;
    },
    setAttribute: (k, v) => void self.attrs.set(k, v),
    addEventListener: (type, fn) => {
      const list = self.listeners.get(type) ?? [];
      list.push(fn);
      self.listeners.set(type, list);
    },
    attachShadow: (init) => {
      self.shadow = { host: self, mode: init.mode };
      return self.shadow;
    },
    focus: () => void (self.focused = true),
  };
  return self;
}

/**
 * The fake canvas, as the panel layer's own accessor takes it.
 *
 * Cast at ONE place rather than at each call site: this document is a handful of
 * methods, `Element` is 170, and a test that widened the fake until the compiler
 * agreed would be a test about `lib.dom` rather than about the seam. What the
 * runtime actually uses of it - `contains`, identity, `focus` - the fake has.
 */
function asSurface(el: FakeNode): Element {
  return el as unknown as Element;
}

function installDom(): void {
  body = node("body");
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => node(tag),
    body,
  };
}

/** The container the host mounted for `id`, or undefined. */
function containerOf(id: string): FakeNode | undefined {
  return body.children.find((child) => child.dataset["modPanel"] === id);
}

/** A keydown as the door would see it: real, un-repeated, not composing. */
function keydown(
  target: unknown,
  key = "a",
  over: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  /* `composedPath` walks the fake tree, which is what the real one does across a
   * shadow boundary: the host element and everything above it. */
  const path: unknown[] = [];
  let at = target as FakeNode | null;
  while (at) {
    path.push(at);
    at = at.parentNode;
  }
  return {
    key,
    target,
    isTrusted: true,
    repeat: false,
    isComposing: false,
    composedPath: () => path,
    ...over,
  } as unknown as KeyboardEvent;
}

afterEach(() => {
  resetModPanels();
  setPanelGameSurface(undefined);
  delete (globalThis as { document?: unknown }).document;
});

describe("openPanel", () => {
  it("hands the mod a shadow root inside a container the mod never gets", () => {
    installDom();
    const panel = createModUi("builder").openPanel({ id: "editor", modal: true });
    expect(panel.id).toBe("builder:editor");
    expect(panel.open).toBe(true);
    /* CLOSED, so another mod cannot read a panel's fields out of
     * `element.shadowRoot`. A small real difference, not a boundary. */
    expect(panel.root as unknown as { mode: string }).toMatchObject({ mode: "closed" });
    const container = containerOf("builder:editor");
    expect(container?.parentNode).toBe(body);
    /* The shadow is on a CHILD of the container, not the container, which is
     * what leaves the container free to carry the host's close control. */
    expect(container?.shadow).toBeNull();
  });

  it("gives a modal panel the pointer, the focus and a close control; a plain one none of them", () => {
    installDom();
    const ui = createModUi("builder");
    ui.openPanel({ id: "modal", modal: true });
    ui.openPanel({ id: "plain" });
    const modal = containerOf("builder:modal");
    const plain = containerOf("builder:plain");
    expect(modal?.style["pointerEvents"]).toBe("auto");
    expect(modal?.focused).toBe(true);
    expect(modal?.children.some((c) => c.tagName === "button")).toBe(true);
    /* A full-viewport container that took the pointer would eat every tap meant
     * for the dungeon underneath it, which is why this one takes none. */
    expect(plain?.style["pointerEvents"]).toBe("none");
    expect(plain?.focused).toBe(false);
    expect(plain?.children.some((c) => c.tagName === "button")).toBe(false);
  });

  it("answers openPanels about the asking mod and nobody else", () => {
    installDom();
    const mine = createModUi("mine");
    const yours = createModUi("yours");
    mine.openPanel({ id: "a" });
    yours.openPanel({ id: "b" });
    expect(mine.openPanels).toEqual(["mine:a"]);
    expect(yours.openPanels).toEqual(["yours:b"]);
  });

  it("refuses a spec an author can act on the refusal of", () => {
    expect(panelSpecFault(null)).toContain("not a panel spec");
    expect(panelSpecFault({})).toContain("no id");
    expect(panelSpecFault({ id: "a:b" })).toContain('name it "a-b"');
    expect(panelSpecFault({ id: "ok", modal: 1 })).toContain("not a boolean");
    expect(panelSpecFault({ id: "ok" })).toBeUndefined();
  });

  it("throws rather than returning a handle onto nothing", () => {
    installDom();
    const ui = createModUi("builder");
    ui.openPanel({ id: "editor" });
    /* A dead handle would let a mod build its whole interface into a detached
     * node and report success. */
    expect(() => ui.openPanel({ id: "editor" })).toThrow(/already open/);
    expect(() => ui.openPanel({ id: "" })).toThrow(/no id/);
  });

  it("caps the stack, because Escape closes one at a time", () => {
    installDom();
    const ui = createModUi("builder");
    for (let i = 0; i < MAX_OPEN_PANELS; i++) ui.openPanel({ id: `p${i}` });
    expect(() => ui.openPanel({ id: "over" })).toThrow(
      new RegExp(`${MAX_OPEN_PANELS} panels are already open`),
    );
  });

  it("refuses on a front end with no page, rather than later", () => {
    expect(() => createModUi("builder", undefined).openPanel({ id: "editor" })).toThrow(
      /no page to mount a panel on/,
    );
  });
});

describe("who owns a keystroke", () => {
  it("gives the game every key while no panel is open", () => {
    installDom();
    expect(panelKeyboardOwner.owns(keydown(body))).toBe(false);
  });

  it("gives the panel a key aimed inside it and the game one aimed at the map", () => {
    installDom();
    const surface = node("canvas");
    body.appendChild(surface);
    setPanelGameSurface(asSurface(surface));
    createModUi("builder").openPanel({ id: "editor", modal: true });
    const container = containerOf("builder:editor");
    expect(panelKeyboardOwner.owns(keydown(container))).toBe(true);
    expect(panelKeyboardOwner.owns(keydown(surface))).toBe(false);
  });

  it("makes a panel underneath another inert", () => {
    installDom();
    const ui = createModUi("builder");
    ui.openPanel({ id: "under", modal: true });
    ui.openPanel({ id: "over", modal: true });
    /* Otherwise a mod holds focus in a panel the player cannot see and types
     * into something invisible. */
    expect(panelKeyboardOwner.owns(keydown(containerOf("builder:under")))).toBe(false);
    expect(panelKeyboardOwner.owns(keydown(containerOf("builder:over")))).toBe(true);
  });
});

describe("failing open", () => {
  it("hands the keyboard back when a container leaves the document without close()", () => {
    installDom();
    const panel = createModUi("builder").openPanel({ id: "editor", modal: true });
    const container = containerOf("builder:editor")!;
    container.remove();
    expect(panelKeyboardOwner.owns(keydown(container))).toBe(false);
    /* And the handle is settled, so a mod awaiting `closed` is not left waiting
     * on a panel that is already gone. */
    expect(panel.open).toBe(false);
  });

  it("hands the keyboard back when a container is moved out of the panel layer", () => {
    installDom();
    const elsewhere = node("div");
    body.appendChild(elsewhere);
    createModUi("builder").openPanel({ id: "editor", modal: true });
    const container = containerOf("builder:editor")!;
    elsewhere.appendChild(container);
    expect(panelKeyboardOwner.owns(keydown(container))).toBe(false);
  });

  it("hands the keyboard back when a container is made a parent of the game's display", () => {
    installDom();
    const surface = node("canvas");
    body.appendChild(surface);
    setPanelGameSurface(asSurface(surface));
    createModUi("builder").openPanel({ id: "editor", modal: true });
    const container = containerOf("builder:editor")!;
    /* THE DECISIVE ONE. With the canvas inside the panel, every keystroke aimed
     * at the game runs through the panel and the nearest-owner test cannot save
     * the player, because the panel IS nearer. */
    container.appendChild(surface);
    expect(panelKeyboardOwner.owns(keydown(surface))).toBe(false);
    expect(container.isConnected).toBe(false); // closed, not merely skipped
  });
});

describe("the way out", () => {
  it("closes the topmost panel and gives focus back to the game", () => {
    installDom();
    const surface = node("canvas");
    body.appendChild(surface);
    setPanelGameSurface(asSurface(surface));
    const ui = createModUi("builder");
    const under = ui.openPanel({ id: "under", modal: true });
    const over = ui.openPanel({ id: "over", modal: true });
    expect(panelKeyboardOwner.escape(keydown(body, "Escape"))).toBe(true);
    expect(over.open).toBe(false);
    expect(under.open).toBe(true);
    /* Never back into the subtree that was just deleted, or the second press
     * would have nothing to act on. */
    expect(surface.focused).toBe(true);
  });

  it("works when focus has drifted off the panel entirely", () => {
    installDom();
    const surface = node("canvas");
    body.appendChild(surface);
    setPanelGameSurface(asSurface(surface));
    const panel = createModUi("builder").openPanel({ id: "editor", modal: true });
    /* One stray click on the map is enough to make this the real case, which is
     * why the hatch is asked about every Escape rather than only owned ones. */
    expect(panelKeyboardOwner.escape(keydown(surface, "Escape"))).toBe(true);
    expect(panel.open).toBe(false);
  });

  it("leaves Escape to the game when the only panel is furniture", () => {
    installDom();
    const surface = node("canvas");
    body.appendChild(surface);
    setPanelGameSurface(asSurface(surface));
    const panel = createModUi("builder").openPanel({ id: "compass" });
    /* A decorative panel has not asked for the screen, so Escape on the map is
     * still the game's, exactly as it is with no mod loaded. */
    expect(panelKeyboardOwner.escape(keydown(surface, "Escape"))).toBe(false);
    expect(panel.open).toBe(true);
    /* Aimed at the panel it is the panel's. */
    expect(panelKeyboardOwner.escape(keydown(containerOf("builder:compass"), "Escape"))).toBe(true);
  });

  it("answers only to the real keyboard", () => {
    installDom();
    const ui = createModUi("builder");
    ui.openPanel({ id: "editor", modal: true });
    /* A mod can synthesise a KeyboardEvent, and a host-global action driven by
     * one is the mod pressing the player's key. */
    expect(panelKeyboardOwner.escape(keydown(body, "Escape", { isTrusted: false }))).toBe(false);
    /* A held Escape would otherwise close the stack and then leak the rest of
     * the presses into whatever prompt was underneath. */
    expect(panelKeyboardOwner.escape(keydown(body, "Escape", { repeat: true }))).toBe(false);
    /* Mid-composition, Escape means "cancel what I am typing" to every IME
     * there is; the first one is the composition's and the next is the panel's. */
    expect(panelKeyboardOwner.escape(keydown(body, "Escape", { isComposing: true }))).toBe(false);
    expect(ui.openPanels).toEqual(["builder:editor"]);
  });

  it("cannot be outrun by a mod that reopens on close", () => {
    installDom();
    const ui = createModUi("builder");
    ui.openPanel({ id: "editor", modal: true });
    expect(panelKeyboardOwner.escape(keydown(body, "Escape"))).toBe(true);
    /* Without the pause, `closed.then(reopen)` turns the one key that gets the
     * player out into a key that makes the panel flicker. */
    expect(() => ui.openPanel({ id: "editor", modal: true })).toThrow(
      new RegExp(`${PLAYER_CLOSE_COOLDOWN_MS}ms`),
    );
  });

  it("charges a mod nothing for closing its own panel", () => {
    installDom();
    const ui = createModUi("builder");
    ui.openPanel({ id: "step1", modal: true }).close();
    /* An authoring tool walks the player through steps, and charging it for its
     * own navigation would make the seam unusable for the thing it is for. */
    expect(() => ui.openPanel({ id: "step2", modal: true })).not.toThrow();
  });
});

describe("teardown", () => {
  it("shuts the door before it clears the room", () => {
    installDom();
    const ui = createModUi("builder");
    const panel = ui.openPanel({ id: "editor", modal: true });
    revokeModPanels();
    /* Revoked FIRST, so a mod's uninstall() cannot open a panel on the way out;
     * the existing one stays up through uninstall() because reading what the
     * player typed is what a last moment is for. */
    expect(() => ui.openPanel({ id: "another" })).toThrow(/about to re-compose/);
    expect(panel.open).toBe(true);
    expect(closeAllModPanels()).toBe(1);
    expect(panel.open).toBe(false);
    expect(body.children).toHaveLength(0);
  });

  it("settles every handle it closes", async () => {
    installDom();
    const panel = createModUi("builder").openPanel({ id: "editor" });
    closeAllModPanels();
    /* A mod awaiting `closed` to save a draft must not be left waiting because
     * the host, rather than the player, was the one who closed the panel. */
    await expect(panel.closed).resolves.toBeUndefined();
  });
});
