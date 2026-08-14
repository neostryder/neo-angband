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

import { afterEach, describe, expect, it } from "vitest";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  SCREEN_CAPABILITY,
  installScreen,
  screenClaimants,
  setScreenPresenter,
} from "./screen-runtime";
import type { ScreenPlugin } from "./screen-runtime";
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
