/**
 * The teardown pass, and - the half that matters - the fact that boot runs it.
 *
 * `ModPlugin.uninstall` was declared, documented, validated by validateModPlugin,
 * and called by nothing, for as long as the ABI existed. A test of this module
 * alone would reproduce exactly that failure at one remove: a correct function
 * with no caller, now with a green tick next to it. So the second half of this
 * file asserts the CALL, on main.ts's source with comments stripped - main.ts
 * boots a game on import and cannot be imported here, and a citation in a comment
 * must not be able to satisfy a claim about code. Same shape, and the same reason,
 * as mod-bags.test.ts.
 *
 * The claim being pinned is not merely "uninstall is called". It is the ORDER:
 * teardown runs before `autosave(true)`, inside the one funnel every mod change
 * reaches (requestReload). Teardown after the save, or teardown with the save
 * skipped, would pass a bare "is it called" test and would give a mod author
 * nothing - the point of the seam is that what a plugin undoes in `uninstall`
 * does not end up in the character's save.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modFaults, resetModFaults } from "./mod-problems";
import {
  resetModTeardown,
  teardownModPlugins,
  type ModTeardownTarget,
} from "./mod-teardown";

/** A plugin whose uninstall records into `order`, or throws. */
function target(
  id: string,
  order: string[],
  opts: { throws?: boolean; absent?: boolean } = {},
): ModTeardownTarget {
  if (opts.absent) return { id, plugin: {} };
  return {
    id,
    plugin: {
      uninstall(): void {
        order.push(id);
        if (opts.throws) throw new Error(`${id} blew up`);
      },
    },
  };
}

function controller(id: string, order: string[], opts: { throws?: boolean } = {}) {
  return {
    id,
    session: {
      uninstall: (): void => {
        order.push(`controller:${id}`);
        if (opts.throws) throw new Error("could not release");
      },
    },
  };
}

describe("teardownModPlugins", () => {
  beforeEach(() => {
    resetModTeardown();
    resetModFaults();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("calls every plugin's uninstall, in load order", () => {
    const order: string[] = [];
    const out = teardownModPlugins({
      plugins: [target("a", order), target("b", order), target("c", order)],
      controller: null,
    });
    expect(order).toEqual(["a", "b", "c"]);
    expect(out.torndown).toEqual(["a", "b", "c"]);
    expect(out.failed).toEqual([]);
    expect(out.released).toBeNull();
  });

  it("skips a plugin that declares no uninstall", () => {
    /* The member is optional and most mods will never want it; a host that
     * called through on undefined would turn "I have no teardown" into a crash
     * on the way to a reload. */
    const order: string[] = [];
    const out = teardownModPlugins({
      plugins: [target("a", order), target("quiet", order, { absent: true }), target("b", order)],
      controller: null,
    });
    expect(order).toEqual(["a", "b"]);
    expect(out.torndown).toEqual(["a", "b"]);
  });

  it("releases the autoplayer slot AFTER the plugins, not before", () => {
    /* An autoplayer's own uninstall may want to read the game or issue a last
     * command. Releasing state.nextCommand first is a teardown that breaks the
     * thing it is tearing down. */
    const order: string[] = [];
    const out = teardownModPlugins({
      plugins: [target("borg", order), target("qol", order)],
      controller: controller("borg", order),
    });
    expect(order).toEqual(["borg", "qol", "controller:borg"]);
    expect(out.released).toBe("borg");
  });

  it("one plugin's throwing uninstall loses that plugin's teardown and nothing else", () => {
    const order: string[] = [];
    const out = teardownModPlugins({
      plugins: [target("a", order), target("bad", order, { throws: true }), target("c", order)],
      controller: controller("bad", order),
    });
    /* The later plugins still ran, and so did the controller release: a third
     * party's bad teardown must not be the reason the reload is half-done. */
    expect(order).toEqual(["a", "bad", "c", "controller:bad"]);
    expect(out.torndown).toEqual(["a", "c"]);
    expect(out.failed).toEqual(["bad"]);
    expect(out.released).toBe("bad");
  });

  it("puts a failed teardown on that mod's row, not only in the console", () => {
    /* console.error is not a channel a player has - the same rule the register()
     * and hooks() loops follow. */
    const order: string[] = [];
    teardownModPlugins({ plugins: [target("bad", order, { throws: true })], controller: null });
    const fault = modFaults().find((f) => f.id === "bad");
    expect(fault?.why).toMatch(/uninstall\(\) failed/u);
    expect(fault?.why).toContain("bad blew up");
  });

  it("a controller that will not release is reported and does not throw out", () => {
    const order: string[] = [];
    const out = teardownModPlugins({
      plugins: [],
      controller: controller("borg", order, { throws: true }),
    });
    expect(out.released).toBeNull();
    expect(modFaults().find((f) => f.id === "borg")?.why).toMatch(/autoplayer could not be released/u);
  });

  it("never throws, whatever the plugins do", () => {
    /* The reload must happen. A teardown that can abort requestReload leaves the
     * player having pressed Apply and seen nothing change. */
    const order: string[] = [];
    expect(() =>
      teardownModPlugins({
        plugins: [target("x", order, { throws: true })],
        controller: controller("x", order, { throws: true }),
      }),
    ).not.toThrow();
  });

  it("runs once per page: a second call does nothing", () => {
    /* session.uninstall restores the provider captured when it was installed, so
     * a second pass around anything that installed in between would restore a
     * stale one. */
    const order: string[] = [];
    const first = teardownModPlugins({
      plugins: [target("a", order)],
      controller: controller("a", order),
    });
    const second = teardownModPlugins({
      plugins: [target("a", order)],
      controller: controller("a", order),
    });
    expect(first.ran).toBe(true);
    expect(second.ran).toBe(false);
    expect(order).toEqual(["a", "controller:a"]);
  });
});

/* --- the wiring, which is the whole point ---------------------------------- */

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const NO_COMMENTS = MAIN.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");

/** requestReload's body: from the property to the `location.reload()` that ends it. */
function requestReloadBody(): string {
  const at = NO_COMMENTS.indexOf("requestReload:");
  expect(at, "main.ts still supplies requestReload to the mod manager").toBeGreaterThan(-1);
  const end = NO_COMMENTS.indexOf("location.reload()", at);
  expect(end, "requestReload still ends by reloading the page").toBeGreaterThan(at);
  return NO_COMMENTS.slice(at, end);
}

describe("the mod-apply funnel actually runs the teardown", () => {
  it("calls teardownModPlugins inside requestReload", () => {
    expect(requestReloadBody()).toMatch(/teardownModPlugins\(/u);
  });

  it("runs it BEFORE the save, which is the entire claim", () => {
    /* Teardown after autosave(true) would write the character with whatever the
     * mods left in state - an autoplayer still holding nextCommand included - and
     * would still satisfy a test that only asked whether uninstall was called. */
    const body = requestReloadBody();
    const teardown = body.indexOf("teardownModPlugins(");
    const save = body.indexOf("autosave(true)");
    expect(teardown).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(teardown);
  });

  it("hands it the loaded plugins and the held autoplayer slot", () => {
    /* Passing an empty list, or omitting the controller, would leave this green
     * and tear nothing down. */
    const body = requestReloadBody();
    expect(body).toMatch(/plugins:\s*activeModCode\(\)\.plugins/u);
    expect(body).toMatch(/controller:\s*installedController/u);
  });

  it("releases the host's own record of the slot", () => {
    expect(requestReloadBody()).toMatch(/installedController\s*=\s*null/u);
  });

  it("is the only mod-driven reload, so this funnel is not one of several", () => {
    /* If a second path started reloading on a mod change, teardown would be wired
     * into one of two doors and the other would silently skip it. */
    const reloads = NO_COMMENTS.match(/location\.reload\(\)/gu) ?? [];
    expect(reloads.length).toBe(2); // requestReload, and the load-failure retry prompt
  });
});
