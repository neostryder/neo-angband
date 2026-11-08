import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CapabilitySet, type Api2ModDefinition, type ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import { createApi2Host } from "../mod-api2-host";
import { modPluginContext } from "../mod-context";
import { setModGrants, resetModTiers } from "../mod-tier";
import { installModWorkerBootstrap, type WorkerScope } from "./bootstrap";
import { startModWorker, type ModWorkerLike, type StartedModWorker } from "./host";
import { MOD_WORKER_PROTOCOL_VERSION, type HostToModWorker } from "./protocol";
import { createBackupFolder } from "../mod-backup";
import * as bindings from "../mod-consent-binding";
import * as snapshots from "../mod-code-snapshot";
import * as store from "../mod-store";
import { notifyBackupSinks, clearBackupSinks } from "../mod-backup";
import { modPanelsSuspended } from "../panel-runtime";

type WorkerBackupFile = { readonly id: string; readonly name: string; readonly size: number };
type WorkerBackupFolder = Omit<NonNullable<ModApi2["backupFolder"]>, "onSave"> & {
  onSave(listener: (file: WorkerBackupFile) => void): Promise<unknown>;
  writeSaved(id: string): Promise<unknown>;
};

const [{ createBackupRelay }, { createDesktopAuthority }] = await Promise.all([
  "../../../desktop/src/backup-folder.ts", "../../../desktop/src/net-relay.ts",
].map((modulePath) => import(modulePath)));

let base: string;
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), "neo-worker-backup-")); });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

describe("Worker desktop backups", () => {
  const sessions: StartedModWorker[] = [];
  async function flush() { for (let i = 0; i < 60; i += 1) await Promise.resolve(); }
  afterEach(() => {
    for (const session of sessions.splice(0)) session.teardown();
    clearBackupSinks();
    store.setSessionConsents({}); bindings.setConsentBindings(new Map()); resetModTiers();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  });
  async function fixture(grants = ["backup:folder"], confirmWrite: (entry: { modId: string }, name: string, folder: string, owner: number) => Promise<boolean> = async () => true, choose: () => Promise<string | null> = async () => base) {
    const authority = createDesktopAuthority();
    const relay = createBackupRelay({ authority, userBase: path.join(base, "records"), choose,
      confirmReplace: async () => true, confirmRead: async () => false, confirmWrite });
    const native = vi.fn((op: string, arg: unknown) => relay.handle(op, arg, 1));
    const consent = vi.fn((arg: unknown) => authority.report(arg, 1, async () => true));
    vi.stubGlobal("neoDesktop", { consent, backup: native });
    vi.spyOn(snapshots, "modPayloadDigest").mockReturnValue("a".repeat(64));
    bindings.setConsentBindings(new Map([["probe", "binding"]])); store.setModStorage(null); store.setSessionConsents({ probe: grants });
    const authorize = (caps: string[]) => setModGrants(new Map([["probe", { granted: caps, refusedByPlayer: [], refusedByTier: [], undecided: [], blocking: [] }]]));
    authorize(grants);
    const caps = CapabilitySet.fromManifest({ id: "probe", name: "Probe", version: "1", shape: "plugin", capabilities: grants });
    let api!: ModApi2;
    const sent: HostToModWorker[] = [];
    const definition: Api2ModDefinition = { api: "^2.0.0", start: (proxy) => { api = proxy; }, migrateBag: (() => new Promise(() => {})) as unknown as NonNullable<Api2ModDefinition["migrateBag"]> };
    const worker: ModWorkerLike = { onmessage: null, onerror: null, terminate() {}, postMessage(message) {
      sent.push(structuredClone(message)); queueMicrotask(() => scope.onmessage?.({ data: structuredClone(message) } as MessageEvent<HostToModWorker>));
    } };
    const scope: WorkerScope = { onmessage: null, postMessage(message) { queueMicrotask(() => worker.onmessage?.({ data: structuredClone(message) } as MessageEvent)); } };
    installModWorkerBootstrap(scope, MOD_WORKER_PROTOCOL_VERSION, async () => ({ default: definition }));
    const ctx = { ...modPluginContext("probe", {}), backupFolder: createBackupFolder("probe")! };
    const session = startModWorker(worker, { id: "probe", entryUrl: "staged:entry", grants, flags: {}, newCharacter: false, engine: "1", net: false,
      api: () => createApi2Host(ctx, { execution: "worker", grants: caps }), timing: { heartbeatMs: 60000, askMs: 10 } });
    sessions.push(session); await flush(); await session.ready; session.start(); await flush();
    let requestId = 100;
    const raw = async (method: string, args: unknown[] = [], extra: Record<string, unknown> = {}) => {
      const id = ++requestId;
      worker.onmessage?.({ data: { type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: 1, requestId: id, method, args, ...extra } } as MessageEvent);
      await flush(); return sent.find((message) => message.type === "reply" && message.requestId === id);
    };
    return { api, session, sent, raw, native, consent, relay, authority, authorize, ctx };
  }

  it("writes only after native confirmation and lists metadata without returning paths or file text", async () => {
    const confirm = vi.fn(async (_entry: { modId: string }, _name: string, _folder: string, _owner: number) => {
      expect(modPanelsSuspended()).toBe(true);
      return true;
    });
    const f = await fixture(["backup:folder"], confirm);
    expect(await f.api.backupFolder!.choose()).toEqual({ ok: true, value: path.basename(base) });
    const text = "<script>bad()</script><img src=x onerror=bad()>";
    expect(await f.api.backupFolder!.write("hostile.neochar", text)).toEqual({ ok: true, value: true });
    expect(modPanelsSuspended()).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ modId: "probe" }), "hostile.neochar", expect.any(String), 1);
    const folder = confirm.mock.calls[0]![2] as string;
    expect(path.dirname(folder)).toBe(base); expect(fs.readFileSync(path.join(folder, "hostile.neochar"), "utf8")).toBe(text);
    expect(await f.api.backupFolder!.list()).toEqual({ ok: true, value: [{ name: "hostile.neochar", characterName: "", level: 0 }] });
    expect(JSON.stringify(f.sent)).not.toContain(folder);
    expect(f.native.mock.calls.map(([op]) => op)).toEqual(["prepareChoose", "commit", "prepareWrite", "commit", "list"]);
  });

  it("refuses an ungranted Worker and a browser-only host without a native call", async () => {
    const f = await fixture([]);
    expect(await f.raw("backupFolder.choose")).toMatchObject({ result: { ok: false, reason: "not-granted" } });
    expect(f.native).not.toHaveBeenCalled();
    const granted = await fixture(); vi.stubGlobal("neoDesktop", undefined);
    expect(await granted.raw("backupFolder.choose")).toMatchObject({ result: { ok: false } }); expect(granted.native).not.toHaveBeenCalled();
  });

  it("rejects wrong identities, stale epochs, malformed arguments, paths, and oversized requests before desktop access", async () => {
    const f = await fixture();
    expect(await f.raw("backupFolder.choose", [], { pluginId: "victim" })).toBeUndefined();
    expect(await f.raw("backupFolder.choose", [], { epoch: 0 })).toMatchObject({ ok: false });
    for (const args of [["../escape.neochar", "bad"], ["C:/escape.neochar", "bad"], ["folder/escape.neochar", "bad"], ["ok.neochar", "x".repeat(32769)], ["ok.neochar", "x".repeat(65536)], ["ok.neochar", 1], ["ok.neochar", "bad", { folder: "C:/", purpose: "victim" }]]) {
      expect(await f.raw("backupFolder.write", args)).toMatchObject({ type: "reply" });
    }
    for (const method of ["backupFolder.choose", "backupFolder.forget", "backupFolder.list", "backupFolder.name"]) {
      expect(await f.raw(method, [{ folder: "C:/", installation: "victim" }])).toMatchObject({ result: { ok: false } });
    }
    expect(await f.raw("backupFolder.commit", ["forged-ticket"])).toMatchObject({ ok: false });
    expect(f.native).not.toHaveBeenCalled(); expect(fs.readdirSync(base)).toEqual([]);
  });

  it.each(["grant", "binding", "session", "epoch"])("drops a write after a %s change during native confirmation without writing", async (change) => {
    let resolve!: (value: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    const f = await fixture(["backup:folder"], confirm);
    await f.api.backupFolder!.choose();
    const write = f.api.backupFolder!.write("blocked.neochar", "bad"); await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    if (change === "grant") f.authorize([]);
    else if (change === "binding") bindings.setConsentBindings(new Map([["probe", "changed"]]));
    else if (change === "session") Object.defineProperty(f.ctx, "state", { value: {}, configurable: true });
    else {
      vi.useFakeTimers(); const migration = f.session.migrateBag({}, 0); const rejected = expect(migration).rejects.toThrow("within");
      await flush(); await vi.advanceTimersByTimeAsync(11); await rejected;
    }
    resolve(true); await flush();
    expect(f.native.mock.calls.filter(([op]) => op === "commit")).toHaveLength(1);
    const writes = f.native.mock.calls.find(([op]) => op === "prepareWrite")![1] as Record<string, unknown>;
    const committed = f.native.mock.calls.find(([op]) => op === "commit")![1] as Record<string, unknown>;
    const keys = fs.readdirSync(base).filter((name) => name !== "records");
    expect(keys).toHaveLength(1); expect(fs.existsSync(path.join(base, keys[0]!, "blocked.neochar"))).toBe(false);
    expect(writes["modId"]).toBe("probe"); expect(committed["installation"]).toBe(writes["installation"]);
    if (change !== "epoch") expect(f.sent.filter((message) => message.type === "reply" && message.ok && JSON.stringify(message.result).includes("blocked.neochar"))).toEqual([]);
    // Teardown must be able to reject a revoked call whose reply was dropped.
    void write.catch(() => undefined);
  });

  it("bounds concurrent and repeated backup requests without sending excess work to desktop", async () => {
    let resolve!: (value: string | null) => void;
    const f = await fixture(["backup:folder"], vi.fn(async () => true), () => new Promise((done) => { resolve = done; }));
    const first = f.api.backupFolder!.choose(); await flush();
    expect(await f.api.backupFolder!.choose()).toMatchObject({ ok: false, code: "quota" });
    resolve(null); await first;
    for (let i = 0; i < 15; i += 1) await f.api.backupFolder!.name();
    const before = f.native.mock.calls.length;
    expect(await f.api.backupFolder!.name()).toMatchObject({ ok: false, code: "quota" }); expect(f.native).toHaveBeenCalledTimes(before);
  });

  it("bounds backup notifications and stops delivery after revocation", async () => {
    const f = await fixture();
    const listener = vi.fn();
    expect(await f.api.backupFolder!.onSave(listener)).toMatchObject({ ok: true });
    for (let i = 0; i < 6; i += 1) notifyBackupSinks(() => ({ name: "large.neochar", text: "x".repeat(3 * 1024 * 1024) }));
    await flush(); expect(listener).toHaveBeenCalledTimes(6);
    expect(listener.mock.calls[0]![0]).toEqual({ id: expect.any(String), name: "large.neochar", size: 3 * 1024 * 1024 });
    notifyBackupSinks(() => ({ name: "oversized.neochar", text: "x".repeat(8 * 1024 * 1024 + 1) })); await flush(); expect(listener).toHaveBeenCalledTimes(6);
    f.authorize([]); notifyBackupSinks(() => ({ name: "revoked.neochar", text: "private" })); await flush(); expect(listener).toHaveBeenCalledTimes(6);
  });

  it("writes a large host-retained backup by opaque id without uploading or changing its bytes", async () => {
    const confirm = vi.fn(async () => true);
    const f = await fixture(["backup:folder"], confirm);
    await f.api.backupFolder!.choose();
    let saved!: WorkerBackupFile;
    const folder = f.api.backupFolder as unknown as WorkerBackupFolder;
    await folder.onSave((file) => { saved = file; });
    const text = "x".repeat(128 * 1024);
    notifyBackupSinks(() => ({ name: "large.neochar", text })); await flush();
    expect(saved).toEqual({ id: expect.any(String), name: "large.neochar", size: text.length });
    expect(JSON.stringify(f.sent)).not.toContain(text);
    expect(await folder.writeSaved(saved.id!)).toEqual({ ok: true, value: true });
    const allocations = fs.readdirSync(base).filter((name) => name !== "records");
    expect(fs.readFileSync(path.join(base, allocations[0]!, "large.neochar"), "utf8")).toBe(text);
    expect(confirm).toHaveBeenCalledTimes(1);
    const before = f.native.mock.calls.length;
    for (const args of [[crypto.randomUUID()], [saved.id, "forged.neochar"], [{ id: saved.id, path: "C:/" }], ["x".repeat(65536)]]) {
      expect(await f.raw("backupFolder.writeSaved", args)).toMatchObject({ type: "reply" });
    }
    expect(await f.raw("backupFolder.writeSaved", [saved.id], { pluginId: "victim" })).toBeUndefined();
    expect(await f.raw("backupFolder.writeSaved", [saved.id], { epoch: 0 })).toMatchObject({ ok: false });
    expect(f.native).toHaveBeenCalledTimes(before);
    const oldId = saved.id;
    notifyBackupSinks(() => ({ name: "new.neochar", text: "new" })); await flush();
    expect(await folder.writeSaved(oldId!)).toMatchObject({ ok: false, code: "bad-file" });
    expect(f.native).toHaveBeenCalledTimes(before);
  });

  it("drops a retained backup replaced while native confirmation is pending", async () => {
    let resolve!: (value: boolean) => void;
    const f = await fixture(["backup:folder"], () => new Promise((done) => { resolve = done; }));
    await f.api.backupFolder!.choose();
    let saved!: WorkerBackupFile;
    const folder = f.api.backupFolder as unknown as WorkerBackupFolder;
    await folder.onSave((file) => { saved = file; });
    notifyBackupSinks(() => ({ name: "old.neochar", text: "old" })); await flush();
    const pending = folder.writeSaved(saved.id!); await flush();
    notifyBackupSinks(() => ({ name: "new.neochar", text: "new" })); await flush();
    resolve(true); expect(await pending).toMatchObject({ ok: false, code: "cancelled" });
    expect(f.native.mock.calls.filter(([op]) => op === "commit")).toHaveLength(1);
    const allocations = fs.readdirSync(base).filter((name) => name !== "records");
    expect(fs.readdirSync(path.join(base, allocations[0]!))).toEqual([]);
  });
});
