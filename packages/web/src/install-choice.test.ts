/**
 * The choice ahead of "(I)nstall locally": desktop app, or install this page as
 * a PWA. See install-choice.ts's file header for where each claim comes from.
 */

import { describe, expect, it } from "vitest";
import { installChoiceLines, type ChoiceContext } from "./install-choice";

function ctx(over: Partial<ChoiceContext> = {}): ChoiceContext {
  return { canPromptInstall: true, ...over };
}

const text = (c: ChoiceContext): string =>
  installChoiceLines(c)
    .map((l) => l.text)
    .join("\n");

describe("what it offers", () => {
  it("names both rows the footer will bind D and W to", () => {
    const t = text(ctx());
    expect(t).toContain("(D) The desktop app");
    expect(t).toContain("(W) Install this page as an app");
  });

  it("gives the desktop platform list, its update story and the mods folder", () => {
    const t = text(ctx());
    expect(t).toMatch(/Windows, macOS/u);
    expect(t).toContain("Linux");
    expect(t).toMatch(/stable, beta or early/u);
    expect(t).toMatch(/Vortex|Mod Organizer/u);
  });

  it("says the desktop build is not code-signed yet", () => {
    /* True today per .github/workflows/release.yml's own release-notes step;
     * a false "no OS warning" would send someone to a scary dialog with no
     * warning it was coming. */
    const t = text(ctx());
    expect(t).toMatch(/not code-signed/iu);
    expect(t).toMatch(/SmartScreen|Gatekeeper/u);
  });

  it("says the PWA path needs no separate download and works offline", () => {
    const t = text(ctx());
    expect(t).toMatch(/no separate download/u);
    expect(t).toMatch(/works offline/u);
  });

  it("says the PWA path has no channel - it runs whatever the site deployed", () => {
    /* The desktop half gets a channel row; the web build never does (main.ts
     * gates the (U)pdate screen's channel key on `how !== "web"`). A page that
     * implied otherwise would promise a control that does not exist. */
    const t = text(ctx());
    expect(t).toMatch(/no channel to pick/u);
  });

  it("never claims a save-safety difference between the two paths", () => {
    /* Both platforms keep the roster in the same kind of local storage - see
     * install-local.ts's header - so this page must not imply either is safer. */
    const t = text(ctx()) + text(ctx({ canPromptInstall: false }));
    expect(t).not.toMatch(/saves?[^.\n]*(real file|on disk|back ?up|safer)/iu);
  });
});

describe("the one line that depends on the browser", () => {
  it("says the browser can install in one press when it can", () => {
    expect(text(ctx({ canPromptInstall: true }))).toMatch(/install it in one press/u);
  });

  it("points at the browser's own menu when there is no prompt to show", () => {
    /* Firefox and desktop Safari never fire beforeinstallprompt, and iOS Safari
     * installs from the Share sheet - so a button that does nothing would be
     * worse than telling them where to look instead. */
    const t = text(ctx({ canPromptInstall: false }));
    expect(t).not.toMatch(/install it in one press/u);
    expect(t).toMatch(/Add to Home Screen|Install/u);
  });
});

describe("every line is renderable", () => {
  it("uses only tones the shell has a colour for", () => {
    const tones = new Set(installChoiceLines(ctx()).map((l) => l.tone));
    for (const t of tones) expect(["head", "body", "dim"]).toContain(t);
  });

  it("fits an 80-column terminal", () => {
    for (const c of [ctx({ canPromptInstall: true }), ctx({ canPromptInstall: false })]) {
      for (const line of installChoiceLines(c)) {
        expect(line.text.length, line.text).toBeLessThanOrEqual(78);
      }
    }
  });
});
