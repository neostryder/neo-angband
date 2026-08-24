/**
 * The main module cannot be imported into a unit test: it owns the live canvas,
 * browser host, and the full game boot. This test therefore evaluates the exact
 * small boot boundary from main.ts with a real composition failure fixture in
 * place of its `loadGamePack` binding. That keeps the test on the production
 * try/catch rather than duplicating the recovery in a test helper.
 */

import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
/* Use source here: the focused web test is intentionally runnable before the
 * workspace package has emitted its dist/ entrypoint. */
import { composePacks } from "../../mod-sdk/src/compose";

import { resetSafeModeScreen, showSafeModeScreen } from "./safe-mode";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

interface FakeElement {
  tagName: string;
  id: string;
  type?: string;
  textContent: string;
  style: { cssText: string };
  children: FakeElement[];
  setAttribute(name: string, value: string): void;
  addEventListener(name: string, listener: () => void): void;
  append(...children: FakeElement[]): void;
  remove(): void;
  click(): void;
}

function element(tagName: string): FakeElement {
  const listeners = new Map<string, () => void>();
  const node: FakeElement = {
    tagName,
    id: "",
    textContent: "",
    style: { cssText: "" },
    children: [],
    setAttribute: () => {},
    addEventListener: (name, listener) => void listeners.set(name, listener),
    append: (...children) => void node.children.push(...children),
    remove: () => {},
    click: () => listeners.get("click")?.(),
  };
  return node;
}

function installFakeDom(): FakeElement {
  const body = element("body");
  (globalThis as { document?: unknown }).document = {
    createElement: element,
    getElementById: () => null,
    body,
    documentElement: body,
  };
  return body;
}

function allText(node: FakeElement): string {
  return [node.textContent, ...node.children.map(allText)].join(" ");
}

function findButton(node: FakeElement): FakeElement | undefined {
  if (node.tagName === "button") return node;
  for (const child of node.children) {
    const found = findButton(child);
    if (found) return found;
  }
  return undefined;
}

afterEach(() => {
  resetSafeModeScreen();
  delete (globalThis as { document?: unknown }).document;
});

/**
 * An enabled content mod contributes two records with the same key. The SDK's
 * strict composer throws rather than choosing an arbitrary owner. The web host
 * normally contains such faults with composeDroppingBroken; this fixture models
 * the unforeseen composition throw that reaches loadGamePack's final boundary.
 */
function loadGamePackFromBrokenCombination(): unknown {
  return composePacks([
    {
      manifest: { id: "core", name: "core", version: "1.0.0", shape: "content" },
      files: { monster: { records: [{ name: "Kobold", hp: 8 }] } },
    },
    {
      manifest: {
        id: "caves-combined",
        name: "caves-combined",
        version: "1.0.0",
        shape: "content",
        dependencies: { core: "*" },
      },
      files: {
        monster: {
          records: [
            { name: "Shared Wyrm", hp: 100 },
            { name: "Shared Wyrm", hp: 100 },
          ],
        },
      },
    },
  ]);
}

describe("main composition safe mode (#88)", () => {
  it("reaches safe mode for a throwing mod combination instead of rejecting boot", async () => {
    expect(loadGamePackFromBrokenCombination).toThrow(/duplicate record/u);

    const source = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.Latest, true);
    const boundary = source.statements.find(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === "loadPackForBoot",
    );
    expect(boundary, "main.ts no longer owns the composition recovery boundary").toBeDefined();

    /* Keep the exact production function body. Only its three outside bindings
     * are replaced: a throwing fixture loader, a capture of the screen call,
     * and a harmless restart callback. If main.ts loses the catch or stops
     * routing it to the screen, this evaluation rejects or records no call. */
    const harness = [
      'const fixtureError = new Error("fixture composition failed: duplicate record");',
      "const loadGamePack = () => { throw fixtureError; };",
      "const safeModeCalls = [];",
      "const showSafeModeScreen = (error, options) => void safeModeCalls.push({ error, options });",
      "const disableAllModsAndRestart = () => undefined;",
      boundary!.getText(source),
      "export { loadPackForBoot, safeModeCalls };",
    ].join("\n");
    const emitted = ts.transpileModule(harness, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    }).outputText;
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(emitted).toString("base64")}`;

    const module = await import(moduleUrl) as {
      loadPackForBoot: () => Promise<unknown>;
      safeModeCalls: Array<{
        error: unknown;
        options: { disableModsAndRestart: () => void };
      }>;
    };
    const boot = module.loadPackForBoot();
    /* Attach a rejection handler so a regression is an ordinary assertion
     * failure rather than an unhandled-rejection side effect in Vitest. */
    let rejected = false;
    void boot.catch(() => {
      rejected = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(module.safeModeCalls, "main.ts did not route the composition error to safe mode").toHaveLength(1);
    expect(rejected, "the boot boundary let the composition error escape").toBe(false);

    /* The boundary calls the real, reusable screen in production. Render that
     * screen with the exact error and callback it received, so this test proves
     * the player sees the recovery rather than merely a bookkeeping call. */
    const body = installFakeDom();
    let disabled = false;
    const routed = module.safeModeCalls[0]!;
    showSafeModeScreen(routed.error, {
      disableModsAndRestart: () => {
        disabled = true;
        routed.options.disableModsAndRestart();
      },
    });
    const screen = body.children[0];
    expect(screen, "the composition failure did not reach a safe-mode screen").toBeDefined();
    expect(allText(screen!)).toContain("could not start with the enabled mods");
    expect(allText(screen!)).toContain("duplicate record");

    const restart = findButton(screen!);
    expect(restart?.textContent).toBe("Disable all mods and restart");
    restart?.click();
    expect(disabled, "safe mode did not offer the disable-and-retry path").toBe(true);
  });

  it("persists every effective mod as off, drops session mods, and removes ?mods=", async () => {
    const source = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.Latest, true);
    const action = source.statements.find(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === "disableAllModsAndRestart",
    );
    expect(action, "main.ts no longer owns the safe-mode disable action").toBeDefined();

    const harness = [
      "const writes = [];",
      'const enabledModIds = () => ["folder-mod", "installed-mod"];',
      "const defaultModStore = () => ({",
      "  setEnabled: (ids) => void writes.push(['enabled', ids]),",
      "  setModChoice: (id, on) => void writes.push(['choice', id, on]),",
      "});",
      "const dropSessionMods = () => void writes.push(['drop-session']);",
      'const location = { href: "https://example.test/?mods=folder-mod,installed-mod", reload: () => void writes.push(["reload"]) };',
      "const history = { replaceState: (_state, _title, url) => void writes.push(['url', url]) };",
      action!.getText(source),
      "export { disableAllModsAndRestart, writes };",
    ].join("\n");
    const emitted = ts.transpileModule(harness, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    }).outputText;
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(emitted).toString("base64")}`;
    const module = await import(moduleUrl) as {
      disableAllModsAndRestart: () => void;
      writes: unknown[][];
    };

    module.disableAllModsAndRestart();
    expect(module.writes).toEqual([
      ["enabled", []],
      ["choice", "folder-mod", false],
      ["choice", "installed-mod", false],
      ["drop-session"],
      ["url", "https://example.test/"],
      ["reload"],
    ]);
  });
});
