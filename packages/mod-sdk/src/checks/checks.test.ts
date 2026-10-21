/**
 * The fixed checks, one rule at a time: each rule has a mod that trips it and a
 * near-identical mod that does not, so a rule that can never fire, or fires on
 * everything, fails here. A last group runs the in-tree sample mods, which must
 * come through with no block finding.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { capabilityTiers } from "../capability-vocabulary.js";
import type { LoadedPack } from "../loader.js";
import { worstSeverity } from "../mod-findings.js";
import { MOD_REQUIREMENTS } from "../standards.js";
import { readModArchive } from "./archive.js";
import { basePackFromFiles } from "./composition.js";
import { runModChecks } from "./index.js";
import { installChecks } from "./install.js";
import { CHECK_RULES, INSTALL_CHECK_RULES, checkRule, checksMarkdown } from "./rules.js";
import { ARCHIVE_LIMITS, isPayloadPath, type ModFileEntries } from "./subject.js";

/* ------------------------------------------------------------------ */
/* Building mods                                                        */
/* ------------------------------------------------------------------ */

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

type Files = Record<string, string | Uint8Array>;

const entriesOf = (files: Files): ModFileEntries =>
  Object.entries(files).map(([path, body]) => [path, typeof body === "string" ? enc(body) : body] as const);

const V1 = {
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  shape: "plugin",
  modApi: 1,
  engine: ">=0.1.0",
  author: "neostryder",
  license: "MIT",
  repository: "https://github.com/neostryder/neo-angband-mod-demo",
  description: "A mod that exists to be checked, with a description long enough to count.",
};

/** A schema 1 plugin with `plugin.js` = `code`. */
const plugin = (capabilities: readonly string[], code: string, extra: Files = {}, manifest: Record<string, unknown> = {}): Files => ({
  "manifest.json": JSON.stringify({ ...V1, capabilities, ...manifest }),
  "plugin.js": code,
  ...extra,
});

/** A schema 2 manifest document. */
const v2 = (data: Record<string, unknown>): string =>
  JSON.stringify({ format: "neo-angband/mod/manifest", schemaVersion: 2, data: { id: "demo", name: "Demo", version: "1.0.0", ...data } });

/** A content mod adding `files` over the base game. */
const content = (files: Files, manifest: Record<string, unknown> = {}): Files => ({
  "manifest.json": JSON.stringify({ ...V1, shape: "content", modApi: undefined, dependencies: { core: "*" }, ...manifest }),
  ...files,
});

const PACK_DIR = join(import.meta.dirname, "..", "..", "..", "content", "pack");
let base: LoadedPack[] | undefined;
function basePacks(): LoadedPack[] {
  if (base === undefined) {
    const files: Record<string, unknown> = {};
    for (const name of readdirSync(PACK_DIR)) if (name.endsWith(".json")) files[name] = JSON.parse(readFileSync(join(PACK_DIR, name), "utf8"));
    base = [basePackFromFiles(files)];
  }
  return base;
}

interface Run {
  readonly files: Files;
  readonly archives?: readonly string[];
  readonly firstParty?: boolean;
  readonly base?: boolean;
}

async function rulesOf(run: Run): Promise<string[]> {
  const { report } = await runModChecks(
    { files: entriesOf(run.files), ...(run.archives !== undefined ? { archives: run.archives } : {}) },
    { firstParty: run.firstParty === true, ...(run.base === true ? { base: basePacks() } : {}) },
  );
  return report.findings.map((f) => f.rule);
}

/* ------------------------------------------------------------------ */
/* Building archives                                                    */
/* ------------------------------------------------------------------ */

const CRC = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  readonly name: string;
  readonly data?: string | Uint8Array;
  readonly deflate?: boolean;
  /** Overrides for the stated sizes, method and flags. */
  readonly size?: number;
  readonly method?: number;
  readonly flags?: number;
  /** A unix mode for the external attributes (0o120777 is a symbolic link). */
  readonly unix?: number;
  /** Point the directory at an earlier entry's local header. */
  readonly sameAs?: number;
}

/** A zip archive; `zip64` writes the ZIP64 marker into the end record. */
function zip(list: readonly ZipEntry[], zip64 = false): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  const offsets: number[] = [];
  const u16 = (out: number[], v: number): void => {
    out.push(v & 0xff, (v >>> 8) & 0xff);
  };
  const u32 = (out: number[], v: number): void => {
    u16(out, v & 0xffff);
    u16(out, (v >>> 16) & 0xffff);
  };
  for (const e of list) {
    const raw = typeof e.data === "string" ? enc(e.data) : e.data ?? new Uint8Array();
    const body = e.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = enc(e.name);
    const method = e.method ?? (e.deflate ? 8 : 0);
    const crc = crc32(raw);
    const offset = e.sameAs === undefined ? parts.length : (offsets[e.sameAs] as number);
    offsets.push(offset);
    if (e.sameAs === undefined) {
      u32(parts, 0x04034b50);
      u16(parts, 20);
      u16(parts, (e.flags ?? 0) | 0x800);
      u16(parts, method);
      u32(parts, 0);
      u32(parts, crc);
      u32(parts, body.length);
      u32(parts, e.size ?? raw.length);
      u16(parts, name.length);
      u16(parts, 0);
      parts.push(...name, ...body);
    }
    u32(central, 0x02014b50);
    u16(central, e.unix === undefined ? 20 : (3 << 8) | 20);
    u16(central, 20);
    u16(central, (e.flags ?? 0) | 0x800);
    u16(central, method);
    u32(central, 0);
    u32(central, crc);
    u32(central, body.length);
    u32(central, e.size ?? raw.length);
    u16(central, name.length);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, e.unix === undefined ? 0 : (e.unix << 16) >>> 0);
    u32(central, offset);
    central.push(...name);
  }
  const end: number[] = [];
  u32(end, 0x06054b50);
  u16(end, 0);
  u16(end, 0);
  u16(end, zip64 ? 0xffff : list.length);
  u16(end, zip64 ? 0xffff : list.length);
  u32(end, central.length);
  u32(end, parts.length);
  u16(end, 0);
  return new Uint8Array([...parts, ...central, ...end]);
}

/** A mod whose payload is the one archive `pack.zip`. */
const archived = (archive: Uint8Array): Run => ({ files: { "pack.zip": archive }, archives: ["pack.zip"] });
const GOOD_ARCHIVE = (): Uint8Array => zip([
  { name: "manifest.json", data: JSON.stringify({ ...V1, capabilities: [] }) },
  { name: "plugin.js", data: "export default { api: 1 };", deflate: true },
]);

/* ------------------------------------------------------------------ */
/* One trip and one pass per rule                                       */
/* ------------------------------------------------------------------ */

const OK = "export default { api: 1, register(host, ctx) { ctx.log('hello'); } };";
const NET = ["network:api.example.com"];
const WORKER_ONLY_IN_PROCESS = ["display:replace", "ui:panel.mount", "registry:tiles", "ui:region.create"].find((c) => !capabilityTiers(c).includes("worker"));
const LONG = (n: number): string => `export default { api: 1, register(host, ctx) { const t = [${Array.from({ length: n }, (_, i) => `() => ${i}`).join(", ")}]; ctx.log(t); } };`;
const token = ["gh", "p_", "Ab3".repeat(12)].join("");

const OBJECT = {
  name: "Odd Rock~", type: "soft armor", graphics: { glyph: "*", color: "w" }, level: 1, weight: 10, cost: 1,
  alloc: { common: 20, minmax: "1 to 40" }, attack: { hd: "0d0", "to-h": "0", "to-d": "0" }, armor: { ac: 1, "to-a": "0" },
  desc: ["A rock."],
};

const CASES: Record<string, { readonly trip: () => Run; readonly pass: () => Run }> = {
  "archive-unreadable": { trip: () => archived(enc("this is not a zip")), pass: () => archived(GOOD_ARCHIVE()) },
  "archive-path": {
    trip: () => archived(zip([{ name: "manifest.json", data: "{}" }, { name: "../escape.js", data: "x" }])),
    pass: () => archived(GOOD_ARCHIVE()),
  },
  "archive-duplicate": {
    trip: () => archived(zip([{ name: "a.txt", data: "a" }, { name: "A.txt", data: "b" }])),
    pass: () => archived(zip([{ name: "a.txt", data: "a" }, { name: "b.txt", data: "b" }])),
  },
  "archive-size": {
    trip: () => archived(zip(Array.from({ length: 4097 }, (_, i) => ({ name: `f${i}.txt` })))),
    pass: () => archived(zip(Array.from({ length: 40 }, (_, i) => ({ name: `f${i}.txt` })))),
  },
  "archive-bomb": {
    trip: () => archived(zip([{ name: "zeros.bin", data: new Uint8Array(4 * 1024 * 1024), deflate: true }])),
    pass: () => archived(zip([{ name: "text.txt", data: Array.from({ length: 400 }, (_, i) => `line ${String(i * 7919 % 1009)}`).join("\n"), deflate: true }])),
  },
  "archive-entry-type": {
    trip: () => archived(zip([{ name: "link", data: "/etc/passwd", unix: 0o120777 }])),
    pass: () => archived(zip([{ name: "link", data: "plain", unix: 0o100644 }])),
  },
  "archive-unmeasured": {
    trip: () => archived(zip([{ name: "a.txt", data: "a" }], true)),
    pass: () => archived(zip([{ name: "a.txt", data: "a" }])),
  },
  "payload-path": {
    trip: () => ({ files: plugin([], OK, { "docs\\notes.txt": "x" }) }),
    pass: () => ({ files: plugin([], OK, { "docs/notes.txt": "x" }) }),
  },
  "payload-collision": {
    trip: () => ({ files: plugin([], OK, { "notes.txt": "a", "NOTES.txt": "b" }) }),
    pass: () => ({ files: plugin([], OK, { "notes.txt": "a", "more-notes.txt": "b" }) }),
  },
  "payload-size": {
    trip: () => ({ files: plugin([], OK, Object.fromEntries(Array.from({ length: 4100 }, (_, i) => [`data/f${i}.txt`, ""]))) }),
    pass: () => ({ files: plugin([], OK, Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`data/f${i}.txt`, ""]))) }),
  },
  "payload-incomplete": {
    trip: () => ({ files: plugin([], OK, {}, { payload: { files: ["manifest.json", "plugin.js", "missing.js"] } }) }),
    pass: () => ({ files: plugin([], OK, {}, { payload: { files: ["manifest.json", "plugin.js"] } }) }),
  },
  "entry-module": {
    trip: () => ({ files: { "manifest.json": v2({ api: "*", runtime: "in-process" }) } }),
    pass: () => ({ files: { "manifest.json": v2({ api: "*", runtime: "in-process" }), "plugin.js": OK } }),
  },
  "listing-files": {
    trip: () => ({ files: plugin([], OK, {}, { changelog: "CHANGELOG.md" }) }),
    pass: () => ({ files: plugin([], OK, { "CHANGELOG.md": "# Changelog" }, { changelog: "CHANGELOG.md" }) }),
  },
  "budget-ceiling": {
    trip: () => ({ files: { "manifest.json": v2({ api: "*", runtime: "in-process", budget: { msPerTurn: 600 } }), "plugin.js": OK } }),
    pass: () => ({ files: { "manifest.json": v2({ api: "*", runtime: "in-process", budget: { msPerTurn: 500 } }), "plugin.js": OK } }),
  },
  "budget-default": {
    trip: () => ({ files: { "manifest.json": v2({ api: "*", runtime: "in-process" }), "plugin.js": OK } }),
    pass: () => ({ files: { "manifest.json": v2({ api: "*", runtime: "in-process", budget: { msPerTurn: 20 } }), "plugin.js": OK } }),
  },
  "api-range": {
    trip: () => ({ files: { "manifest.json": v2({ api: "^3.0.0", runtime: "in-process" }), "plugin.js": OK } }),
    pass: () => ({ files: { "manifest.json": v2({ api: ">=1.0.0 <2.0.0", runtime: "in-process" }), "plugin.js": OK } }),
  },
  "dependency-order": {
    trip: () => ({ files: plugin([], OK, {}, { dependencies: { core: "*", other: "*" }, loadBefore: ["other"] }) }),
    pass: () => ({ files: plugin([], OK, {}, { dependencies: { core: "*", other: "*" }, loadAfter: ["other"] }) }),
  },
  "capability-tier": {
    trip: () => ({ files: { "manifest.json": v2({ api: "^2.0.0", runtime: "worker", entry: "main.js", capabilities: [WORKER_ONLY_IN_PROCESS] }), "main.js": "export default { api: \"^2.0.0\", start() {} };" } }),
    pass: () => ({ files: { "manifest.json": v2({ api: "^2.0.0", runtime: "worker", entry: "main.js", capabilities: ["state:player.read"] }), "main.js": "export default { api: \"^2.0.0\", start() {} };" } }),
  },
  "first-party-capability": {
    trip: () => ({ files: plugin(["mod:install"], "export default { api: 1, register(host, ctx) { ctx.installMod(new Uint8Array()); } };") }),
    pass: () => ({ files: plugin(["mod:install"], "export default { api: 1, register(host, ctx) { ctx.installMod(new Uint8Array()); } };"), firstParty: true }),
  },
  "unparsed-module": {
    trip: () => ({ files: plugin([], "export default { api: 1, register( {") }),
    pass: () => ({ files: plugin([], OK) }),
  },
  "missing-module": {
    trip: () => ({ files: plugin([], `import { x } from "./nope.js";\n${OK}`) }),
    pass: () => ({ files: plugin([], `import { x } from "./lib.js";\n${OK}`, { "lib.js": "export const x = 1;" }) }),
  },
  "unresolved-import": {
    trip: () => ({ files: plugin([], `import lodash from "lodash";\n${OK}`) }),
    pass: () => ({ files: plugin([], `import lodash from "./lodash.js";\n${OK}`, { "lodash.js": "export default {};" }) }),
  },
  "import-cycle": {
    trip: () => ({ files: plugin([], `import "./a.js";\n${OK}`, { "a.js": "import './b.js';", "b.js": "import './a.js';" }) }),
    pass: () => ({ files: plugin([], `import "./a.js";\n${OK}`, { "a.js": "import './b.js';", "b.js": "export {};" }) }),
  },
  "computed-import": {
    trip: () => ({ files: plugin([], "export default { api: 1, register(host, ctx) { const name = ctx.anything; import(name); } };") }),
    pass: () => ({ files: plugin([], "export default { api: 1, register(host, ctx) { import('./lazy.js'); } };", { "lazy.js": "export {};" }) }),
  },
  "remote-import": {
    trip: () => ({ files: plugin([], `import evil from "https://cdn.example.com/evil.js";\n${OK}`) }),
    pass: () => ({ files: plugin([], `import good from "./good.js";\n${OK}`, { "good.js": "export default 1;" }) }),
  },
  "unreachable-code": {
    trip: () => ({ files: plugin([], OK, { "stray.js": "export const x = 1;" }) }),
    pass: () => ({ files: plugin([], `import "./used.js";\n${OK}`, { "used.js": "export const x = 1;" }) }),
  },
  "undeclared-capability": {
    trip: () => ({ files: plugin([], "export default { api: 1, register(host, ctx) { ctx.installMod(new Uint8Array()); } };"), firstParty: true }),
    pass: () => ({ files: plugin(["mod:install"], "export default { api: 1, register(host, ctx) { ctx.installMod(new Uint8Array()); } };"), firstParty: true }),
  },
  "capability-feature-test": {
    trip: () => ({ files: plugin([], "export default { api: 1, register(host, ctx) { if (ctx.installMod) ctx.installMod(new Uint8Array()); } };") }),
    pass: () => ({ files: plugin(["mod:install"], "export default { api: 1, register(host, ctx) { if (ctx.installMod) ctx.installMod(new Uint8Array()); } };"), firstParty: true }),
  },
  "computed-context-access": {
    trip: () => ({ files: plugin([], "export default { api: 1, register(host, ctx) { const k = String(Math.random()); ctx[k](); } };") }),
    pass: () => ({ files: plugin([], "export default { api: 1, register(host, ctx) { const k = 'log'; ctx[k]('hi'); } };") }),
  },
  "context-escapes": {
    trip: () => ({ files: plugin([], "export default { api: 1, register(host, ctx) { globalThis.stash(ctx); } };") }),
    pass: () => ({ files: plugin([], "export default { api: 1, register(host, ctx) { console.log(ctx); } };") }),
  },
  "computed-global-access": {
    trip: () => ({ files: plugin([], "export default { api: 1, register() { globalThis[Math.random()]('1'); } };") }),
    pass: () => ({ files: plugin([], "export default { api: 1, register() { globalThis.console.log('1'); } };") }),
  },
  "untracked-invocation": {
    trip: () => ({ files: plugin([], "export default { api: 1, register() { const f = () => {}; f[Date.now()]('1'); } };") }),
    pass: () => ({ files: plugin([], "export default { api: 1, register() { const f = () => {}; f.call(null); } };") }),
  },
  "plugin-shape": {
    trip: () => ({ files: plugin([], "export default globalThis.somePlugin;") }),
    pass: () => ({ files: plugin([], OK) }),
  },
  "analysis-limit": {
    trip: () => ({ files: plugin([], LONG(1100)) }),
    pass: () => ({ files: plugin([], LONG(100)) }),
  },
  "api-mismatch": {
    trip: () => ({ files: plugin([], "export default { api: 2, register() {} };") }),
    pass: () => ({ files: plugin([], "export default { api: 1, register() {} };") }),
  },
  "dynamic-eval": {
    trip: () => ({ files: plugin([], "export default { api: 1, register(host, ctx) { setTimeout('ctx.log(1)', 10); } };") }),
    pass: () => ({ files: plugin([], "export default { api: 1, register(host, ctx) { setTimeout(() => ctx.log(1), 10); } };") }),
  },
  "script-injection": {
    trip: () => ({ files: plugin([], "export default { api: 1, register() { document.body.append(document.createElement('script')); } };") }),
    pass: () => ({ files: plugin([], "export default { api: 1, register() { document.body.append(document.createElement('div')); } };") }),
  },
  "nested-worker": {
    trip: () => ({ files: plugin([], "export default { api: 1, register() { new Worker('./w.js'); } };", { "w.js": "" }) }),
    pass: () => ({ files: plugin([], "export default { api: 1, register() { new Map(); } };") }),
  },
  "direct-network": {
    trip: () => ({ files: plugin(NET, "export default { api: 1, register() { fetch('https://api.example.com/x'); } };") }),
    pass: () => ({ files: plugin(NET, "export default { api: 1, register(host, ctx) { ctx.net.request({ url: 'https://api.example.com/x' }); } };") }),
  },
  "undeclared-network-host": {
    trip: () => ({ files: plugin(NET, "export default { api: 1, register(host, ctx) { ctx.net.request({ url: 'https://other.example.org/x' }); } };") }),
    pass: () => ({ files: plugin(NET, "export default { api: 1, register(host, ctx) { ctx.net.request({ url: 'https://api.example.com/x' }); } };") }),
  },
  "network-destination": {
    trip: () => ({ files: plugin(NET, "export default { api: 1, register(host, ctx) { ctx.net.request({ url: ctx.somewhere }); } };") }),
    pass: () => ({ files: plugin(NET, "export default { api: 1, register(host, ctx) { const base = 'https://api.example.com'; ctx.net.request({ url: `${base}/x` }); } };") }),
  },
  "insecure-transport": {
    trip: () => ({ files: plugin(NET, "export default { api: 1, register(host, ctx) { ctx.net.request({ url: 'http://api.example.com/x' }); } };") }),
    pass: () => ({ files: plugin(NET, "export default { api: 1, register(host, ctx) { ctx.net.request({ url: 'https://api.example.com/x' }); } };") }),
  },
  "credential-in-code": {
    trip: () => ({ files: plugin([], `const KEY = "${token}";\n${OK}`) }),
    pass: () => ({ files: plugin([], `const KEY = "not-a-token";\n${OK}`) }),
  },
  "credential-in-url": {
    trip: () => ({ files: plugin(NET, "export default { api: 1, register(host, ctx) { ctx.net.request({ url: 'https://api.example.com/x?api_key=abc123' }); } };") }),
    pass: () => ({ files: plugin(NET, "export default { api: 1, register(host, ctx) { ctx.net.request({ url: 'https://api.example.com/x?page=2' }); } };") }),
  },
  "secret-host": {
    trip: () => ({ files: plugin(NET, "export default { api: 1, register(host, ctx) { ctx.net.secrets.set('my-key', 'v', { hosts: ['other.example.org'] }); } };") }),
    pass: () => ({ files: plugin(NET, "export default { api: 1, register(host, ctx) { ctx.net.secrets.set('my-key', 'v', { hosts: ['api.example.com'] }); } };") }),
  },
  webassembly: {
    trip: () => ({ files: plugin([], "export default { api: 1, register() { WebAssembly.compile(new Uint8Array()); } };") }),
    pass: () => ({ files: plugin([], OK) }),
  },
  obfuscation: {
    trip: () => ({ files: plugin([], `var _0xa1b2=1,_0xa1b3=2,_0xa1b4=3,_0xa1b5=4,_0xa1b6=5;\n${OK}`) }),
    pass: () => ({ files: plugin([], `var a1=1,a2=2,a3=3,a4=4,a5=5;\n${OK}`) }),
  },
  "minified-code": {
    trip: () => ({ files: plugin([], `${OK}\n${"var a=1;".repeat(600)}`) }),
    pass: () => ({ files: plugin([], `${OK}\n${"var a = 1;\n".repeat(600)}`) }),
  },
  "composition-unchecked": {
    trip: () => ({ files: content({ "object.json": JSON.stringify({ records: [OBJECT] }) }) }),
    pass: () => ({ files: content({ "object.json": JSON.stringify({ records: [OBJECT] }) }), base: true }),
  },
  "composition-refused": {
    trip: () => ({ files: content({ "object.json": JSON.stringify({ removes: ["no-such-object"] }) }), base: true }),
    pass: () => ({ files: content({ "object.json": JSON.stringify({ records: [OBJECT] }) }), base: true }),
  },
  "dangling-reference": {
    trip: () => ({ files: content({ "object.json": JSON.stringify({ records: [{ ...OBJECT, type: "no-such-tval" }] }) }), base: true }),
    pass: () => ({ files: content({ "object.json": JSON.stringify({ records: [OBJECT] }) }), base: true }),
  },
  "history-chart": {
    trip: () => ({ files: content({ "history.json": JSON.stringify({ records: [{ chart: { chart: 900, next: 901, roll: 100 }, phrase: ["You were born. "] }] }) }), base: true }),
    pass: () => ({ files: content({ "history.json": JSON.stringify({ records: [{ chart: { chart: 900, next: 0, roll: 100 }, phrase: ["You were born. "] }] }) }), base: true }),
  },
  "record-check": {
    trip: () => ({ files: content({ "nonsense.json": JSON.stringify({ records: [{ name: "x" }] }) }), base: true }),
    pass: () => ({ files: content({ "object.json": JSON.stringify({ records: [OBJECT] }) }), base: true }),
  },
};

describe("every rule has a mod that trips it and one that does not", () => {
  it("covers every rule in the table", () => {
    expect(Object.keys(CASES).map((n) => `checks/${n}`).sort()).toEqual(CHECK_RULES.map((r) => r.id).sort());
  });

  for (const [name, c] of Object.entries(CASES)) {
    describe(name, () => {
      it("reports the mod that breaks it", async () => {
        expect(await rulesOf(c.trip())).toContain(`checks/${name}`);
      });
      it("stays quiet on the mod that keeps it", async () => {
        expect(await rulesOf(c.pass())).not.toContain(`checks/${name}`);
      });
    });
  }
});

/* ------------------------------------------------------------------ */
/* The named cases, with their verdicts                                 */
/* ------------------------------------------------------------------ */

async function report(run: Run) {
  return (await runModChecks(
    { files: entriesOf(run.files), ...(run.archives !== undefined ? { archives: run.archives } : {}) },
    { firstParty: run.firstParty === true, ...(run.base === true ? { base: basePacks() } : {}) },
  )).report;
}

describe("the named cases", () => {
  it("requires each new management and storage capability in API 2 code", async () => {
    const cases = [
      ["manage.saves.list", "saves:manage"], ["manage.options.get", "state:options.read"], ["manage.options.set", "options:manage"],
      ["manage.keys.list", "keymap:edit"], ["manage.mods.browse", "mod:install"], ["manage.authoring", "mod:authoring"],
      ["manage.wizard", "debug:wizard"], ["manage.loadForSession", "mod:session"], ["manage.reloadGame", "mod:session"],
      ["store.kv.keys", "store:kv"], ["store.session.keys", "store:session"],
    ] as const;
    for (const [member, capability] of cases) {
      const files = (capabilities: readonly string[]) => ({
        "manifest.json": v2({ api: ">=2.0.0 <3.0.0", runtime: "in-process", capabilities }),
        "plugin.js": `export default { api: ">=2.0.0 <3.0.0", start(mod) { mod.${member}(); } };`,
      });
      const refused = await report({ files: files([]), firstParty: true });
      expect(refused.findings.find((finding) => finding.rule === "checks/undeclared-capability")?.message, member).toContain(capability);
      const granted = await report({ files: files([capability]), firstParty: true });
      expect(granted.findings.some((finding) => finding.rule === "checks/undeclared-capability"), member).toBe(false);
    }
  });
  it("blocks an undeclared capability call and names the capability", async () => {
    const r = await report({ files: plugin([], "export default { api: 1, register(host, ctx) { const { net } = ctx; net.request({ url: 'https://x.example' }); } };") });
    const f = r.findings.find((x) => x.rule === "checks/undeclared-capability");
    expect(f?.severity).toBe("block");
    expect(f?.message).toContain("network:");
    expect(f?.evidence[0]?.file).toBe("plugin.js");
  });

  it("follows the context through helpers, classes and modules", async () => {
    const code = [
      "import { Helper } from './helper.js';",
      "export default { api: 1, register(host, ctx) { new Helper(ctx).go(); } };",
    ].join("\n");
    const helper = "export class Helper { constructor(c) { this.c = c; } go() { this.c.saves.list(); } }";
    const r = await report({ files: plugin([], code, { "helper.js": helper }) });
    expect(r.findings.find((x) => x.rule === "checks/undeclared-capability")?.message).toContain("saves:manage");
  });

  it("says a computed call could not be checked, rather than passing it", async () => {
    const r = await report({ files: plugin([], "export default { api: 1, register(host, ctx) { const k = ctx.pick; ctx[k](); } };") });
    const f = r.findings.find((x) => x.rule === "checks/computed-context-access");
    expect(f?.outcome).toBe("could-not-check");
    expect(r.findings.some((x) => x.outcome === "could-not-check")).toBe(true);
  });

  it("blocks eval and the Function constructor", async () => {
    const r = await report({ files: plugin([], "export default { api: 1, register() { eval('1'); new Function('return 1')(); } };") });
    const f = r.findings.find((x) => x.rule === "checks/dynamic-eval");
    expect(f?.severity).toBe("block");
    expect(f?.message).toContain("eval()");
    expect(f?.message).toContain("new Function()");
  });

  it("blocks a remote import, static or dynamic", async () => {
    const r = await report({ files: plugin([], "export default { api: 1, register() { import('https://cdn.example.com/x.js'); } };") });
    expect(r.findings.find((x) => x.rule === "checks/remote-import")?.severity).toBe("block");
  });

  it("blocks a zip that escapes the mod folder and returns none of its files", async () => {
    const read = await readModArchive("pack.zip", zip([{ name: "plugin.js", data: "x" }, { name: "../../evil.js", data: "x" }]));
    expect(read.findings.map((f) => f.rule)).toContain("checks/archive-path");
    expect(read.entries).toEqual([]);
  });

  it("stops inflating a zip bomb at its declared size", async () => {
    /* Declares 100 bytes and inflates to a megabyte: the ratio looks innocent, so
     * only measuring the output catches it. */
    const read = await readModArchive("pack.zip", zip([{ name: "zeros.bin", data: new Uint8Array(1024 * 1024), deflate: true, size: 100 }]));
    const f = read.findings.find((x) => x.rule === "checks/archive-bomb");
    expect(f?.severity).toBe("block");
    expect(f?.message).toContain("inflates past");
  });

  it("refuses an archive whose entries share bytes", async () => {
    const read = await readModArchive("pack.zip", zip([{ name: "a.bin", data: "aaaa" }, { name: "b.bin", data: "aaaa", sameAs: 0 }]));
    expect(read.findings.map((f) => f.rule)).toContain("checks/archive-bomb");
  });

  it("blocks a budget over 500 ms even though the manifest is refused for it", async () => {
    const r = await report({ files: { "manifest.json": v2({ api: "*", runtime: "in-process", budget: { msPerTurn: 501 } }), "plugin.js": OK } });
    const f = r.findings.find((x) => x.rule === "checks/budget-ceiling");
    expect(f?.severity).toBe("block");
    expect(f?.message).toContain("501");
  });
});

/* ------------------------------------------------------------------ */
/* The report and the install subset                                    */
/* ------------------------------------------------------------------ */

describe("checker regressions", () => {
  it("rejects conflicting ZIP counts and disk fields", async () => {
    for (const field of [4, 6, 8, 10]) {
      const bytes = zip([{ name: "safe.txt", data: "safe" }, { name: "../escape.js", data: "eval('1')" }]);
      new DataView(bytes.buffer).setUint16(bytes.length - 22 + field, 1, true);
      const read = await readModArchive("pack.zip", bytes);
      expect(read.findings.map((f) => f.rule), `field ${field}`).toContain("checks/archive-unreadable");
      expect(read.entries).toEqual([]);
    }
  });

  it("rejects ZIP directories whose counts or boundaries hide entries", async () => {
    for (const change of ["counts", "size", "name", "disk", "comment"]) {
      const bytes = zip([{ name: "safe.txt", data: "safe" }, { name: "../escape.js", data: "x" }]);
      const view = new DataView(bytes.buffer);
      const end = bytes.length - 22;
      const directory = view.getUint32(end + 16, true);
      if (change === "counts") {
        view.setUint16(end + 8, 1, true);
        view.setUint16(end + 10, 1, true);
      } else if (change === "size") view.setUint32(end + 12, 46, true);
      else if (change === "name") view.setUint16(directory + 28, 0xffff, true);
      else if (change === "disk") view.setUint16(directory + 34, 1, true);
      else view.setUint16(end + 20, 1, true);
      const read = await readModArchive("pack.zip", bytes);
      expect(read.findings.map((f) => f.rule), change).toContain("checks/archive-unreadable");
      expect(read.entries).toEqual([]);
    }
  });

  it("recognizes ZIP64 records without sentinel counts", async () => {
    const original = zip([{ name: "safe.txt", data: "safe" }]);
    const bytes = new Uint8Array(original.length + 76);
    const end = original.length - 22;
    bytes.set(original.subarray(0, end));
    const view = new DataView(bytes.buffer);
    view.setUint32(end, 0x06064b50, true);
    view.setUint32(end + 4, 44, true);
    view.setUint32(end + 56, 0x07064b50, true);
    view.setUint32(end + 64, end, true);
    view.setUint32(end + 72, 1, true);
    bytes.set(original.subarray(end), end + 76);
    const read = await readModArchive("pack.zip", bytes);
    expect(read.findings.map((f) => f.rule)).toContain("checks/archive-unmeasured");
    expect(read.entries).toEqual([]);
  });

  it.each(["import './payload.txt';", "export * from './payload.txt';", "import('./payload.txt');"])("checks imported modules with any extension: %s", async (edge) => {
    const result = await runModChecks({ files: entriesOf(plugin([], `${edge}\n${OK}`, { "payload.txt": "import './nested.data';", "nested.data": "eval('1');" })) });
    const f = result.report.findings.find((x) => x.rule === "checks/dynamic-eval");
    expect(f?.severity).toBe("block");
    expect(f?.evidence[0]?.file).toBe("nested.data");
    expect(result.coverage.scripts).toBe(3);
  });

  it.each([
    "eval.call(null, '1');", "eval.apply(null, ['1']);", "eval.bind(null)('1');",
    "Reflect.apply(eval, null, ['1']);", "Reflect.construct(Function, ['return 1']);",
    "(() => {}).constructor('return 1')();", "(async () => {}).constructor('return 1')();", "eval`1`;",
    "const invoke = eval.call; invoke(null, '1');", "setTimeout.call(null, '1', 10);",
    "Reflect.apply(setTimeout, null, ['1', 10]);", "setTimeout.apply(null, ['1', 10]);",
  ])("blocks alternate code invocation: %s", async (call) => {
    const r = await report({ files: plugin([], `export default { api: 1, register() { ${call} } };`) });
    expect(r.findings.find((f) => f.rule === "checks/dynamic-eval")?.severity).toBe("block");
  });

  it("reports unknown computed global calls as unchecked", async () => {
    const r = await report({ files: plugin([], "export default { api: 1, register() { globalThis[['ev', 'al'].join('')]('1'); } };") });
    expect(r.findings.some((f) => f.outcome === "could-not-check")).toBe(true);
  });

  it("reports unsupported function invocation flows as unchecked", async () => {
    const r = await report({ files: plugin([], "export default { api: 1, register() { const f = () => {}; f[Date.now()]('1'); } };") });
    expect(r.findings.some((f) => f.outcome === "could-not-check")).toBe(true);
  });

  it("checks a local module reached through a known computed import", async () => {
    const r = await report({ files: plugin([], "export default { api: 1, register() { const path = './payload.txt'; import(path); } };", { "payload.txt": "eval('1');" }) });
    expect(r.findings.find((f) => f.rule === "checks/dynamic-eval")?.severity).toBe("block");
  });

  it("blocks executable DOM markup sinks", async () => {
    const r = await report({ files: plugin([], "export default { api: 1, register() { const div = document.createElement('div'); div.innerHTML = '<script>eval(1)</script>'; } };") });
    expect(r.findings.find((f) => f.rule === "checks/script-injection")?.severity).toBe("block");
  });

  it("blocks script creation through DOM namespaces", async () => {
    const r = await report({ files: plugin([], "export default { api: 1, register() { const script = document.createElementNS('http://www.w3.org/1999/xhtml', 'script'); script.textContent = 'eval(1)'; document.body.append(script); } };") });
    expect(r.findings.find((f) => f.rule === "checks/script-injection")?.severity).toBe("block");
    expect(await rulesOf({ files: plugin([], "export default { api: 1, register() { document.createElementNS('http://www.w3.org/2000/svg', 'rect'); } };") })).not.toContain("checks/script-injection");
  });

  it("allows consented truth declarations for community in-process mods", async () => {
    expect(await rulesOf({ files: plugin(["state:map.read", "state:map-actual.read"], OK) })).not.toContain("checks/first-party-capability");
    expect(await rulesOf({ files: plugin(["mod:install"], OK) })).toContain("checks/first-party-capability");
    expect(await rulesOf({ files: { "manifest.json": v2({ api: "^2.0.0", runtime: "worker", entry: "main.js", capabilities: ["state:map-actual.read"] }), "main.js": "export default { api: '^2.0.0', start() {} };" } })).toContain("checks/capability-tier");
  });

  it("follows incoming context through arguments and lexical arrows", async () => {
    const r = await report({ files: plugin([], "function f() { (() => arguments[0].saves.list())(); } export default { api: 1, register(host, ctx) { f(ctx); } };") });
    expect(r.findings.find((f) => f.rule === "checks/undeclared-capability")?.message).toContain("saves:manage");
  });

  it.each(["typeof ctx.saves; ctx.saves.list();", "if (ctx.saves) ctx.log('yes'); ctx.saves.list();", "if (!ctx.saves) ctx.saves.list();", "ctx.saves || ctx.saves.list();"])("keeps unguarded capability calls blocking: %s", async (code) => {
    const r = await report({ files: plugin([], `export default { api: 1, register(host, ctx) { ${code} } };`) });
    expect(r.findings.find((f) => f.rule === "checks/undeclared-capability")?.severity).toBe("block");
  });

  it("accumulates archive entry limits across ZIPs including directories", async () => {
    const dirs = (prefix: string): ZipEntry[] => Array.from({ length: 2500 }, (_, i) => ({ name: `${prefix}/${i}/` }));
    const r = await report({ files: { ...plugin([], OK), "a.zip": zip(dirs("a")), "b.zip": zip(dirs("b")) }, archives: ["a.zip", "b.zip"] });
    expect(r.findings.find((f) => f.rule === "checks/archive-size")?.severity).toBe("block");
  });

  it("accumulates archive byte and expanded byte budgets at the limits", async () => {
    const bytes = zip([{ name: "a.txt", data: "text" }]);
    for (const budget of [
      { archiveBytes: ARCHIVE_LIMITS.maxArchiveBytes - bytes.length, entries: 0, totalBytes: 0 },
      { archiveBytes: 0, entries: 0, totalBytes: ARCHIVE_LIMITS.maxTotalBytes - 4 },
    ]) {
      expect((await readModArchive("a.zip", bytes, budget)).findings).toEqual([]);
      const second = await readModArchive("b.zip", bytes, budget);
      expect(second.findings.find((f) => f.rule === "checks/archive-size")?.severity).toBe("block");
      expect(second.entries).toEqual([]);
    }
  });

  it.each(["if (ctx.saves) ctx.saves.list();", "ctx.saves && ctx.saves.list();", "ctx.saves?.list();", "if (typeof ctx.saves !== 'undefined') ctx.saves.list();"])("recognizes a guard controlling the capability use: %s", async (code) => {
    const r = await report({ files: plugin([], `export default { api: 1, register(host, ctx) { ${code} } };`) });
    expect(r.findings.map((f) => f.rule)).not.toContain("checks/undeclared-capability");
    expect(r.findings.map((f) => f.rule)).toContain("checks/capability-feature-test");
  });

  it.each(["^3.0.0", "invalid", ""])("rejects an exported API range the host rejects: %s", async (api) => {
    const r = await report({ files: { "manifest.json": v2({ api: "^2.0.0", runtime: "in-process" }), "plugin.js": `export default { api: ${JSON.stringify(api)}, start() {} };` } });
    expect(r.findings.find((f) => f.rule === "checks/api-mismatch")?.severity).toBe("block");
  });

  it("matches a walk declaration to its registry permission", async () => {
    const code = "export default { api: \"^2.0.0\", policies() { return { walkBlockedByDiggable: { kind: \"walk-blocked-by-diggable\", attempt: \"tunnel\", energy: \"move\", step: false } }; } };";
    for (const granted of [false, true]) {
      const r = await report({ files: {
        "manifest.json": v2({ api: "^2.0.0", runtime: "worker", entry: "plugin.js", capabilities: granted ? ["registry:command"] : [] }),
        "plugin.js": code,
      } });
      expect(r.findings.some((f) => f.rule === "checks/undeclared-capability")).toBe(!granted);
      expect(r.findings.some((f) => f.rule === "checks/plugin-shape")).toBe(false);
    }
    const r = await report({ files: {
      "manifest.json": v2({ api: "^2.0.0", runtime: "worker", entry: "plugin.js", capabilities: ["registry:command"] }),
      "plugin.js": code.replace("step: false", "step: true"),
    } });
    expect(r.findings.find((f) => f.rule === "checks/plugin-shape")?.message).toContain("walkBlockedByDiggable.step is false");
  });
});

describe("the report", () => {
  it("accepts mod-declared tables and inherited artifact base kinds", async () => {
    const { report: r } = await runModChecks({ files: entriesOf(content({
      "tval.json": JSON.stringify({ records: [{ name: "junk" }] }),
      "message_type.json": JSON.stringify({ records: [{ name: "BR_CONF" }] }),
      "artifact.json": JSON.stringify({ records: [
        { name: "New relic", "base-object": { tval: "amulet", sval: "Special Base" } },
        { name: "Wrong type", "base-object": { tval: "junk", sval: "Special Base" } },
        { name: "Typo", "base-object": { tval: "amulet", sval: "Special Baze" } },
      ] }),
    })) }, { base: [basePackFromFiles({
      "manifest.json": { id: "core" },
      "object_base.json": { records: [{ name: { tval: "amulet" } }] },
      "artifact.json": { records: [{ name: "Old relic", "base-object": { tval: "amulet", sval: "Special Base" } }] },
    })] });
    expect(r.findings.filter((f) => f.message.includes("not a record file"))).toEqual([]);
    const dangling = r.findings.filter((f) => f.rule === "checks/dangling-reference");
    expect(dangling).toHaveLength(2);
    expect(dangling.map((f) => f.message).join("\n")).toContain("Wrong type");
    expect(dangling.map((f) => f.message).join("\n")).toContain("Typo");
  });

  it("names the tool, the version and the mod", async () => {
    const { report: r, coverage } = await runModChecks({ files: entriesOf(plugin([], OK)), commit: "abc123" });
    expect(r.source.tool).toBe("neo-angband-mod-checks");
    expect(r.mod).toEqual({ id: "demo", version: "1.0.0", commit: "abc123" });
    expect(coverage.scripts).toBe(1);
    expect(worstSeverity(r.findings)).not.toBe("block");
  });

  it("reports a failed requirement as a finding under its own id", async () => {
    const { report: r } = await runModChecks({ files: entriesOf({ "plugin.js": OK }) });
    const f = r.findings.find((x) => x.rule === "checks/manifest-present");
    expect(f?.severity).toBe("block");
  });

  it("keeps requirement ids and check ids apart", () => {
    const checks = new Set(CHECK_RULES.map((r) => r.id));
    for (const req of MOD_REQUIREMENTS) expect(checks.has(`checks/${req.id}`), req.id).toBe(false);
  });

  it("gives every rule a title and a one-line reason", () => {
    for (const r of CHECK_RULES) {
      expect(r.id).toMatch(/^checks\/[a-z0-9-]+$/u);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.reason).not.toContain("\n");
      expect(checkRule(r.id)).toBe(r);
    }
    expect(() => checkRule("checks/no-such-rule")).toThrow();
  });

  it("documents every rule", () => {
    const md = checksMarkdown();
    for (const r of CHECK_RULES) expect(md).toContain(`\`${r.id}\``);
  });
});

describe("the install subset", () => {
  it("runs only rules marked for install", () => {
    const r = installChecks(entriesOf(plugin([], OK, { "a.txt": "a", "A.txt": "b" })));
    const install = new Set(INSTALL_CHECK_RULES.map((x) => x.id));
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) expect(install.has(f.rule), f.rule).toBe(true);
  });

  it("passes a well-formed mod", () => {
    expect(installChecks(entriesOf(plugin([], OK))).findings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The in-tree sample mods                                              */
/* ------------------------------------------------------------------ */

const REPO = join(import.meta.dirname, "..", "..", "..", "..");

function walk(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, root));
    else out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

function sampleDirs(): string[] {
  const out: string[] = [];
  const look = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      if (readdirSync(full).includes("manifest.json")) out.push(full);
      else look(full);
    }
  };
  look(join(REPO, "samples"));
  return out;
}

describe("the sample mods pass with no block finding", () => {
  const dirs = sampleDirs();
  it("finds the samples", () => {
    expect(dirs.length).toBeGreaterThan(5);
  });
  for (const dir of dirs) {
    it(relative(REPO, dir).split(sep).join("/"), async () => {
      const files = walk(dir).filter(isPayloadPath).map((p) => [p, new Uint8Array(readFileSync(join(dir, p)))] as const);
      const { report: r } = await runModChecks({ files }, { base: basePacks() });
      const blocks = r.findings.filter((f) => f.severity === "block");
      expect(blocks.map((f) => `${f.rule}: ${f.message}`)).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------ */
/* The parser stays out of the main entry                               */
/* ------------------------------------------------------------------ */

describe("the main entry", () => {
  it("reaches no module that imports the parser", () => {
    /* The game hands the main entry to plugins as ctx.authoring and bundles all of
     * it, so a parser reachable from here would ship in the game. */
    const SRC = join(import.meta.dirname, "..");
    const seen = new Set<string>();
    const parsers: string[] = [];
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/^\s*(?:import|export)\s(?!type\b)[^;]*?from\s+"([^"]+)"/gmu)) {
        const spec = m[1] as string;
        if (spec === "acorn") parsers.push(relative(SRC, file));
        else if (spec.startsWith(".")) visit(join(file, "..", spec.replace(/\.js$/u, ".ts")));
      }
    };
    visit(join(SRC, "index.ts"));
    expect(seen.size).toBeGreaterThan(20);
    expect(parsers).toEqual([]);
  });
});
