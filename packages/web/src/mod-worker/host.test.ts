import { describe, expect, it, vi } from "vitest";
import { startModWorker, type ModWorkerLike } from "./host";
import { MOD_WORKER_PROTOCOL_VERSION, type HostReply, type HostToModWorker } from "./protocol";

class FakeWorker implements ModWorkerLike {
  readonly sent: Array<HostToModWorker | HostReply> = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(message: HostToModWorker | HostReply): void { this.sent.push(message); }
  terminate(): void { this.terminated = true; }
  receive(message: unknown): void { this.onmessage?.({ data: message } as MessageEvent<unknown>); }
}

function ready(worker: FakeWorker): void {
  worker.receive({ type: "ready", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "worker", hasMigrateBag: true });
}

describe("API-2 Worker host broker", () => {
  it("posts only an immutable data init snapshot and brokers capability-checked requests", async () => {
    const worker = new FakeWorker();
    const prefs = { get: vi.fn(() => ({ theme: "dark" })), set: vi.fn() };
    const command = vi.fn(async () => ({ repainted: true }));
    const host = startModWorker(worker, {
      id: "worker",
      capabilities: ["prefs:read", "prefs:write", "asset:read", "command:submit"],
      entryUrl: "mem://worker/worker.js",
      snapshot: { id: "worker", modApi: 2, protocolVersion: MOD_WORKER_PROTOCOL_VERSION, engineVersion: "1.4.0", modVersion: "1.0.0", flags: { enabled: true }, data: { own: [1] }, capabilities: [], newCharacter: false },
      prefs,
      readAsset: async () => new Uint8Array([1, 2]),
      onCommand: command,
    });
    expect(worker.sent[0]).toMatchObject({ type: "init", entryUrl: "mem://worker/worker.js", snapshot: { id: "worker", modApi: 2 } });
    ready(worker);
    await host.ready;
    worker.receive({ type: "prefs.get", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "worker", requestId: 1 });
    await vi.waitFor(() => expect(prefs.get).toHaveBeenCalledOnce());
    expect(worker.sent.at(-1)).toMatchObject({ type: "reply", requestId: 1, ok: true, value: { theme: "dark" } });
    worker.receive({ type: "asset.read", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "worker", requestId: 2, path: "../secret" });
    await vi.waitFor(() => expect(worker.sent.at(-1)).toMatchObject({ type: "reply", requestId: 2, ok: false }));
    worker.receive({ type: "command.submit", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "worker", requestId: 3, code: "display.repaint", args: {} });
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith("display.repaint", {}));
  });

  it("refuses lookalike records and foreign ids while allowing boot-time requests", async () => {
    const worker = new FakeWorker();
    const problems: string[] = [];
    startModWorker(worker, {
      id: "worker",
      capabilities: ["prefs:read"],
      entryUrl: "mem://worker/worker.js",
      snapshot: { id: "worker", modApi: 2, protocolVersion: MOD_WORKER_PROTOCOL_VERSION, engineVersion: "1.4.0", modVersion: "1.0.0", flags: {}, data: {}, capabilities: [], newCharacter: false },
      prefs: { get: () => null, set: () => undefined },
      readAsset: async () => null,
      onProblem: (problem) => problems.push(problem),
    });
    worker.receive({ type: "prefs.get", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "other", requestId: 1 });
    worker.receive(Object.assign(Object.create({ hidden: true }), { type: "ready", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "worker", hasMigrateBag: false }));
    worker.receive({ type: "prefs.get", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "worker", requestId: 2 });
    await vi.waitFor(() => expect(worker.sent.at(-1)).toMatchObject({ type: "reply", requestId: 2, ok: true }));
    expect(problems.join(" ")).toContain("wrong protocol version or plugin id");
    expect(problems.join(" ")).toContain("Object.prototype");
  });

  it("assigns subscriptions, publishes only to them, and validates declarative panels", async () => {
    const worker = new FakeWorker();
    const subscribed: Array<[string, string]> = [];
    const ui = vi.fn(async () => ({ panelId: "status" }));
    const host = startModWorker(worker, {
      id: "worker", capabilities: ["state:model.read", "ui:panel"], entryUrl: "mem://worker/worker.js",
      snapshot: { id: "worker", modApi: 2, protocolVersion: MOD_WORKER_PROTOCOL_VERSION, engineVersion: "1.4.0", modVersion: "1.0.0", flags: {}, data: {}, capabilities: [], newCharacter: false },
      prefs: { get: () => null, set: () => undefined }, readAsset: async () => null,
      onSubscribe: (id, topic) => subscribed.push([id, topic]), onUi: ui,
    });
    worker.receive({ type: "event.subscribe", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "worker", requestId: 1, topic: "state.snapshot" });
    await vi.waitFor(() => expect(subscribed).toHaveLength(1));
    const subscriptionId = subscribed[0]![0];
    ready(worker);
    await host.ready;
    host.publishModel(subscriptionId, { turn: 3 });
    expect(worker.sent.at(-1)).toMatchObject({ type: "event.model", subscriptionId, model: { turn: 3 } });
    worker.receive({ type: "ui.mount", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "worker", requestId: 2, panel: { id: "status", root: { type: "column", children: [{ type: "text", text: "Ready" }] } } });
    await vi.waitFor(() => expect(ui).toHaveBeenCalledWith("mount", expect.anything(), undefined));
    worker.receive({ type: "ui.mount", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "worker", requestId: 3, panel: { id: "status", root: { type: "html", markup: "<b>no</b>" } } });
    await vi.waitFor(() => expect(worker.sent.at(-1)).toMatchObject({ type: "reply", requestId: 3, ok: false }));
  });

  it("round-trips a cloned asynchronous bag migration and terminates on teardown", async () => {
    const worker = new FakeWorker();
    const host = startModWorker(worker, {
      id: "worker", capabilities: [], entryUrl: "mem://worker/worker.js",
      snapshot: { id: "worker", modApi: 2, protocolVersion: MOD_WORKER_PROTOCOL_VERSION, engineVersion: "1.4.0", modVersion: "1.0.0", flags: {}, data: {}, capabilities: [], newCharacter: false },
      prefs: { get: () => null, set: () => undefined }, readAsset: async () => null,
    });
    ready(worker);
    await host.ready;
    const result = host.migrateBag({ old: true }, 1);
    const request = worker.sent.at(-1) as Extract<HostToModWorker, { type: "migrateBag" }>;
    worker.receive({ type: "migrateBag.result", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "worker", requestId: request.requestId, data: { new: true } });
    await expect(result).resolves.toEqual({ new: true });
    host.teardown();
    expect(worker.terminated).toBe(true);
  });
});
