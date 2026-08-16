/**
 * Who asks the game's questions, and what happens when they answer badly.
 *
 * THE TEST THAT EARNS ITS KEEP is the last describe. A presenter answering
 * `command` runs the CALLER's own handler with the caller's own sentinels, and
 * that rule now exists in two places - the keydown path in `selectFromMenu` and
 * `runMenuCommand` beside it. Two copies of a rule drift; the guard against it
 * is to drive the same command down both paths in one test and assert they
 * produce the same thing, so a change to one that is not made to the other fails
 * here rather than in a store nobody reimagined yet.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  MENU_CAPABILITY,
  installMenu,
  menuClaimants,
  setMenuPresenter,
} from "./menu-runtime";
import type { MenuPlugin } from "./menu-runtime";
import type { MenuAnswer, MenuPresenter, MenuQuestion } from "./menu-view";
import { MENU_CLOSE, MENU_OPTIONS, MENU_REFRESH, selectFromMenu, setUiFaultReporter } from "./overlay";
import type { MenuItem, SelectMenuOptions } from "./overlay";
import type { GlyphTerm } from "./term";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: Array<{ type: string; fn: (ev: Event) => void; capture: boolean }> = [];
  return {
    addEventListener(type, fn, capture = false) {
      listeners.push({ type, fn, capture });
    },
    removeEventListener(type, fn, capture = false) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const l of [...listeners].filter((x) => x.type === ev.type)) l.fn(ev);
    },
  };
}

/** A terminal that swallows everything: these tests are about answers, not pixels. */
function makeTerm(cols = 40, rows = 12): GlyphTerm {
  return {
    size: () => ({ cols, rows }),
    clear: () => undefined,
    print: () => undefined,
    put: () => undefined,
    eraseToEol: () => undefined,
    setCursor: () => undefined,
  } as unknown as GlyphTerm;
}

/** Let the presenter path finish its awaits and reach the terminal fallback. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function press(win: FakeWindow, key: string, ctrl = false): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & {
    key: string;
    ctrlKey: boolean;
  };
  ev.key = key;
  ev.ctrlKey = ctrl;
  win.dispatchEvent(ev);
}

function manifest(id: string, capabilities: string[]): PackManifest {
  return { id, name: id, version: "1.0.0", shape: "plugin", capabilities };
}

function candidate(
  id: string,
  capabilities: string[],
  menu?: MenuPlugin["plugin"]["menu"],
): MenuPlugin {
  return { id, manifest: manifest(id, capabilities), plugin: menu ? { menu } : {} };
}

const CONTEXT = () => ({}) as never;

/** A presenter that answers each question with the next scripted answer. */
function scripted(...answers: (MenuAnswer | undefined)[]): {
  presenter: MenuPresenter;
  asked: MenuQuestion[];
} {
  const asked: MenuQuestion[] = [];
  let at = 0;
  return {
    asked,
    presenter: {
      ask(question) {
        asked.push(question);
        return answers[at++];
      },
    },
  };
}

const ROWS: readonly MenuItem[] = [
  { id: "row:buy", label: "Buy", semantic: { kind: "command", ref: "buy" } },
  { id: "row:sell", label: "Sell", semantic: { kind: "command", ref: "sell" } },
  { id: "row:leave", label: "Leave", semantic: { kind: "command", ref: "leave" } },
];

function ask(extra?: SelectMenuOptions): Promise<number | null> {
  return selectFromMenu(makeTerm(), "store:command", "Store", ROWS, undefined, extra);
}

afterEach(() => {
  setMenuPresenter(null);
  setUiFaultReporter(() => undefined);
});

/* ------------------------------------------------------------------ */

describe("selecting the menu presenter", () => {
  it("refuses a mod that declares menu() with no capability, and says how to fix it", () => {
    const faults: string[] = [];
    const installed = installMenu(
      [candidate("dial", [], () => ({ ask: () => undefined }))],
      CONTEXT,
      (id, message) => faults.push(`${id}: ${message}`),
    );
    expect(installed).toBeNull();
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain(MENU_CAPABILITY);
  });

  it("accepts the wildcard, because the menus are part of the interface", () => {
    const installed = installMenu(
      [candidate("skin", ["ui:*.replace"], () => ({ ask: () => undefined }))],
      CONTEXT,
      () => undefined,
    );
    expect(installed?.id).toBe("skin");
  });

  it("does not let a HUD grant carry the menus, or the reverse", () => {
    /* The consent argument, made falsifiable in both directions: a player who
     * agreed to a vitals panel did not agree to every menu in the game. */
    expect(
      installMenu(
        [candidate("vitals", ["ui:sidebar.replace"], () => ({ ask: () => undefined }))],
        CONTEXT,
        () => undefined,
      ),
    ).toBeNull();
    expect(
      installMenu(
        [candidate("dial", ["display:replace"], () => ({ ask: () => undefined }))],
        CONTEXT,
        () => undefined,
      ),
    ).toBeNull();
  });

  it("gives the menus to the LAST eligible mod, and never calls the loser", () => {
    const called: string[] = [];
    const one = candidate("first", [MENU_CAPABILITY], () => {
      called.push("first");
      return { ask: () => undefined };
    });
    const two = candidate("second", [MENU_CAPABILITY], () => {
      called.push("second");
      return { ask: () => undefined };
    });
    expect(installMenu([one, two], CONTEXT, () => undefined)?.id).toBe("second");
    /* Not merely unselected - never constructed. `menu()` may create DOM. */
    expect(called).toEqual(["second"]);
  });

  it("reports a losing mod's missing capability anyway", () => {
    /* Its mistake does not become invisible because somebody else won. A mod
     * author who removed the other mod would otherwise find their own still
     * silently doing nothing, with no clue why. */
    const faults: string[] = [];
    installMenu(
      [
        candidate("broken", [], () => ({ ask: () => undefined })),
        candidate("good", [MENU_CAPABILITY], () => ({ ask: () => undefined })),
      ],
      CONTEXT,
      (id) => faults.push(id),
    );
    expect(faults).toEqual(["broken"]);
  });

  it("treats a declining or unusable menu() as the game keeping its questions", () => {
    const faults: string[] = [];
    expect(installMenu([candidate("a", [MENU_CAPABILITY], () => undefined)], CONTEXT, () => undefined)).toBeNull();
    expect(faults).toEqual([]);
    expect(
      installMenu(
        [candidate("b", [MENU_CAPABILITY], () => ({}) as MenuPresenter)],
        CONTEXT,
        (id) => faults.push(id),
      ),
    ).toBeNull();
    expect(faults).toEqual(["b"]);
  });

  it("lists only eligible claimants for the conflict report", () => {
    expect(
      menuClaimants([
        candidate("no-cap", [], () => ({ ask: () => undefined })),
        candidate("yes", [MENU_CAPABILITY], () => ({ ask: () => undefined })),
        candidate("no-hook", [MENU_CAPABILITY]),
      ]),
    ).toEqual(["yes"]);
  });
});

describe("the question a presenter is handed", () => {
  it("carries the choices with their ids and semantics, not their row positions", async () => {
    const { presenter, asked } = scripted({ kind: "cancel" });
    setMenuPresenter({ id: "dial", presenter });
    await ask();

    expect(asked).toHaveLength(1);
    const question = asked[0]!;
    expect(question.id).toBe("store:command");
    expect(question.choices.map((c) => c.id)).toEqual(["row:buy", "row:sell", "row:leave"]);
    expect(question.choices[0]?.semantic).toEqual({ kind: "command", ref: "buy" });
    expect(question.style).toBe("screen");
    expect(question.browseOnly).toBe(false);
  });

  it("is frozen, because a presenter may keep it while it animates", async () => {
    const { presenter, asked } = scripted({ kind: "cancel" });
    setMenuPresenter({ id: "dial", presenter });
    await ask();
    const question = asked[0]!;
    expect(Object.isFrozen(question)).toBe(true);
    expect(Object.isFrozen(question.choices)).toBe(true);
    expect(Object.isFrozen(question.choices[0])).toBe(true);
  });

  it("names the command keys the caller handles, including the options key", async () => {
    /* A presenter cannot invent these - they belong to whoever opened the menu -
     * so a reimagined store finds out what else that screen can do by reading
     * them. '=' is included although the host answers it with a sentinel rather
     * than a handler: from the presenter's side it is a key that does something
     * other than choose, which is what the list means. */
    const { presenter, asked } = scripted({ kind: "cancel" });
    setMenuPresenter({ id: "dial", presenter });
    await ask({
      commands: { p: () => null, s: () => null },
      ctrlCommands: { x: () => null },
      optionsKey: "=",
    });
    expect(asked[0]?.commands).toEqual([
      { key: "p", ctrl: false },
      { key: "s", ctrl: false },
      { key: "x", ctrl: true },
      { key: "=", ctrl: false },
    ]);
  });

  it("starts the cursor where the terminal would have started it", async () => {
    /* The two disagreeing would put a reimagined menu's highlight on a different
     * row from the one the game thinks is selected - and only on menus whose
     * first row is disabled, which is the worst kind of bug to go looking for. */
    const { presenter, asked } = scripted({ kind: "cancel" });
    setMenuPresenter({ id: "dial", presenter });
    await selectFromMenu(makeTerm(), "m", "M", [
      { id: "a", label: "Header", disabled: true },
      { id: "b", label: "Real" },
    ]);
    expect(asked[0]?.cursor).toBe(1);
  });

  it("hands the detail pane over as a live call, frozen per call", async () => {
    let asks = 0;
    const { presenter, asked } = scripted({ kind: "cancel" });
    setMenuPresenter({ id: "dial", presenter });
    await ask({
      detail: (index) => {
        asks++;
        return [{ text: `about ${index}` }];
      },
    });
    /* Not materialised up front: a pane is computed per cursor position (a
     * spell's failure rate, a mod's description) and running all of them for
     * choices nobody looks at is work the terminal never did either. */
    expect(asks).toBe(0);
    const lines = asked[0]!.detail(1);
    expect(lines).toEqual([{ text: "about 1" }]);
    expect(Object.isFrozen(lines[0])).toBe(true);
  });
});

describe("answering", () => {
  it("resolves with the caller's own index for the chosen id", async () => {
    setMenuPresenter({ id: "dial", presenter: scripted({ kind: "choose", choice: "row:sell" }).presenter });
    expect(await ask()).toBe(1);
  });

  it("treats cancel as ESC", async () => {
    setMenuPresenter({ id: "dial", presenter: scripted({ kind: "cancel" }).presenter });
    expect(await ask()).toBeNull();
  });

  it("answers the options key with the caller's sentinel", async () => {
    setMenuPresenter({ id: "dial", presenter: scripted({ kind: "options" }).presenter });
    expect(await ask({ optionsKey: "=" })).toBe(MENU_OPTIONS);
  });

  it("hands the menu back to the game when the presenter declines", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    setMenuPresenter({ id: "dial", presenter: scripted(undefined).presenter });
    const done = ask();
    await tick();
    /* The terminal is now up and taking keys - the whole point of declining. */
    press(win, "b");
    expect(await done).toBe(1);
  });

  it("keeps the seam but loses this menu for an answer that cannot be honoured", async () => {
    const cases: [MenuAnswer, string, SelectMenuOptions | undefined][] = [
      [{ kind: "choose", choice: "row:nope" }, "unknown choice", undefined],
      [{ kind: "choose", choice: "row:sell" }, "browse-only", { browseOnly: true }],
      [{ kind: "options" }, "no options key", undefined],
      [{ kind: "command", key: "q", cursor: 0 }, "unoffered command", undefined],
    ];
    for (const [answer, why, extra] of cases) {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const faults: string[] = [];
      setUiFaultReporter((id, message) => faults.push(`${id}: ${message}`));
      setMenuPresenter({ id: "dial", presenter: scripted(answer).presenter });
      const done = ask(extra);
      await tick();
      press(win, "Escape");
      expect(await done, why).toBeNull();
      expect(faults, why).toHaveLength(1);
      expect(faults[0], why).toContain("store:command");
    }
  });

  it("refuses a disabled choice rather than resolving with it", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const faults: string[] = [];
    setUiFaultReporter((id, message) => faults.push(message));
    setMenuPresenter({ id: "dial", presenter: scripted({ kind: "choose", choice: "x" }).presenter });
    const done = selectFromMenu(makeTerm(), "m", "M", [{ id: "x", label: "Too hard", disabled: true }]);
    await tick();
    press(win, "Escape");
    expect(await done).toBeNull();
    expect(faults[0]).toContain("disabled");
  });

  it("takes the menus away from a presenter that THREW, and only reports it once", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const faults: string[] = [];
    setUiFaultReporter((id, message) => faults.push(`${id}: ${message}`));
    setMenuPresenter({
      id: "dial",
      presenter: {
        ask() {
          throw new Error("no");
        },
      },
    });

    const first = ask();
    await tick();
    press(win, "Escape");
    expect(await first).toBeNull();

    /* Unlike the HUD, where a fault costs ONE region: a presenter that throws on
     * one question generally throws on all of them, and a fault report every
     * time the player opens anything is worse than one and out. */
    const second = ask();
    press(win, "Escape");
    expect(await second).toBeNull();
    expect(faults).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */

describe("a command means the same thing on both paths", () => {
  /**
   * Each case runs TWICE against the same menu: once by pressing the key, once
   * by a presenter answering `{kind: "command"}`. The assertion is that the two
   * agree - on the resolved value AND on what the caller's handler saw - because
   * the sentinel rules now live in two places and a copy that drifts is exactly
   * the bug this shape invites.
   */
  const cases: {
    name: string;
    key: string;
    ctrl?: boolean;
    handler: (cursor: number) => number | null | void;
    expected: number | null;
  }[] = [
    { name: "a handler naming a row resolves with it", key: "p", handler: () => 2, expected: 2 },
    { name: "a handler returning null keeps the menu up", key: "p", handler: () => null, expected: null },
    { name: "MENU_REFRESH is not treated as a row index", key: "p", handler: () => MENU_REFRESH, expected: MENU_REFRESH },
    { name: "a control chord closing the menu", key: "x", ctrl: true, handler: () => MENU_CLOSE, expected: MENU_CLOSE },
  ];

  for (const { name, key, ctrl, handler, expected } of cases) {
    it(name, async () => {
      const seen: number[] = [];
      const spy = (cursor: number): number | null | void => {
        seen.push(cursor);
        return handler(cursor);
      };
      const extra: SelectMenuOptions = ctrl ? { ctrlCommands: { [key]: spy } } : { commands: { [key]: spy } };

      /* The keydown path. `null` here means "the handler consumed the key and
       * the menu stayed up", so ESC is what ends it - which is itself the
       * behaviour being compared. */
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const byKey = ask(extra);
      press(win, key, ctrl === true);
      if (expected === null) press(win, "Escape");
      const keyResult = await byKey;

      /* The presenter path, same menu, same handler. */
      const win2 = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win2;
      setMenuPresenter({
        id: "dial",
        presenter: scripted({ kind: "command", key, ...(ctrl ? { ctrl } : {}), cursor: 0 }, { kind: "cancel" })
          .presenter,
      });
      const byPresenter = ask(extra);
      const presenterResult = await byPresenter;

      expect(presenterResult).toBe(keyResult);
      expect(presenterResult).toBe(expected);
      /* And the handler saw the same cursor both times, which is what makes a
       * store's "buy what is under the cursor" mean the same thing. */
      expect(seen).toEqual([0, 0]);
    });
  }

  it("asks again after a command that did not resolve, exactly as the key does", async () => {
    let runs = 0;
    const { presenter, asked } = scripted(
      { kind: "command", key: "p", cursor: 1 },
      { kind: "command", key: "p", cursor: 1 },
      { kind: "choose", choice: "row:leave" },
    );
    setMenuPresenter({ id: "dial", presenter });
    const result = await ask({
      commands: {
        p: () => {
          runs++;
          return null;
        },
      },
    });
    expect(runs).toBe(2);
    expect(asked).toHaveLength(3);
    expect(result).toBe(2);
  });

  it("clamps a cursor the presenter made up rather than handing the caller a bad row", async () => {
    /* A presenter laying its choices out as a dial has no obligation to keep the
     * game's row numbering, and a handler indexing its own list with 99 is the
     * caller's crash, not the mod's. */
    const seen: number[] = [];
    setMenuPresenter({
      id: "dial",
      presenter: scripted({ kind: "command", key: "p", cursor: 99 }).presenter,
    });
    await ask({
      commands: {
        p: (cursor) => {
          seen.push(cursor);
          return 0;
        },
      },
    });
    expect(seen).toEqual([2]);
  });
});
