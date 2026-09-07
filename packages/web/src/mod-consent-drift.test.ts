/**
 * A mod that starts asking for more than it was granted (#190).
 *
 * THE DEFECT WAS SILENCE, so these tests are about what the player is shown.
 *
 * Consent is written once, when a mod is enabled, and the enable path returns
 * early on a mod that is already enabled. Nothing revisits the grant. So a mod
 * that adds a capability in a later version and is then updated in place carries
 * a grant that no longer covers its own manifest, and the loader drops its code
 * onto `skipped` - which exists precisely to mean "not a fault", so no manager
 * reports one.
 *
 * Everything the player can see kept saying the mod was fine. The row stayed
 * enabled, and every rule the mod declares still rendered and still took clicks,
 * because the options rows are built from manifests rather than from loaded code.
 * The measured case was a mod whose capability list grew at four consecutive
 * releases; an install that consented before the last two lost thirteen rules at
 * once, all at the same moment, with nothing anywhere saying why.
 *
 * The one sentence the screen did offer was actively wrong: an enabled mod short
 * a capability was told "you will be asked when you turn it on". It is on, and
 * nothing was going to ask.
 */

import { describe, expect, it } from "vitest";
import { rowDetail, rowLabel } from "./mods";
import { buildCatalog, capabilitiesNotYetGranted, consentSatisfied } from "./mod-store";
import type { CatalogMod } from "./mod-store";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";

/** The real shape of the case: a plugin whose capability list grew over releases. */
const QOL_AT_V1_4 = ["ui:sidebar.replace", "display:filter", "ui:panel.mount", "keymap:write"];
const QOL_AT_V1_5 = [...QOL_AT_V1_4, "backup:folder", "registry:menu"];

function manifest(over: Partial<PackManifest> = {}): PackManifest {
  return {
    id: "qol",
    name: "Quality of Life",
    version: "1.5.0",
    shape: "plugin",
    capabilities: QOL_AT_V1_5,
    ...over,
  } as PackManifest;
}

describe("the difference between what a mod asks and what it was granted", () => {
  it("is the capabilities added since the grant, in the manifest's own order", () => {
    /* The manifest's order, not the grant's, because the manifest is the author's
     * reading order and the grant is an implementation detail of when the player
     * happened to say yes. */
    expect(capabilitiesNotYetGranted(QOL_AT_V1_5, QOL_AT_V1_4)).toEqual([
      "backup:folder",
      "registry:menu",
    ]);
  });

  it("is empty when the grant already covers the manifest", () => {
    expect(capabilitiesNotYetGranted(QOL_AT_V1_5, QOL_AT_V1_5)).toEqual([]);
    expect(capabilitiesNotYetGranted([], [])).toEqual([]);
  });

  it("ignores a grant that is wider than the manifest", () => {
    /* A mod that DROPS a capability leaves a stale extra in the grant. That is
     * not a shortfall and must not read as one. */
    expect(capabilitiesNotYetGranted(["display:filter"], QOL_AT_V1_5)).toEqual([]);
    expect(consentSatisfied(["display:filter"], QOL_AT_V1_5)).toBe(true);
  });

  it("agrees with consentSatisfied, which is now derived from it", () => {
    const cases: [readonly string[], readonly string[]][] = [
      [QOL_AT_V1_5, QOL_AT_V1_4],
      [QOL_AT_V1_5, QOL_AT_V1_5],
      [QOL_AT_V1_5, []],
      [[], QOL_AT_V1_4],
    ];
    for (const [want, have] of cases) {
      expect(consentSatisfied(want, have)).toBe(capabilitiesNotYetGranted(want, have).length === 0);
    }
  });
});

describe("the catalogue row carries the stored grant, not just a yes or no", () => {
  const catalogue = (consents: Record<string, readonly string[]>): CatalogMod[] =>
    buildCatalog({
      content: [],
      sandbox: [],
      trusted: [manifest()],
      enabled: ["qol"],
      consents,
    });

  it("reports what was actually granted, so a screen can name the difference", () => {
    /* Without this the row knows only that something is missing, and a screen can
     * say "some permission" - which is not a thing a player can act on. */
    const [m] = catalogue({ qol: QOL_AT_V1_4 });
    expect(m?.granted).toEqual(QOL_AT_V1_4);
    expect(m?.capabilities).toEqual(QOL_AT_V1_5);
    expect(m?.consented).toBe(false);
    expect(m?.enabled).toBe(true);
  });

  it("is empty rather than absent for a mod with no grant at all", () => {
    const [m] = catalogue({});
    expect(m?.granted).toEqual([]);
    expect(m?.consented).toBe(false);
  });

  it("says consented once the grant covers the manifest", () => {
    const [m] = catalogue({ qol: QOL_AT_V1_5 });
    expect(m?.consented).toBe(true);
    expect(capabilitiesNotYetGranted(m?.capabilities ?? [], m?.granted ?? [])).toEqual([]);
  });
});

describe("what the manager shows for a mod that is on and not running", () => {
  const row = (over: Partial<CatalogMod> = {}): CatalogMod => ({
    id: "qol",
    name: "Quality of Life",
    version: "1.5.0",
    shape: "plugin",
    kind: "trusted",
    manifest: manifest(),
    enabled: true,
    capabilities: QOL_AT_V1_5,
    granted: QOL_AT_V1_4,
    nondeterministic: false,
    affectsGameplay: false,
    consented: false,
    ...over,
  });

  /* Joined and collapsed, because the pane wraps and these assertions are about
   * what the screen says rather than where it happens to break a line. The
   * wrapping itself is already covered by mod-detail.test.ts. */
  const text = (m: CatalogMod): string =>
    rowDetail(m, 60, 99)
      .map((l) => l.text)
      .join(" ")
      .replace(/\s+/gu, " ");

  it("does not say it will ask when the mod is turned on, because it is on", () => {
    /* The sentence that was there. It is true of a mod the player has not enabled
     * and false of exactly the mod this issue is about, which is the one reading
     * it. */
    expect(text(row())).not.toMatch(/when you turn it on/u);
  });

  it("says plainly that the code is not running", () => {
    expect(text(row())).toMatch(/NOT running/u);
  });

  it("names the capabilities that are new, and not the ones already allowed", () => {
    /* The player decided about the first four. Reprinting them buries the two
     * that changed, which is the only part they have a decision to make about. */
    const shown = text(row());
    expect(shown).toMatch(/folder/iu);
    expect(shown).toMatch(/menu/iu);
  });

  it("still says the plain thing for a mod that is simply not enabled yet", () => {
    const shown = text(row({ enabled: false }));
    expect(shown).toMatch(/when you turn it on/u);
    expect(shown).not.toMatch(/NOT running/u);
  });

  it("says it is allowed once the grant catches up", () => {
    const shown = text(row({ granted: QOL_AT_V1_5, consented: true }));
    expect(shown).toMatch(/You have allowed this/u);
    expect(shown).not.toMatch(/NOT running/u);
  });

  it("keeps flagging the row itself, so the detail is not the only tell", () => {
    /* rowLabel already carried this and must keep carrying it: the detail pane is
     * behind a keypress, and a player scanning the list has to see something. */
    expect(rowLabel(row()).label).toMatch(/NEEDS OK/u);
    expect(rowLabel(row({ granted: QOL_AT_V1_5, consented: true })).label).not.toMatch(/NEEDS OK/u);
  });
});
