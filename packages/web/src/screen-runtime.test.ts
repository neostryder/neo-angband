/**
 * Who shows the game's full screens, and what happens when they show them badly.
 *
 * THE TESTS THAT EARN THEIR KEEP are the last two describes. A screen has no
 * answer, so "the presenter took it" is expressed by a promise that resolves on
 * dismissal - which means a presenter that takes a screen and then dies leaves the
 * player looking at nothing, holding a keyboard the dead overlay is no longer
 * reading. `showTextScreen` has to notice and show the screen itself. That is the
 * one failure mode this seam has that the menus do not, because a menu that never
 * answers is a menu the game is still painting underneath.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  SCREEN_CAPABILITY,
  installScreen,
  screenClaimants,
  setScreenPresenter,
  showThroughPresenter,
  terminalIsYielded,
  withTerminal,
} from "./screen-runtime";
import type { ScreenPlugin, YieldingScreen } from "./screen-runtime";
import { promptRequest, type PromptRequest } from "./prompt-view";
import { SCREEN_FOOTER, freezeView, type ScreenPresenter, type ScreenView } from "./screen-view";
import { showTextScreen, setUiFaultReporter } from "./overlay";
import type { GridPointerInput, GridSurface } from "./term";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** A terminal that records what it printed: these tests ask "who drew it". */
function makeTerm(): GridSurface & GridPointerInput & { printed: string[] } {
  const printed: string[] = [];
  return {
    printed,
    size: () => ({ cols: 40, rows: 12 }),
    clear: () => undefined,
    print: (_x: number, _y: number, text: string) => void printed.push(text),
    put: () => undefined,
    eraseToEol: () => undefined,
    setCursor: () => undefined,
  } as unknown as GridSurface & GridPointerInput & { printed: string[] };
}

function manifest(id: string, capabilities: string[]): PackManifest {
  return { id, name: id, version: "1.0.0", shape: "plugin", capabilities };
}

function candidate(
  id: string,
  capabilities: string[],
  screen?: ScreenPlugin["plugin"]["screen"],
): ScreenPlugin {
  return { id, manifest: manifest(id, capabilities), plugin: screen ? { screen } : {} };
}

const CONTEXT = () => ({}) as never;

const VIEW: ScreenView = freezeView({
  id: "core:inventory",
  title: "Inventory",
  footer: SCREEN_FOOTER,
  blocks: [
    {
      kind: "table",
      key: "pack",
      tagged: true,
      columns: [{ key: "name" }],
      rows: [{ tag: "a", cells: { name: { text: "a Ration of Food" } } }],
    },
  ],
});

/** A presenter that takes the screens whose ids are listed, and declines the rest. */
function takes(...ids: string[]): {
  presenter: ScreenPresenter;
  shown: ScreenView[];
  dismiss: () => void;
} {
  const shown: ScreenView[] = [];
  let resolve: () => void = () => {};
  return {
    shown,
    dismiss: () => resolve(),
    presenter: {
      show(view) {
        if (!ids.includes(view.id)) return undefined;
        shown.push(view);
        return { dismissed: new Promise<void>((r) => (resolve = r)) };
      },
    },
  };
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  setScreenPresenter(null);
  setUiFaultReporter(() => undefined);
});

/* ------------------------------------------------------------------ */

describe("selecting the screen presenter", () => {
  it("refuses a mod that declares screen() with no capability, and says how to fix it", () => {
    /* A mod whose interface silently does nothing is the worst outcome for
     * everyone including the player, so the mistake is named with its remedy. */
    const faults: string[] = [];
    const installed = installScreen(
      [candidate("quiet", [], () => takes("core:inventory").presenter)],
      CONTEXT,
      (id, message) => faults.push(`${id}: ${message}`),
    );
    expect(installed).toBeNull();
    expect(faults[0]).toContain(SCREEN_CAPABILITY);
    expect(faults[0]).toContain("add");
  });

  it("gives the screens to the LAST eligible mod in load order", () => {
    const winner = takes("core:inventory");
    const installed = installScreen(
      [
        candidate("first", [SCREEN_CAPABILITY], () => takes("core:inventory").presenter),
        candidate("second", [SCREEN_CAPABILITY], () => winner.presenter),
      ],
      CONTEXT,
      () => undefined,
    );
    expect(installed?.id).toBe("second");
  });

  it("reads every candidate's claim, not just the winner's", () => {
    /* A mod that forgot its capability hears about it even when a later mod would
     * have outranked it anyway: its mistake does not become invisible because
     * somebody else won. */
    const faults: string[] = [];
    installScreen(
      [
        candidate("forgot", [], () => takes("core:inventory").presenter),
        candidate("won", [SCREEN_CAPABILITY], () => takes("core:inventory").presenter),
      ],
      CONTEXT,
      (id) => faults.push(id),
    );
    expect(faults).toEqual(["forgot"]);
  });

  it("counts every claimant for the conflict report, winner or not", () => {
    expect(
      screenClaimants([
        candidate("a", [SCREEN_CAPABILITY], () => undefined),
        candidate("b", ["ui:*.replace"], () => undefined),
        candidate("no-hook", [SCREEN_CAPABILITY]),
        candidate("no-grant", [], () => undefined),
      ]),
    ).toEqual(["a", "b"]);
  });

  it("takes the wildcard as a grant over the screens", () => {
    const installed = installScreen(
      [candidate("all", ["ui:*.replace"], () => takes("core:inventory").presenter)],
      CONTEXT,
      () => undefined,
    );
    expect(installed?.id).toBe("all");
  });

  it("leaves the screens with the game when screen() declines, fails, or returns rubbish", () => {
    const faults: string[] = [];
    const report = (id: string, message: string): void => void faults.push(message);
    expect(installScreen([candidate("d", [SCREEN_CAPABILITY], () => undefined)], CONTEXT, report)).toBeNull();
    expect(faults).toEqual([]); // declining is not a fault

    expect(
      installScreen(
        [
          candidate("t", [SCREEN_CAPABILITY], () => {
            throw new Error("no dom");
          }),
        ],
        CONTEXT,
        report,
      ),
    ).toBeNull();
    expect(
      installScreen(
        [candidate("r", [SCREEN_CAPABILITY], () => ({}) as unknown as ScreenPresenter)],
        CONTEXT,
        report,
      ),
    ).toBeNull();
    expect(faults).toHaveLength(2);
  });
});

describe("showing a screen through the presenter", () => {
  it("hands over the view, and the terminal draws nothing", async () => {
    const owner = takes("core:inventory");
    setScreenPresenter({ id: "sprites", presenter: owner.presenter });
    const term = makeTerm();

    const done = showTextScreen(term, VIEW);
    await tick();
    expect(owner.shown).toEqual([VIEW]);
    expect(term.printed).toEqual([]);

    owner.dismiss();
    await expect(done).resolves.toBeUndefined();
  });

  it("DECLINES back to the game's own screen, and that is not a fault", async () => {
    const owner = takes("core:equipment"); // not the inventory
    const faults: string[] = [];
    setScreenPresenter({ id: "sprites", presenter: owner.presenter });
    setUiFaultReporter((id, message) => faults.push(message));
    const term = makeTerm();

    void showTextScreen(term, VIEW);
    await tick();
    expect(owner.shown).toEqual([]);
    expect(term.printed.some((t) => t.includes("a Ration of Food"))).toBe(true);
    expect(faults).toEqual([]);
  });

  it("offers a prose page too, under the shared unmodelled id", async () => {
    /* A mod reskinning the interface wants its frame around the prose as well;
     * what it does NOT get is anything to reimagine, which is what `core:text`
     * says out loud. */
    const owner = takes("core:text");
    setScreenPresenter({ id: "sprites", presenter: owner.presenter });

    const done = showTextScreen(makeTerm(), "Mods folder", [{ text: "one" }]);
    await tick();
    expect(owner.shown[0]?.title).toBe("Mods folder");
    owner.dismiss();
    await done;
  });
});

describe("a presenter that misbehaves loses the seam, and the player still sees the screen", () => {
  it("shows the screen itself when show() throws", async () => {
    const faults: string[] = [];
    setScreenPresenter({
      id: "broken",
      presenter: {
        show() {
          throw new Error("boom");
        },
      },
    });
    setUiFaultReporter((id, message) => faults.push(`${id}: ${message}`));
    const term = makeTerm();

    void showTextScreen(term, VIEW);
    await tick();
    expect(term.printed.some((t) => t.includes("a Ration of Food"))).toBe(true);
    expect(faults[0]).toContain("core:inventory");
  });

  it("shows the screen itself when the presenter dies with the screen OPEN", async () => {
    /* The failure this seam has and the menus do not. A menu that never answers
     * still has the game's own menu painted underneath; a screen that vanishes
     * leaves the player looking at nothing and pressing keys nobody is reading. */
    const faults: string[] = [];
    let fail: (e: Error) => void = () => {};
    setScreenPresenter({
      id: "fragile",
      presenter: { show: () => ({ dismissed: new Promise<void>((_r, j) => (fail = j)) }) },
    });
    setUiFaultReporter((id, message) => faults.push(message));
    const term = makeTerm();

    const done = showTextScreen(term, VIEW);
    await tick();
    expect(term.printed).toEqual([]); // the mod has it

    fail(new Error("canvas lost"));
    await tick();
    expect(term.printed.some((t) => t.includes("a Ration of Food"))).toBe(true);
    expect(faults[0]).toContain("resumed showing its own screens");
    expect(done).toBeInstanceOf(Promise); // still open on the terminal, not rejected
  });

  it("refuses a presenter that takes a screen without returning a dismissal", async () => {
    /* `show` returning `{}` reads as "taken" but resolves never, which would hang
     * the caller forever - the one shape that must not be treated as a decline
     * quietly. */
    const faults: string[] = [];
    setScreenPresenter({
      id: "sloppy",
      presenter: { show: () => ({}) as unknown as { dismissed: Promise<void> } },
    });
    setUiFaultReporter((id, message) => faults.push(message));
    const term = makeTerm();

    void showTextScreen(term, VIEW);
    await tick();
    expect(term.printed.some((t) => t.includes("a Ration of Food"))).toBe(true);
    expect(faults[0]).toContain("without returning a dismissal");
  });

  it("is out for the rest of the session after one fault, on every screen", async () => {
    /* One report, then out - the same rule the menus use, and for the same
     * reason: the failure mode is a presenter that throws on everything, and a
     * fault report every time the player opens anything is worse. */
    const faults: string[] = [];
    let calls = 0;
    setScreenPresenter({
      id: "broken",
      presenter: {
        show() {
          calls++;
          throw new Error("boom");
        },
      },
    });
    setUiFaultReporter((id, message) => faults.push(message));

    void showTextScreen(makeTerm(), VIEW);
    await tick();
    void showTextScreen(makeTerm(), VIEW);
    await tick();
    expect(calls).toBe(1);
    expect(faults).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Standing aside for the game's own prompt                            */
/* ------------------------------------------------------------------ */

/**
 * WHY THESE TESTS LOOK THE WAY THEY DO.
 *
 * The defect is that a prompt runs UNDER a presenter's overlay: the player is
 * asked a question they cannot see, and `charsheet:rename` writes the save at
 * the end of it. The mechanism is an announcement, so the only assertions worth
 * making are made through what the PRESENTER received, and against what the real
 * producer built - never against an object literal spelled out here, which would
 * be an assertion about this file.
 *
 * The negative control is the presenter with NO `yieldTerminal` AT ALL, not one
 * that does nothing when called. The likeliest wrong implementation treats a
 * missing member as consent - it runs the work and reports `held: true` - and
 * every test that supplied an inert-but-present member would still pass.
 */

const RENAME = { id: "charsheet:rename", action: "rename", label: "Enter your character's name" };
const SIZE = { cols: 80, rows: 24 };

/** The request the game would actually announce, from the one real producer. */
function renameRequest(): PromptRequest {
  return promptRequest(RENAME.id, RENAME.action, "screen", RENAME.label, SIZE);
}

interface Standing {
  presenter: ScreenPresenter;
  /** Everything that happened, in one list, so ORDER is asserted not inferred. */
  log: string[];
  received: (PromptRequest | null)[];
  dismiss: () => void;
}

/** A presenter whose screen CAN stand aside; `onYield` is what it does about it. */
function standsAside(
  onYield: (request: PromptRequest | null) => void | Promise<void> = () => undefined,
): Standing {
  const log: string[] = [];
  const received: (PromptRequest | null)[] = [];
  let resolve: () => void = () => {};
  const shown: YieldingScreen = {
    dismissed: new Promise<void>((r) => (resolve = r)),
    yieldTerminal(request) {
      received.push(request);
      log.push(request === null ? "release" : `aside:${request.id}`);
      return onYield(request);
    },
  };
  return { log, received, dismiss: () => resolve(), presenter: { show: () => shown } };
}

/**
 * THE NEGATIVE CONTROL: the mechanism REMOVED. A handle with no `yieldTerminal`
 * property at all - a presenter written before any of this existed, which is
 * every presenter that exists today.
 */
function cannotStandAside(): { presenter: ScreenPresenter; dismiss: () => void } {
  let resolve: () => void = () => {};
  const shown = { dismissed: new Promise<void>((r) => (resolve = r)) };
  return { dismiss: () => resolve(), presenter: { show: () => shown } };
}

/** Open one screen through the runtime, so the live holder knows about it. */
function open(presenter: ScreenPresenter, id = "sprites", view = VIEW): Promise<void> | null {
  setScreenPresenter({ id, presenter });
  return showThroughPresenter(view, () => undefined);
}

describe("the game announces a prompt, and the presenter stands aside", () => {
  it("announces BEFORE the work and releases AFTER it, in that order", async () => {
    const owner = standsAside();
    expect(open(owner.presenter)).not.toBeNull();

    const out = await withTerminal(renameRequest(), () => {
      owner.log.push("prompt");
      return "Bob";
    });

    expect(owner.log).toEqual(["aside:charsheet:rename", "prompt", "release"]);
    expect(out).toEqual({ held: true, value: "Bob" });
  });

  it("AWAITS what yieldTerminal returns before anything is drawn", async () => {
    /* A presenter animating itself out is legitimate, and the whole point of the
     * design is that the prompt does not land until it has finished. */
    let letGo: () => void = () => {};
    const owner = standsAside((request) =>
      request === null ? undefined : new Promise<void>((r) => (letGo = r)),
    );
    expect(open(owner.presenter)).not.toBeNull();

    const running = withTerminal(renameRequest(), () => void owner.log.push("prompt"));
    await tick();
    expect(owner.log).toEqual(["aside:charsheet:rename"]); // the fade is still running
    letGo();
    await running;
    expect(owner.log).toEqual(["aside:charsheet:rename", "prompt", "release"]);
  });

  it("hands the presenter what the REAL producer built, field for field", async () => {
    /* Asserted through the mod-facing sink against `promptRequest`'s own output.
     * A literal here would be an assertion about this test file, and a field
     * added to the producer and dropped at the boundary would sail past it. */
    const owner = standsAside();
    expect(open(owner.presenter)).not.toBeNull();

    await withTerminal(renameRequest(), () => undefined);

    const got = owner.received[0];
    expect(got).toEqual(renameRequest());
    /* KEY SETS too: `toEqual` treats `{a:1}` and `{a:1,b:undefined}` as equal,
     * and with `exactOptionalPropertyTypes` an absent optional is the normal
     * shape, so a new field can drift past a deep-equal unnoticed. */
    expect(Object.keys(got!).sort()).toEqual(Object.keys(renameRequest()).sort());
    expect(Object.keys(got!.clip).sort()).toEqual(Object.keys(renameRequest().clip).sort());
    /* And it arrives frozen, so the presenter cannot edit the announcement. */
    expect(Object.isFrozen(got)).toBe(true);
    expect(owner.received[1]).toBeNull(); // the release, and nothing else
    expect(owner.received).toHaveLength(2);
  });

  it("says the terminal is yielded WHILE the prompt runs, and not after", async () => {
    const owner = standsAside();
    expect(open(owner.presenter)).not.toBeNull();
    expect(terminalIsYielded()).toBe(false);

    let during = false;
    await withTerminal(renameRequest(), () => {
      during = terminalIsYielded();
    });

    expect(during).toBe(true);
    expect(terminalIsYielded()).toBe(false);
  });

  it("releases from a FINALLY when the prompt throws", async () => {
    /* One exception must not leave the player's overlay hidden for the rest of
     * the session. `getFile` reaches the file system; this is not hypothetical. */
    const owner = standsAside();
    expect(open(owner.presenter)).not.toBeNull();

    await expect(
      withTerminal(renameRequest(), () => {
        throw new Error("the file system said no");
      }),
    ).rejects.toThrow("the file system said no");

    expect(owner.log).toEqual(["aside:charsheet:rename", "release"]);
    expect(terminalIsYielded()).toBe(false);
  });

  it("costs unmodded play one branch: no presenter, no announcement, no fault", async () => {
    const faults: string[] = [];
    expect(await withTerminal(renameRequest(), () => 7, (id) => void faults.push(id))).toEqual({
      held: true,
      value: 7,
    });
    expect(faults).toEqual([]);
    expect(terminalIsYielded()).toBe(false);
  });
});

describe("a presenter that cannot stand aside hands the screen back", () => {
  it("NEGATIVE CONTROL: a presenter with no yieldTerminal surrenders, and is told what to add", async () => {
    /* The control is built by REMOVING the mechanism. The likeliest shortcut -
     * treating a missing member as consent - passes every test that supplies an
     * inert member and fails this one, which is why this one exists. */
    const faults: { id: string; message: string }[] = [];
    const owner = cannotStandAside();
    expect(open(owner.presenter, "old-mod")).not.toBeNull();

    const out = await withTerminal(
      renameRequest(),
      () => "Bob",
      (id, message) => void faults.push({ id, message }),
    );

    expect(out).toEqual({ held: false, value: "Bob" }); // the work STILL runs
    expect(faults).toHaveLength(1);
    expect(faults[0]!.id).toBe("old-mod");
    expect(faults[0]!.message).toContain("yieldTerminal");
    expect(faults[0]!.message).toContain("add");
    expect(faults[0]!.message).toContain(RENAME.label);
  });

  it("reports it ONCE, however many prompts the action opens", async () => {
    /* `report:describe` opens up to three prompts in a row; a fault per line is
     * worse than one report and out, which is the rule the seam already uses. */
    const faults: string[] = [];
    const owner = cannotStandAside();
    expect(open(owner.presenter, "old-mod")).not.toBeNull();
    const report = (id: string): void => void faults.push(id);

    for (let i = 0; i < 3; i++) {
      expect((await withTerminal(renameRequest(), () => i, report)).held).toBe(false);
    }
    expect(faults).toEqual(["old-mod"]);
  });

  it("surrenders when yieldTerminal THROWS, and when it REJECTS", async () => {
    for (const failing of [
      (): void => {
        throw new Error("no canvas");
      },
      (): Promise<void> => Promise.reject(new Error("no canvas")),
    ]) {
      const faults: unknown[] = [];
      const owner = standsAside(failing);
      expect(open(owner.presenter, "fragile")).not.toBeNull();

      const out = await withTerminal(
        renameRequest(),
        () => "Bob",
        (_id, _message, error) => void faults.push(error),
      );

      expect(out).toEqual({ held: false, value: "Bob" });
      expect((faults[0] as Error).message).toBe("no canvas");
      /* Surrendered, not merely un-yielded: the game is drawing over that screen
       * and nothing has told the presenter otherwise. */
      expect(terminalIsYielded()).toBe(true);
      setScreenPresenter(null);
    }
  });

  it("refuses a yieldTerminal that is present and is not callable", () => {
    /* The same `typeof … === "function"` treatment `dismissed?.then` gets: a
     * lying member reads as "can stand aside" and takes the seam down mid-prompt. */
    const faults: string[] = [];
    setScreenPresenter({
      id: "sloppy",
      presenter: {
        show: () =>
          ({
            dismissed: new Promise<void>(() => undefined),
            yieldTerminal: true,
          }) as unknown as YieldingScreen,
      },
    });
    expect(showThroughPresenter(VIEW, (_id, message) => void faults.push(message))).toBeNull();
    expect(faults[0]).toContain("yieldTerminal");
  });
});

describe("a presenter standing aside is not offered the screen the prompt is drawing", () => {
  it("returns null to the yielded owner, and STILL serves a different presenter", async () => {
    /* Site 4: `core:update`'s `mods` action opens `showModUpgrades`, whose own
     * screens come back through `showThroughPresenter` while the SAME presenter
     * is still holding `core:update`. Re-offering asks it to draw over the very
     * terminal it just cleared. */
    const owner = standsAside();
    expect(open(owner.presenter, "sprites")).not.toBeNull();
    const nested = freezeView({
      id: "core:mod-updates",
      title: "Mod updates",
      footer: SCREEN_FOOTER,
      blocks: [{ kind: "lines", lines: [{ text: "one waiting" }] }],
    });
    const other = standsAside();
    let reoffered: Promise<void> | null | undefined;
    let toOther: Promise<void> | null | undefined;

    await withTerminal(renameRequest(), () => {
      reoffered = showThroughPresenter(nested, () => undefined);
      /* A DIFFERENT presenter has done nothing wrong and is served normally -
       * refusing everybody would take the seam away from a bystander. */
      setScreenPresenter({ id: "other", presenter: other.presenter });
      toOther = showThroughPresenter(nested, () => undefined);
    });

    expect(reoffered).toBeNull();
    expect(toOther).not.toBeNull();
    expect(other.received).toEqual([]); // it was shown the screen, not a prompt
  });

  it("offers the owner screens again once it has been released", async () => {
    const owner = standsAside();
    expect(open(owner.presenter, "sprites")).not.toBeNull();
    await withTerminal(renameRequest(), () => undefined);
    expect(showThroughPresenter(VIEW, () => undefined)).not.toBeNull();
  });
});

describe("taking the screen back", () => {
  it("reports a release that fails, and still gives the caller the prompt's answer", async () => {
    /* The work is done and its result is what the player is owed; the screen is
     * the presenter's problem now, and it has been told. */
    const faults: string[] = [];
    const owner = standsAside((request) => {
      if (request === null) throw new Error("gone");
    });
    expect(open(owner.presenter, "fragile")).not.toBeNull();

    const out = await withTerminal(
      renameRequest(),
      () => "Bob",
      (_id, message) => void faults.push(message),
    );

    expect(out).toEqual({ held: true, value: "Bob" });
    expect(faults[0]).toContain("yieldTerminal(null)");
    expect(terminalIsYielded()).toBe(false);
  });

  it("forgets a screen once it is dismissed, so the next prompt has nobody to tell", async () => {
    const owner = standsAside();
    const done = open(owner.presenter);
    owner.dismiss();
    await done;
    expect(await withTerminal(renameRequest(), () => 1)).toEqual({ held: true, value: 1 });
    expect(owner.received).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* TRIPWIRES: the halves of #258 that are NOT wired yet                 */
/* ------------------------------------------------------------------ */

/**
 * A MECHANISM WITH NO CALLER IS A MECHANISM THAT DOES NOTHING, and the tests
 * above cannot tell the difference - every one of them calls `withTerminal`
 * itself. `SCREEN_PROMPTS` names FOUR prompting actions across THREE hosts, and
 * this file is where "who actually calls this" has to be answered, because it is
 * the module the answer is about.
 *
 * These are TRIPWIRES, not skips: each records the state of an unfinished wire
 * and goes RED the moment that wire lands, so the person who lands it is the one
 * who deletes the tripwire. A skip would be silent in exactly the situation the
 * whole design exists to make loud.
 *
 * Read from source text on purpose. The alternative is booting `main.ts` in a
 * unit test to see whether a call happens, which is a canvas, a game and a
 * network away from the question being asked.
 */
describe("#258 tripwires: the wiring that has not landed", () => {
  const web = (name: string): string =>
    readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

  /**
   * Every module that hosts a `SCREEN_PROMPTS` action, and whether it announces.
   *
   * `charsheet.ts` hosts `core:character` / `core:character-flags` (`rename`,
   * `file`) and is wired. `main.ts` hosts `core:report` (`describe`, through
   * `showReportPage`'s `act` -> `getString`) and `core:update` (`mods`, through
   * `showUpdatePage`'s `act` -> `showModUpgrades`) and is NOT - both of those
   * prompts still land under a presenter's overlay today.
   *
   * PER FILE rather than per action because that is the granularity the evidence
   * has: a `withTerminal` call in `main.ts` proves one of its two sites is wired
   * and says nothing about the other. When main.ts is touched, BOTH must land,
   * and the row is deleted rather than flipped.
   */
  const PROMPT_HOSTS: ReadonlyArray<{ file: string; wired: boolean; sites: string[] }> = [
    { file: "charsheet.ts", wired: true, sites: ["charsheet:rename", "charsheet:file"] },
    { file: "main.ts", wired: false, sites: ["report:describe", "update:mods"] },
  ];

  for (const host of PROMPT_HOSTS) {
    it(`${host.file} ${host.wired ? "announces" : "does NOT yet announce"} its prompts (${host.sites.join(", ")})`, () => {
      expect(/\bwithTerminal\s*\(/u.test(web(host.file))).toBe(host.wired);
    });
  }

  /**
   * THE ABI MEMBER IS NOT PUBLISHED. `YieldingScreen` is declared privately in
   * `screen-runtime.ts` and says so; the two copies that a mod author can
   * actually reach - `ScreenShown` in `screen-view.ts` and its twin in
   * `packages/mod-sdk/src/screen.ts` - still have only `dismissed`.
   *
   * WHAT THIS DOES AND DOES NOT COST, measured rather than assumed. It is NOT
   * that a TypeScript mod cannot implement the member - `tsc` accepts
   * `show: () => ({ dismissed, yieldTerminal })` against a `ScreenShown |
   * undefined` return type with no cast and no excess-property error (probed,
   * with a deliberate type error in the same file to prove it was compiled).
   * What it costs is everything a published member buys: an author reading the
   * SDK has no way to LEARN the member exists, and nothing checks the signature
   * of the one they write - a `yieldTerminal(request: string)` compiles today
   * and is handed a `PromptRequest` at runtime.
   *
   * When both copies gain the member this test goes RED. Deleting it is the
   * signal to also delete `YieldingScreen` from `screen-runtime.ts` and use
   * `ScreenShown` there, which is what that interface's own comment asks for.
   */
  it("has not published yieldTerminal on ScreenShown, in either copy", () => {
    const live = web("screen-view.ts");
    const sdk = readFileSync(
      new URL("../../mod-sdk/src/screen.ts", import.meta.url),
      "utf8",
    );
    /* Both, not either: a member on one copy and not the other is a mod compiled
     * against a different game, which is worse than neither having it. */
    expect(live.includes("yieldTerminal")).toBe(false);
    expect(sdk.includes("yieldTerminal")).toBe(false);
    /* And the private declaration is still where it says it is, so this cannot
     * pass by the interface having quietly moved somewhere else. */
    expect(web("screen-runtime.ts")).toContain("interface YieldingScreen");
  });
});
