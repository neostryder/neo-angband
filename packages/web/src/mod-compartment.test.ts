import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildSync } = require("esbuild") as typeof import("esbuild");
const scratch = fileURLToPath(new URL("../../../.spike/tmp/", import.meta.url));
mkdirSync(scratch, { recursive: true });
const dir = mkdtempSync(join(scratch, "compartment-test-"));
let result: Record<string, unknown>;

beforeAll(() => {
  // Lockdown changes the process intrinsics, so the test runner needs a separate process.
  const bundle = join(dir, "compartment.cjs");
  buildSync({
    entryPoints: [fileURLToPath(new URL("./mod-compartment.ts", import.meta.url))],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
  });
  const hostModule = fileURLToPath(new URL("../../core/dist/host/io.js", import.meta.url));
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { createRequire } from "node:module";
    import { pathToFileURL } from "node:url";
    const { JSDOM } = await import("jsdom");
    const require = createRequire(import.meta.url);
    const { createModCompartment, initializeModCompartments } = require(${JSON.stringify(bundle)});
    const core = await import(pathToFileURL(${JSON.stringify(hostModule)}));
    const records = new Map();
    const read = (path) => records.has(path) ? new TextEncoder().encode(records.get(path)) : null;
    const c = createModCompartment("first", read);
    initializeModCompartments();
    const forbidden = ["window", "document", "indexedDB", "localStorage", "neoHostFs", "neoDesktop", "fetch", "XMLHttpRequest", "WebSocket", "open", "Worker"];
    const absent = Object.fromEntries(forbidden.map(name => [name, c.evaluate("typeof " + name) === "undefined"]));
    c.globalThis.portPrototype = MessagePort.prototype;
    const frozen = c.evaluate('[Object.prototype, Array.prototype, Function.prototype, Promise.prototype, portPrototype].map(proto => { try { Object.defineProperty(proto, "compartmentPoison", { value: true }); return false; } catch { return !Object.hasOwn(proto, "compartmentPoison"); } })');
    c.globalThis.secret = "first-only";
    const other = createModCompartment("second", read);
    const isolated = other.evaluate("typeof secret === 'undefined' && typeof globalThis.secret === 'undefined'");
    records.set("plugin.js", 'import { value } from "./lib/value.js"; export default { value, scope: globalThis };');
    records.set("lib/value.js", 'export const value = 42;');
    const loaded = c.importNow("plugin.js").default;
    const reject = async (specifier) => {
      records.set("plugin.js", 'export default () => import(' + JSON.stringify(specifier) + ');');
      try { const mod = createModCompartment("reject", read).importNow("plugin.js"); await mod.default(); return false; } catch { return true; }
    };
    const rejected = await Promise.all(["https://example.invalid/evil.js", "file:///secret.js", "../../secret.js", "ses"].map(reject));
    let timerRejected = false;
    try { c.evaluate("setTimeout('globalThis.bad = true', 0)"); } catch { timerRejected = true; }
    let written;
    core.setHost({ ...core.NULL_HOST, write: (...args) => { written = args; return "ok"; } });
    records.set("plugin.js", 'export default ctx => ctx.core.host().write("user", "compartment-probe.txt", "probe");');
    const escape = createModCompartment("host-escape", read).importNow("plugin.js").default({ core });
    const fakePage = { marker: "page-authority" };
    records.set("plugin.js", 'export default panel => panel.root.ownerDocument.defaultView.marker;');
    const rawDomEscape = createModCompartment("dom-escape", read).importNow("plugin.js").default({ root: { ownerDocument: { defaultView: fakePage } } });
    const shared = {};
    c.globalThis.engine = shared;
    other.globalThis.engine = shared;
    c.evaluate("engine.stolenEndowment = secret");
    const sharedEscape = other.evaluate("engine.stolenEndowment");
    const dom = new JSDOM("<!doctype html><html><body><div id='game-view'></div></body></html>", { url: "https://lab.invalid/game?agent=1" });
    const page = dom.window;
    page.neoHostFs = { marker: "page-bridge" };
    page.neoDesktop = { consent() { return "desktop"; } };
    page.fetch = () => "page-fetch";
    page.open = () => "page-open";
    page.localStorage.setItem("neo-angband:mod-state", "forged");
    page.localStorage.setItem("squire/panelScale", "1.15");
    page.sessionStorage.setItem("neo-angband-birth-done", "1");
    const opened = [];
    page.indexedDB = { open(name) { opened.push(name); return { name }; }, deleteDatabase(name) { opened.push("del:" + name); return { name }; }, cmp() { return 0; }, databases() { return Promise.resolve([{ name: "neo-angband" }, { name: "other" }]); } };
    globalThis.window = page;
    globalThis.document = page.document;
    const domed = createModCompartment("domed", read);
    const membrane = domed.evaluate(\`(() => {
      const el = document.createElement("div");
      el.className = "probe";
      document.body.append(el);
      const canvas = document.createElement("canvas");
      let scriptBlocked = false;
      try { document.createElement("script"); } catch { scriptBlocked = true; }
      let handlerBlocked = false;
      try { el.setAttribute("onclick", "1"); } catch { handlerBlocked = true; }
      let urlBlocked = false;
      try { const link = document.createElement("a"); link.href = "javascript:alert(1)"; urlBlocked = link.href.startsWith("javascript:"); } catch { urlBlocked = true; }
      let reservedWrite = false;
      try { localStorage.setItem("neo-angband:mod-state", "x"); } catch { reservedWrite = true; }
      let indexedBlocked = false;
      let indexedAllowed = false;
      try { indexedDB.open("neo-angband"); } catch { indexedBlocked = true; }
      try { indexedAllowed = indexedDB.open("neo-angband-squire").name === "neo-angband-squire"; } catch { indexedAllowed = false; }
      let viewBridge = "missing";
      el.addEventListener("click", (event) => { viewBridge = event.view && event.view.neoHostFs ? "bridged" : "contained"; });
      el.click();
      const proto = Object.getPrototypeOf(el);
      return {
        separateWindow: window !== undefined && window.neoHostFs === undefined && window.neoDesktop === undefined && window.fetch === undefined && window.open === undefined,
        separateDocument: document.defaultView.neoHostFs === undefined && document.defaultView.localStorage === undefined && document.defaultView.indexedDB === undefined,
        noFetch: typeof fetch === "undefined",
        noOpen: typeof open === "undefined",
        noXhr: typeof XMLHttpRequest === "undefined",
        noSocket: typeof WebSocket === "undefined",
        noWorker: typeof Worker === "undefined",
        noPageGlobal: globalThis.neoHostFs === undefined,
        element: el instanceof HTMLElement && canvas instanceof HTMLCanvasElement && document.getElementById("game-view") !== null,
        scriptBlocked, handlerBlocked, urlBlocked, reservedWrite, indexedBlocked, indexedAllowed,
        consentHidden: localStorage.getItem("neo-angband:mod-state") === null,
        scaleKept: localStorage.getItem("squire/panelScale") === "1.15",
        birthKept: sessionStorage.getItem("neo-angband-birth-done") === "1",
        locationAgent: new URL(location.href).searchParams.has("agent"),
        protoContained: proto.ownerDocument === undefined || proto.ownerDocument.defaultView.neoHostFs === undefined,
        clickContained: viewBridge === "contained",
      };
    })()\`);
    console.log(JSON.stringify({ absent, pageSeparate: loaded.scope !== globalThis, frozen, isolated, measuredModule: loaded.value, rejected, timerRejected, hostEscape: escape === "ok" && written[1] === "compartment-probe.txt", rawDomEscape, sharedEscape, membrane, opened }));
  `], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  expect(child.status, child.stderr).toBe(0);
  result = JSON.parse(child.stdout.trim()) as Record<string, unknown>;
}, 70000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("measured mod compartments", () => {
  it("keeps the page globals out of the module", () => {
    expect(Object.values(result.absent as object).every(Boolean)).toBe(true);
    expect(result.pageSeparate).toBe(true);
  });

  it("rejects poisoning of language and MessagePort prototypes", () => {
    expect(result.frozen).toEqual([true, true, true, true, true]);
  });

  it("separates private globals between mods", () => {
    expect(result.isolated).toBe(true);
  });

  it("links measured bytes and rejects arbitrary dynamic imports", () => {
    expect(result.measuredModule).toBe(42);
    expect(result.rejected).toEqual([true, true, true, true]);
  });

  it("rejects string timers", () => {
    expect(result.timerRejected).toBe(true);
  });

  it("reproduces the remaining host escape through the live engine", () => {
    expect(result.hostEscape).toBe(true);
  });

  it("keeps a raw object argument and a shared engine object able to cross", () => {
    expect(result.rawDomEscape).toBe("page-authority");
    expect(result.sharedEscape).toBe("first-only");
  });

  it("keeps page bridges and reserved records off the DOM facade", () => {
    const membrane = result.membrane as Record<string, boolean>;
    expect(membrane).toMatchObject({
      separateWindow: true,
      separateDocument: true,
      noFetch: true,
      noOpen: true,
      noXhr: true,
      noSocket: true,
      noWorker: true,
      noPageGlobal: true,
      element: true,
      scriptBlocked: true,
      handlerBlocked: true,
      urlBlocked: true,
      reservedWrite: true,
      indexedBlocked: true,
      indexedAllowed: true,
      consentHidden: true,
      scaleKept: true,
      birthKept: true,
      locationAgent: true,
      protoContained: true,
      clickContained: true,
    });
    expect(result.opened).toEqual(["neo-angband-squire"]);
  });
});
