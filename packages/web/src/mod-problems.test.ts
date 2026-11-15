import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { autoplayerTrouble } from "./mod-problems";

describe("Ctrl-Z names an autoplayer that did not start (#482)", () => {
  const borg = { id: "test-controller", name: "Test Controller", capabilities: ["input:controller", "input:intent"] };
  const content = { id: "qol", name: "Quality of Life", capabilities: ["registry:menu"] };

  it("reports a failed load for an enabled controller mod with a problem", () => {
    const problems = [{ id: "test-controller", why: "its Worker failed to start: api must be a range string" }];
    expect(autoplayerTrouble([content, borg], problems, [])).toEqual({ name: "Test Controller", kind: "failed" });
  });

  it("reports a held-back controller mod as not running", () => {
    const skipped = [{ id: "test-controller", why: "awaiting consent for input:controller" }];
    expect(autoplayerTrouble([borg], [], skipped)).toEqual({ name: "Test Controller", kind: "not-running" });
  });

  it("prefers a failure over a held-back mod", () => {
    const other = { ...borg, id: "other", name: "Other" };
    const result = autoplayerTrouble(
      [other, borg],
      [{ id: "test-controller", why: "broken" }],
      [{ id: "other", why: "awaiting consent" }],
    );
    expect(result).toEqual({ name: "Test Controller", kind: "failed" });
  });

  it("does not call a deprecation notice on a mod that loaded a failed load", () => {
    const notice = [{ id: "test-controller", why: "uses an API version that is deprecated" }];
    expect(autoplayerTrouble([borg], notice, [], ["test-controller"])).toBeNull();
  });

  it("names a mod with a notice and a consent hold as not running, not failed", () => {
    const notice = [{ id: "test-controller", why: "uses an API version that is deprecated" }];
    const skipped = [{ id: "test-controller", why: "awaiting consent for input:controller" }];
    expect(autoplayerTrouble([borg], notice, skipped)).toEqual({ name: "Test Controller", kind: "not-running" });
  });

  it("says nothing when no enabled mod declares a controller, or the controller mod has no trouble", () => {
    expect(autoplayerTrouble([content], [{ id: "qol", why: "broken" }], [])).toBeNull();
    expect(autoplayerTrouble([borg], [{ id: null, why: "the mods folder could not be read" }], [])).toBeNull();
  });

  it("falls back to the id for a manifest with no name", () => {
    expect(autoplayerTrouble([{ id: "nameless", capabilities: ["input:controller"] }], [{ id: "nameless", why: "x" }], []))
      .toEqual({ name: "nameless", kind: "failed" });
  });

  it("is what the Ctrl-Z command consults before saying no autoplayer is installed", () => {
    const main = readFileSync(join(import.meta.dirname, "main.ts"), "utf8");
    const body = main.slice(main.indexOf("function tryBorgCommand"), main.indexOf("function tryBorgCommand") + 2000);
    expect(body).toContain("autoplayerTrouble(");
    expect(body).toContain('"main.borg.autoplayer-failed"');
    expect(body.indexOf("autoplayerTrouble(")).toBeLessThan(body.indexOf('"main.borg.no-autoplayer"'));
  });
});
