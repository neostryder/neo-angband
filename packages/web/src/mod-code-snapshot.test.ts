import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOD_PERMISSION_TEXT, modStateFormat, parseDocument, validateManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { NO_DISK_PACKS, type DiskPackReport } from "./disk-packs";
import { loadModCode, measureModTiers } from "./mod-code";
import { consentBinding, onModConsentChange, setConsentBindings } from "./mod-consent-binding";
import { modPayloadBytes, modPayloadDigest, modPayloadUrl, prepareModPayloads, readModPayload } from "./mod-code-snapshot";
import { ModStore, MOD_STATE_STORAGE_KEY, setSessionConsents } from "./mod-store";
import { assignTier } from "./mod-tier";
import { labInProcess } from "./lab-trust";

const producer = JSON.parse(readFileSync(new URL("../test-fixtures/mod-runner/worker/manifest.json", import.meta.url), "utf8"));
const source = readFileSync(new URL("../test-fixtures/mod-runner/worker/worker.js", import.meta.url), "utf8");
const caps = ["input:controller", "input:intent", "state:interaction.read"];
const tier = assignTier({ id: "probe", source: "folder", execution: "worker" });
const encode = (text: string) => new TextEncoder().encode(text);

function fixture(grants = caps) {
  const raw = { ...producer, data: { ...producer.data, id: "probe", name: "Permission Probe", capabilities: grants } };
  const files = new Map([["manifest.json", encode(JSON.stringify(raw))], ["worker.js", encode(source)], ["nested/data.json", encode("{}")]]);
  const report: DiskPackReport = { ...NO_DISK_PACKS, available: true, kind: "picked", assetUrl: async (_id, path) => files.has(path) ? path : null,
    packs: [{ manifest: validateManifest(raw, { code: ["worker.js"] }), files: {}, code: ["worker.js"], assets: ["nested/data.json"] }] };
  const values = new Map<string, string>();
  const store = new ModStore({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } });
  const prepare = () => prepareModPayloads(report, () => tier, async (path) => files.get(path)!, webcrypto.subtle as SubtleCrypto);
  const approve = () => { store.setDecisions("probe", { granted: grants, refused: [], ...(typeof consentBinding("probe") === "string" ? { binding: consentBinding("probe") as string } : {}) }, "1.0.0"); store.markUnreviewedNotice("probe", "1.0.0"); };
  return { raw, report, files, values, store, prepare, approve };
}

afterEach(() => { setConsentBindings(new Map()); setSessionConsents({}); });

describe("content-bound permission decisions", () => {
  it("requires a new decision when identical bytes change execution tier", async () => {
    const f = fixture(); await f.prepare(); f.approve();
    const digest = modPayloadDigest("probe"); const binding = consentBinding("probe");
    await prepareModPayloads(f.report, () => ({ ...tier, execution: "in-process", developerInProcess: true }), async (path) => f.files.get(path)!, webcrypto.subtle as SubtleCrypto);
    expect(modPayloadDigest("probe")).toBe(digest);
    expect(consentBinding("probe")).not.toBe(binding);
    expect(f.store.getConsent("probe")).toEqual([]);
    expect(f.store.sawUnreviewedNotice("probe")).toBe(false);
  });

  it("does not reuse an asset URL to bypass module graph validation", async () => {
    const f = fixture(); f.files.set("worker.js", encode('import "./missing.js";'));
    await f.prepare();
    const asset = await modPayloadUrl("probe", "worker.js");
    expect(asset).toMatch(/^blob:/);
    await expect(modPayloadUrl("probe", "worker.js", true)).rejects.toThrow();
    expect(await modPayloadUrl("probe", "worker.js")).toBe(asset);
  });

  it("skips disabled packs at boot and measures them for management consent", async () => {
    const f = fixture(); const read = vi.fn(async (path: string) => f.files.get(path)!);
    await prepareModPayloads(f.report, () => tier, read, webcrypto.subtle as SubtleCrypto, () => false);
    expect(read).not.toHaveBeenCalled();
    expect(consentBinding("probe")).toBeNull();
    await prepareModPayloads(f.report, () => tier, read, webcrypto.subtle as SubtleCrypto);
    expect(typeof consentBinding("probe")).toBe("string");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("bounds concurrency and refuses stalled packs at the global deadline", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); const signals: AbortSignal[] = [];
      const pack = { ...f.report.packs[0]!, assets: Array.from({ length: 20 }, (_, index) => `asset${index}`) };
      const read = vi.fn((_path: string, _limit: number, signal?: AbortSignal) => {
        signals.push(signal!); return new Promise<Uint8Array>(() => undefined);
      });
      const pending = prepareModPayloads({ ...f.report, packs: [pack], assetUrl: async (_id, path) => path }, () => tier, read, webcrypto.subtle as SubtleCrypto);
      await vi.advanceTimersByTimeAsync(1);
      expect(read).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(15000);
      await pending;
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(consentBinding("probe")).toBeNull();
      expect(modPayloadDigest("probe")).toBeNull();
      expect(read).toHaveBeenCalledTimes(4);
    } finally { vi.useRealTimers(); }
  });

  it("refuses packs that exceed the aggregate byte budget", async () => {
    const f = fixture(); const large = new Uint8Array(45 * 1024 * 1024);
    const packs = ["one", "two", "three"].map((id) => ({ ...f.report.packs[0]!, manifest: { ...f.report.packs[0]!.manifest, id } }));
    const read = async (url: string) => {
      const [id, ...parts] = url.split("/"); const path = parts.join("/");
      return path === "manifest.json" ? encode(JSON.stringify({ ...f.raw, data: { ...f.raw.data, id } })) : path === "nested/data.json" ? large : f.files.get(path)!;
    };
    const subtle = { digest: async () => new ArrayBuffer(32) } as unknown as SubtleCrypto;
    await prepareModPayloads({ ...f.report, packs, assetUrl: async (id, path) => `${id}/${path}` }, () => tier, read, subtle);
    expect(typeof consentBinding("one")).toBe("string");
    expect(typeof consentBinding("two")).toBe("string");
    expect(consentBinding("three")).toBeNull();
    expect(modPayloadDigest("three")).toBeNull();
  });
  it("rejects old unbound approvals and stores the new binding in the shared envelope", async () => {
    const f = fixture();
    f.store.setConsent("probe", caps);
    await f.prepare();
    expect(f.store.getConsent("probe")).toEqual([]);
    expect(f.store.sawUnreviewedNotice("probe")).toBe(false);
    f.approve();
    expect(f.store.getConsent("probe")).toEqual(caps);
    const parsed = parseDocument(f.values.get(MOD_STATE_STORAGE_KEY)!, modStateFormat);
    expect(parsed.ok && parsed.data.consentBindings?.probe).toBe(consentBinding("probe"));
    expect(f.store.sawUnreviewedNotice("probe")).toBe(true);
  });

  it.each(["worker.js", "nested/data.json"])("requires new approval when %s changes at the same version", async (file) => {
    const f = fixture();
    await f.prepare(); f.approve();
    const digest = modPayloadDigest("probe");
    const before = modPayloadBytes("probe", file);
    f.files.set(file, encode("changed"));
    expect(modPayloadBytes("probe", file)).toEqual(before);
    const stopped = vi.fn(); const off = onModConsentChange(stopped);
    try {
      await f.prepare();
      expect(modPayloadDigest("probe")).not.toBe(digest);
      expect(stopped).toHaveBeenCalledWith("probe");
      expect(f.store.getConsent("probe")).toEqual([]);
      expect(f.store.sawUnreviewedNotice("probe")).toBe(false);
      f.approve(); expect(f.store.getConsent("probe")).toEqual(caps);
    } finally { off(); }
  });

  it("requires approval for a changed grant set and rejects a changing manifest snapshot", async () => {
    const f = fixture(); await f.prepare(); f.approve();
    const next = fixture([...caps, "input:observe"]);
    for (const [key, value] of f.values) next.values.set(key, value);
    await next.prepare();
    expect(next.store.getConsent("probe")).toEqual([]);
    next.files.set("manifest.json", encode("{}"));
    await next.prepare();
    expect(consentBinding("probe")).toBeNull();
    expect(modPayloadDigest("probe")).toBeNull();
  });

  it("revokes a staged grant and keeps the revocation across another read", async () => {
    const f = fixture(); await f.prepare();
    setSessionConsents({ probe: caps }, {}, { probe: true });
    expect(f.store.getConsent("probe")).toEqual(caps);
    const stopped = vi.fn(); const off = onModConsentChange(stopped);
    f.store.setDecisions("probe", { granted: [], refused: caps }, "1.0.0");
    expect(stopped).toHaveBeenCalledWith("probe"); off();
    expect(f.store.getConsent("probe")).toEqual([]);
    expect(f.store.getRefusal("probe")).toEqual(caps);
    setSessionConsents({ probe: caps }, {}, { probe: true });
    expect(f.store.getConsent("probe")).toEqual([]);
    f.store.clearConsent("probe");
    expect(f.store.sawUnreviewedNotice("probe")).toBe(false);
  });

  it("does not transfer permission decisions when restoring a different payload", async () => {
    const f = fixture(); await f.prepare(); f.approve();
    const saved = f.store.captureConfiguration(["probe"]);
    f.files.set("worker.js", encode("export default {}"));
    await f.prepare(); f.approve();
    expect(f.store.restoreConfiguration(saved)).toBe(true);
    expect(f.store.getConsent("probe")).toEqual([]);
  });

  it("does not rebind old grants when permission storage fails", async () => {
    const f = fixture(); await f.prepare(); f.approve();
    const previous = f.values.get(MOD_STATE_STORAGE_KEY);
    f.files.set("worker.js", encode("changed"));
    await f.prepare();
    let fail = true;
    const store = new ModStore({ getItem: (key) => f.values.get(key) ?? null, setItem: (key, value) => {
      if (fail) { fail = false; throw new Error("Storage is full"); }
      f.values.set(key, value);
    }, removeItem: (key) => { f.values.delete(key); } });
    expect(() => store.setDecisions("probe", { granted: caps, refused: [], binding: consentBinding("probe")! }, "1.0.0")).toThrow(MOD_PERMISSION_TEXT.storageFailed);
    expect(f.values.get(MOD_STATE_STORAGE_KEY)).toBe(previous);
    expect(store.getConsent("probe")).toEqual([]);
    fail = true;
    expect(() => store.markUnreviewedNotice("probe", "1.0.0")).toThrow(MOD_PERMISSION_TEXT.storageFailed);
    expect(f.values.get(MOD_STATE_STORAGE_KEY)).toBe(previous);
    expect(store.sawUnreviewedNotice("probe")).toBe(false);
    store.markUnreviewedNotice("probe", "1.0.0");
    expect(store.getConsent("probe")).toEqual([]);
    expect(store.sawUnreviewedNotice("probe")).toBe(true);
  });

  it("keeps verified first-party consent unchanged", async () => {
    const f = fixture(); f.store.setConsent("probe", caps);
    await prepareModPayloads(f.report, () => ({ ...tier, trust: "first-party" }));
    expect(f.store.getConsent("probe")).toEqual(caps);
    expect(consentBinding("probe")).toBeUndefined();
  });
});

describe("execution policy", () => {
  it("stages an in-process API 2 producer without evaluating it on the host", async () => {
    const f = fixture();
    const manifest = { ...f.raw, data: { ...f.raw.data, runtime: "in-process", entry: "plugin.js" } };
    const pack = { ...f.report.packs[0]!, manifest: validateManifest(manifest, { code: ["plugin.js"] }), code: ["plugin.js"] };
    const importer = vi.fn();
    setConsentBindings(new Map([[pack.manifest.id, "bound"]]));
    const loaded = await loadModCode({ packs: [pack], codeUrl: async () => "staged:entry", enabled: () => true, consented: () => caps, acknowledged: () => true, importer });
    expect(importer).not.toHaveBeenCalled();
    expect(loaded.workers).toHaveLength(1);
    expect(loaded.plugins).toEqual([]);
  });

  it("refuses public code whose bytes were never measured", async () => {
    const f = fixture();
    const manifest = { ...f.raw, data: { ...f.raw.data, runtime: "in-process", entry: "plugin.js" } };
    const pack = { ...f.report.packs[0]!, manifest: validateManifest(manifest, { code: ["plugin.js"] }), code: ["plugin.js"] };
    const importer = vi.fn();
    setConsentBindings(new Map());
    const loaded = await loadModCode({ packs: [pack], codeUrl: async () => "staged:entry", enabled: () => true, consented: () => caps, acknowledged: () => true, importer });
    expect(importer).not.toHaveBeenCalled();
    expect(loaded.workers).toEqual([]);
    expect(loaded.plugins).toEqual([]);
    expect(loaded.problems.map((problem) => problem.why)).toEqual([MOD_PERMISSION_TEXT.unavailable]);
  });

  it("refuses API 1 before importing code, including a legacy controller", async () => {
    const f = fixture();
    const pack = { ...f.report.packs[0]!, manifest: validateManifest({ id: "probe", name: "Legacy Probe", version: "1.0.0", shape: "plugin", modApi: 1, capabilities: caps }), code: ["plugin.js"] };
    const importer = vi.fn();
    setConsentBindings(new Map([["probe", "bound"]]));
    const loaded = await loadModCode({ packs: [pack], codeUrl: async () => "unused", enabled: () => true, consented: () => caps, acknowledged: () => true, importer });
    expect(importer).not.toHaveBeenCalled(); expect(loaded.plugins).toEqual([]); expect(loaded.skipped).toHaveLength(1);
  });

  it("allows the developer opt-in only for named folders in lab builds", async () => {
    expect([...labInProcess("?labprocess=probe", false)]).toEqual([]);
    const f = fixture();
    const measured = await measureModTiers(f.report.packs, { folder: new Set(["probe"]), session: new Set() }, [], async () => false, new Set(), labInProcess("?labprocess=probe", true));
    expect(measured.get("probe")?.trust).toBe("sideloaded");
    expect(measured.get("probe")?.developerInProcess).toBe(true);
    const session = await measureModTiers(f.report.packs, { folder: new Set(), session: new Set(["probe"]) }, [], async () => false, new Set(), new Set(["probe"]));
    expect(session.get("probe")?.developerInProcess).toBeUndefined();
  });
});

it("cancels a payload stream before it exceeds the byte limit", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel });
  await expect(readModPayload("https://example.invalid/asset", 4, async () => new Response(stream))).rejects.toThrow();
  expect(cancel).toHaveBeenCalledTimes(1);
});
