import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
    const moduleStart = performance.now();
    const { createModCompartment, initializeModCompartments, domCompartmentGlobals } = require(${JSON.stringify(bundle)});
    const moduleLoadMs = performance.now() - moduleStart;
    const core = await import(pathToFileURL(${JSON.stringify(hostModule)}));
    const records = new Map();
    const read = (path) => records.has(path) ? new TextEncoder().encode(records.get(path)) : null;
    const lockdownStart = performance.now();
    initializeModCompartments();
    const lockdownMs = performance.now() - lockdownStart;
    const c = createModCompartment("first", read);
    initializeModCompartments();
    const forbidden = ["window", "document", "indexedDB", "localStorage", "neoHostFs", "neoDesktop", "fetch", "XMLHttpRequest", "WebSocket", "open", "Worker"];
    const absent = Object.fromEntries(forbidden.map(name => [name, c.evaluate("typeof " + name) === "undefined"]));
    c.globalThis.portPrototype = MessagePort.prototype;
    const frozen = c.evaluate('[Object.prototype, Array.prototype, Function.prototype, Promise.prototype, portPrototype].map(proto => { try { Object.defineProperty(proto, "compartmentPoison", { value: true }); return false; } catch { return !Object.hasOwn(proto, "compartmentPoison"); } })');
    c.globalThis.secret = "first-only";
    const other = createModCompartment("second", read);
    const isolated = other.evaluate("typeof secret === 'undefined' && typeof globalThis.secret === 'undefined'");
    const sharedWrappers = c.globalThis.setTimeout === other.globalThis.setTimeout &&
      c.evaluate('[setTimeout, clearTimeout, setInterval, clearInterval, performance, performance.now, structuredClone].every(Object.isFrozen)');
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
    const facadeStart = performance.now();
    domCompartmentGlobals();
    const facadeMs = performance.now() - facadeStart;
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
    const encoder = new TextEncoder();
    const benchmarkFiles = new Map([
      ["plugin.js", encoder.encode('import { value } from "./value.js"; ' + Array.from({ length: 256 }, (_, i) => 'export const v' + i + ' = value + ' + i + ';').join('\\n') + '\\nexport default { api: 1, hooks: () => ({}) };')],
      ["value.js", encoder.encode('export const value = 42;')],
    ]);
    const mods = [];
    for (let index = 0; index < 9; index++) {
      const constructStart = performance.now();
      const compartment = createModCompartment("bench-" + index, path => benchmarkFiles.get(path) ?? null);
      const constructMs = performance.now() - constructStart;
      const evaluateStart = performance.now();
      compartment.importNow("plugin.js");
      mods.push({ constructMs, evaluateMs: performance.now() - evaluateStart });
    }
    const timings = { moduleLoadMs, lockdownMs, facadeMs, bytesPerMod: [...benchmarkFiles.values()].reduce((size, bytes) => size + bytes.length, 0), mods };
    console.log(JSON.stringify({ absent, pageSeparate: loaded.scope !== globalThis, frozen, isolated, sharedWrappers, measuredModule: loaded.value, rejected, timerRejected, hostEscape: escape === "ok" && written[1] === "compartment-probe.txt", rawDomEscape, sharedEscape, membrane, opened, timings }));
  `], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  expect(child.status, child.stderr).toBe(0);
  result = JSON.parse(child.stdout.trim()) as Record<string, unknown>;
}, 70000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("leaves lockdown and compartment construction untouched when the setting is absent", () => {
  const bundle = join(dir, "startup.mjs");
  buildSync({
    entryPoints: [fileURLToPath(new URL("./mod-lockdown.ts", import.meta.url))],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    logLevel: "silent",
  });
  const probe = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    let lockdownCalls = 0;
    let compartments = 0;
    globalThis.lockdown = () => { lockdownCalls++; };
    globalThis.Compartment = function () { compartments++; };
    const initialLockdown = globalThis.lockdown;
    const initialCompartment = globalThis.Compartment;
    const startup = await import(${JSON.stringify(pathToFileURL(bundle).href)});
    console.log(JSON.stringify({ lockdownCalls, compartments, frozen: Object.isFrozen(Object.prototype),
      sameLockdown: globalThis.lockdown === initialLockdown, sameCompartment: globalThis.Compartment === initialCompartment,
      enabled: startup.modCompartmentsEnabled, runtimeAbsent: startup.compartmentRuntime === undefined }));
  `], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  expect(probe.status, probe.stderr).toBe(0);
  expect(JSON.parse(probe.stdout.trim())).toEqual({ lockdownCalls: 0, compartments: 0, frozen: false,
    sameLockdown: true, sameCompartment: true, enabled: false, runtimeAbsent: true });
}, 70000);

describe("startup mode and the production loader", () => {
  const bundle = join(dir, "loader.mjs");

  beforeAll(() => {
    buildSync({
      stdin: {
        contents: `
          export * from "./mod-lockdown";
          export { loadModCode } from "./mod-code";
          export { prepareModPayloads } from "./mod-code-snapshot";
          export { validateManifest } from "@rpgm-tools/neo-angband-mod-sdk";
          export { createModUi } from "./panel-runtime";
          export { desktopInstallation } from "./host-electron";
          export { setModStorage, defaultModStore } from "./mod-store";
          export { consentBinding, setConsentBindings, invalidateModConsent } from "./mod-consent-binding";
        `,
        resolveDir: fileURLToPath(new URL("./", import.meta.url)),
      },
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      banner: { js: 'import { createRequire as startupRequire } from "node:module"; const require = startupRequire(import.meta.url); import.meta.glob = () => ({}); import.meta.env = { DEV: false };' },
      logLevel: "silent",
    });
  });

  it.each([false, true, "blocked"] as const)("latches %s before loading code and panels", (setting) => {
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      const { JSDOM } = await import("jsdom");
      const page = new JSDOM("<!doctype html><body></body>", { url: "https://game.invalid" }).window;
      globalThis.window = page;
      globalThis.document = page.document;
      let arms = 0;
      globalThis.neoDesktop = {
        recordMeasuredMod: () => true,
        useMeasuredMod: () => "fixture-" + ++arms,
      };
      const setting = ${JSON.stringify(setting)};
      let saved = setting;
      Object.defineProperty(globalThis, "localStorage", { configurable: true, get() {
        if (setting === "blocked") throw new Error("storage denied");
        return { getItem: () => JSON.stringify({ format: "neo-angband/web/settings", schemaVersion: 1, data: { modCompartments: saved } }) };
      } });
      const api = await import(${JSON.stringify(pathToFileURL(bundle).href)});
      if (api.modCompartmentsEnabled) await api.initializeModIsolation();
      saved = !setting;
      const tier = { trust: "first-party", execution: "in-process", capabilityTier: "first-party", seams: [], marksSave: [], why: "fixture" };
      const sources = new Map([
        ["good", "export default { api: 1, hooks: () => ({}), scope: globalThis };"],
        ["throwing", "throw new Error('fixture import failed'); export default { api: 1 };"],
        ["awaiting", "await new Promise(() => {}); export default { api: 1 };"],
        ["last", "export default { api: 1, hooks: () => ({}), scope: globalThis };"],
      ]);
      const ids = setting === true ? [...sources.keys()] : ["good"];
      const packs = ids.map(id => ({
        manifest: api.validateManifest({ id, name: id, version: "1.0.0", shape: "plugin", modApi: 1, capabilities: ["backup:folder"] }),
        code: ["plugin.js"], files: {}, assets: [],
      }));
      const bytes = new Map();
      for (const pack of packs) {
        bytes.set(pack.manifest.id + "/manifest.json", new TextEncoder().encode(JSON.stringify(pack.manifest)));
        bytes.set(pack.manifest.id + "/plugin.js", new TextEncoder().encode(sources.get(pack.manifest.id)));
      }
      await api.prepareModPayloads({ packs, assetUrl: async (id, file) => id + "/" + file }, () => tier,
        async url => bytes.get(url));
      let urlCalls = 0;
      URL.createObjectURL = () => { urlCalls++; return "data:text/javascript," + encodeURIComponent(sources.get("good")); };
      const report = await api.loadModCode({ packs, codeUrl: async () => { throw new Error("unmeasured URL"); },
        enabled: () => true, consented: () => ["backup:folder"], tier: () => tier });
      console.error(JSON.stringify(report.problems));
      const panel = api.createModUi("good").openPanel({ id: "probe" });
      const rawPanel = panel.root.ownerDocument === page.document;
      panel.close();
      const values = new Map();
      api.setModStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) });
      api.defaultModStore().setDecisions("good", { granted: ["backup:folder"], refused: [], binding: api.consentBinding("good") }, "1.0.0");
      const decisions = [];
      const bridge = { consent: async decision => {
        decisions.push(decision);
        return decision.quiet ? { ok: false } : { ok: true, installation: "a".repeat(64), modId: "good", digest: decision.digest };
      } };
      const quiet = await api.desktopInstallation("good", bridge, [], true);
      const granted = await api.desktopInstallation("good", bridge);
      api.invalidateModConsent("good");
      await api.desktopInstallation("good", bridge);
      api.setConsentBindings(new Map([["good", "replacement"]]));
      const consentKept = quiet === null && granted !== null && decisions[0].quiet === true &&
        decisions.some(d => d.revoke === true) && decisions.some(d => d.release === true) &&
        decisions.every(d => (typeof d.measuredToken === "string") === (setting === true));
      console.log(JSON.stringify({ enabled: api.modCompartmentsEnabled, frozen: Object.isFrozen(Object.prototype),
        plugins: report.plugins.map(p => p.id), problems: report.problems.map(p => p.id),
        samePage: report.plugins[0]?.plugin.scope === globalThis, urlCalls, rawPanel, consentKept }));
    `], { encoding: "utf8", windowsHide: true, timeout: 60000 });
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout.trim()), child.stderr).toEqual(setting === true
      ? { enabled: true, frozen: true, plugins: ["good", "last"], problems: ["throwing", "awaiting"], samePage: false, urlCalls: 0, rawPanel: false, consentKept: true }
      : { enabled: false, frozen: false, plugins: ["good"], problems: [], samePage: true, urlCalls: 1, rawPanel: true, consentKept: true });
  }, 70000);
});

describe("measured mod compartments", () => {
  it("records startup phase timings in the isolated harness", () => {
    const timings = result.timings as { mods: { constructMs: number; evaluateMs: number }[] };
    expect(timings.mods).toHaveLength(9);
    expect(timings.mods.every((mod) => Number.isFinite(mod.constructMs) && Number.isFinite(mod.evaluateMs))).toBe(true);
    console.log("compartment timings " + JSON.stringify(timings));
  });

  it("keeps the page globals out of the module", () => {
    expect(Object.values(result.absent as object).every(Boolean)).toBe(true);
    expect(result.pageSeparate).toBe(true);
  });

  it("rejects poisoning of language and MessagePort prototypes", () => {
    expect(result.frozen).toEqual([true, true, true, true, true]);
  });

  it("separates private globals between mods", () => {
    expect(result.isolated).toBe(true);
    expect(result.sharedWrappers).toBe(true);
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
