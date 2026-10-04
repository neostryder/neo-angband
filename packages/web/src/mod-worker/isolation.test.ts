import { afterEach, describe, expect, it, vi } from "vitest";
import { startModWorker, type StartedModWorker } from "./host";
import {
  createIsolatedModWorker,
  isolatedWorkerSource,
  lockDownModWorkerScope,
  MAX_LINKED_SOURCE,
  MOD_FRAME_BOOT,
  MOD_WORKER_PORT,
  modFrameCsp,
  modFrameDocument,
  modFrameRelay,
  type ModFrameBoot,
  type ModFrameFactory,
  type ModFrameWindow,
} from "./isolation";
import { MOD_WORKER_PROTOCOL_VERSION, type WorkerInitSnapshot } from "./protocol";
import type { StagedModuleGraph } from "./staging";

const NONCE = "AAAAAAAAAAAAAAAAAAAAAAAA";

/*
 * A stand-in for the sandboxed frame. Node cannot host a real Worker or an
 * opaque origin, and vitest's module sandbox gives code made by `new Function`
 * no `import()`, so this runs the real relay and the real Worker source text
 * against fakes. The one `import(` in the Worker source is pointed at a shim
 * that hands back the test's module after checking the data: URL it was given,
 * which is the module text as the frame linked it. What it proves is
 * the wiring, the linking and that the shipped source stands on its own; the
 * isolation itself needs a browser (tests/e2e/mod-worker-isolation.spec.ts).
 */
interface FakeFrame {
  readonly win: ModFrameWindow;
  readonly parent: object;
  readonly workers: FakeWorker[];
  removed: boolean;
  deliver(data: unknown, ports: readonly MessagePort[], source?: unknown): void;
}

type ImportShim = (text: string) => Promise<unknown>;
const DATA = "data:text/javascript;charset=utf-8,";
function fromData(url: string): string {
  expect(url.startsWith(DATA)).toBe(true);
  return decodeURIComponent(url.slice(DATA.length));
}
const noModule: ImportShim = () => Promise.reject(new Error("no module"));

class FakeWorker {
  static frame: FakeFrame | null = null;
  static importShim: ImportShim = noModule;
  readonly scope: { onmessage: ((event: { data: unknown }) => void) | null; postMessage(): void } = { onmessage: null, postMessage: () => undefined };
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  constructor(url: string, readonly options: WorkerOptions) {
    const frame = FakeWorker.frame;
    if (frame === null) throw new Error("no frame");
    frame.workers.push(this);
    const source = fromData(url);
    expect(source.split("import(")).toHaveLength(2);
    const shim = FakeWorker.importShim;
    new Function("self", "importShim", source.replace("import(", "importShim("))(this.scope, (moduleUrl: string) => shim(fromData(moduleUrl)));
  }
  postMessage(message: unknown): void { queueMicrotask(() => this.scope.onmessage?.({ data: message })); }
  terminate(): void { this.terminated = true; }
}

function fakeFrame(): FakeFrame {
  const listeners: ((event: MessageEvent) => void)[] = [];
  const parent = {};
  const frame: FakeFrame = {
    parent,
    workers: [],
    removed: false,
    win: {
      parent,
      addEventListener: (_type, listener) => listeners.push(listener),
      Worker: FakeWorker as unknown as ModFrameWindow["Worker"],
    },
    deliver(data, ports, source = parent) {
      for (const listener of listeners) listener({ data, ports, source } as unknown as MessageEvent);
    },
  };
  FakeWorker.frame = frame;
  modFrameRelay(frame.win);
  return frame;
}

function frameFactory(frames: FakeFrame[]): ModFrameFactory {
  return (html) => {
    expect(html).toContain("modFrameRelay");
    const frame = fakeFrame();
    frames.push(frame);
    return {
      loaded: Promise.resolve(),
      post: (message: ModFrameBoot, transfer: Transferable[]) => frame.deliver(message, transfer as MessagePort[]),
      remove: () => { frame.removed = true; },
    };
  };
}

function snapshot(id: string): WorkerInitSnapshot {
  return { id, modApi: 2, protocolVersion: MOD_WORKER_PROTOCOL_VERSION, engineVersion: "1.22.0", modVersion: "1.0.0", flags: {}, data: {}, capabilities: [], newCharacter: false };
}

const sessions: StartedModWorker[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.teardown();
  FakeWorker.frame = null;
  FakeWorker.importShim = noModule;
});

describe("the mod frame's document and policy", () => {
  it("denies the network and every load but its own nonce and blob: modules", () => {
    const csp = modFrameCsp(NONCE);
    expect(csp.split("; ")).toEqual(expect.arrayContaining([
      "default-src 'none'",
      `script-src 'nonce-${NONCE}' data:`,
      "worker-src data:",
      "connect-src 'none'",
      "frame-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ]));
    expect(csp).not.toMatch(/unsafe-eval|unsafe-inline|strict-dynamic|\*|https?:|blob:/u);
    expect(() => modFrameCsp("short")).toThrow();
    expect(() => modFrameCsp(`${NONCE}' 'unsafe-eval`)).toThrow();
  });

  it("sets the policy before its one script, which carries the nonce", () => {
    const html = modFrameDocument(NONCE);
    const meta = html.indexOf("http-equiv=\"Content-Security-Policy\"");
    const script = html.indexOf("<script");
    expect(meta).toBeGreaterThan(0);
    expect(script).toBeGreaterThan(meta);
    expect(html.match(/<script/gu)).toHaveLength(1);
    expect(html).toContain(`<script nonce="${NONCE}">`);
    expect(html).toContain(`content="${modFrameCsp(NONCE)}"`);
  });

  it("spells the relay's message types the way the host does", () => {
    expect(modFrameRelay.toString()).toContain(MOD_FRAME_BOOT);
    expect(modFrameRelay.toString()).toContain(MOD_WORKER_PORT);
  });
});

describe("the Worker's global lockdown", () => {
  it("removes network, storage and nested-worker globals along the scope's prototype chain", () => {
    const proto = { fetch: (): void => undefined, Worker: class {}, keep: 1 };
    const scope = Object.create(proto) as Record<string, unknown>;
    Object.defineProperty(scope, "indexedDB", { value: {}, configurable: true, writable: false });
    Object.defineProperty(scope, "caches", { value: {}, configurable: false, writable: true });
    Object.defineProperty(scope, "WebSocket", { value: class {}, configurable: false, writable: false });
    const left = lockDownModWorkerScope(scope);
    expect(scope["fetch"]).toBeUndefined();
    expect(scope["Worker"]).toBeUndefined();
    expect(scope["indexedDB"]).toBeUndefined();
    expect(scope["caches"]).toBeUndefined();
    expect(scope["keep"]).toBe(1);
    expect(left).toEqual(["WebSocket"]);
  });
});

describe("the Worker source shipped to the frame", () => {
  it("stands on its own: it parses and runs with nothing but its scope", () => {
    const scope: { onmessage: unknown } = { onmessage: null };
    expect(() => new Function("self", isolatedWorkerSource(MOD_WORKER_PROTOCOL_VERSION))(scope)).not.toThrow();
    expect(typeof scope.onmessage).toBe("function");
  });

  it("leaves the globals alone only when the probe asks", () => {
    expect(isolatedWorkerSource("1", { lockDown: false })).not.toContain("lockDown(self)");
    expect(isolatedWorkerSource("1")).toContain("lockDown(self)");
  });
});

describe("an isolated mod Worker end to end through the relay", () => {
  const graph: StagedModuleGraph = {
    modules: [
      { label: "lib/greet.js", parts: ["export const greet = (name) => name;"] },
      { label: "worker.js", parts: ["import { greet } from ", 0, ";\nexport default async () => {};"] },
    ],
    size: 0,
  };

  it("boots the linked entry, carries requests and replies, and stops the frame on teardown", async () => {
    const frames: FakeFrame[] = [];
    const logs: string[] = [];
    FakeWorker.importShim = (text) => {
      const dependency = `${DATA}${encodeURIComponent("export const greet = (name) => name;")}`;
      expect(text).toBe(`import { greet } from ${JSON.stringify(dependency)};\nexport default async () => {};`);
      return Promise.resolve({
        default: async (api: { init: { id: string }; log(level: string, message: string): void; prefs: { get(): Promise<unknown> } }) => {
          api.log("info", `hello ${api.init.id}`);
          api.log("info", JSON.stringify(await api.prefs.get()));
        },
      });
    };
    const worker = createIsolatedModWorker({ id: "probe", graph, protocolVersion: MOD_WORKER_PROTOCOL_VERSION, frame: frameFactory(frames), nonce: NONCE });
    const session = startModWorker(worker, {
      id: "probe",
      capabilities: ["prefs:read"],
      entryUrl: "staged:worker.js",
      snapshot: snapshot("probe"),
      prefs: { get: () => ({ theme: "dark" }), set: () => undefined },
      readAsset: async () => null,
      onLog: (_level, message) => logs.push(message),
      onProblem: (problem) => logs.push(`problem: ${problem}`),
    });
    sessions.push(session);
    await session.ready;
    expect(logs).toEqual(["hello probe", "{\"theme\":\"dark\"}"]);
    const frame = frames[0];
    expect(frame?.workers).toHaveLength(1);
    expect(frame?.workers[0]?.options).toEqual({ type: "classic", name: "neo-angband-mod:probe" });
    session.teardown();
    sessions.splice(0);
    await vi.waitFor(() => expect(frame?.workers[0]?.terminated).toBe(true));
    expect(frame?.removed).toBe(true);
  });

  it("reports a staged module that refers forward as a boot failure", async () => {
    const frames: FakeFrame[] = [];
    const worker = createIsolatedModWorker({
      id: "probe",
      graph: { modules: [{ label: "worker.js", parts: ["import ", 0, ";"] }], size: 0 },
      protocolVersion: MOD_WORKER_PROTOCOL_VERSION,
      frame: frameFactory(frames),
      nonce: NONCE,
    });
    const session = startModWorker(worker, { id: "probe", capabilities: [], entryUrl: "staged:worker.js", snapshot: snapshot("probe"), prefs: { get: () => null, set: () => undefined }, readAsset: async () => null });
    sessions.push(session);
    await expect(session.ready).rejects.toThrow("staged module refers forward or to nothing");
    expect(frames[0]?.workers).toHaveLength(0);
  });

  it("refuses a graph that grows past the link limit, before starting a Worker", async () => {
    const frames: FakeFrame[] = [];
    /* Each module imports the one before it twice, so the linked text doubles
     * per level while the source stays a few bytes per module. */
    const modules = [{ label: "m0.js", parts: ["export default 0;"] as (string | number)[] }];
    for (let index = 1; index < 24; index += 1) modules.push({ label: `m${String(index)}.js`, parts: ["import ", index - 1, "; import ", index - 1, ";"] });
    const worker = createIsolatedModWorker({ id: "probe", graph: { modules, size: 0 }, protocolVersion: MOD_WORKER_PROTOCOL_VERSION, frame: frameFactory(frames), nonce: NONCE, linkLimit: 1_000_000 });
    const session = startModWorker(worker, { id: "probe", capabilities: [], entryUrl: "staged:m23.js", snapshot: snapshot("probe"), prefs: { get: () => null, set: () => undefined }, readAsset: async () => null });
    sessions.push(session);
    await expect(session.ready).rejects.toThrow("the mod's modules come to more than 1000000 characters once linked");
    expect(frames[0]?.workers).toHaveLength(0);
  });

  it("ignores a boot message that did not come from the game page, and a second one", () => {
    const frame = fakeFrame();
    const stranger = new MessageChannel();
    const boot = { type: MOD_FRAME_BOOT, name: "x", workerSource: isolatedWorkerSource("1"), modules: graph.modules, linkLimit: MAX_LINKED_SOURCE };
    frame.deliver(boot, [stranger.port1, stranger.port2], {});
    expect(frame.workers).toHaveLength(0);
    const first = new MessageChannel();
    const control = new MessageChannel();
    frame.deliver(boot, [first.port2, control.port2]);
    frame.deliver(boot, [first.port2, control.port2]);
    expect(frame.workers).toHaveLength(1);
    for (const channel of [stranger, first, control]) channel.port1.close();
  });

  it("raises a frame that fails to load as a Worker error and drops traffic after terminate", async () => {
    const errors: string[] = [];
    const worker = createIsolatedModWorker({
      id: "probe",
      graph,
      protocolVersion: MOD_WORKER_PROTOCOL_VERSION,
      frame: () => ({ loaded: Promise.reject(new Error("frame refused")), post: () => undefined, remove: () => undefined }),
      nonce: NONCE,
    });
    worker.onerror = (event) => errors.push(event.message);
    await vi.waitFor(() => expect(errors).toEqual(["frame refused"]));
    worker.terminate();
    expect(() => worker.postMessage({ type: "teardown", pluginId: "probe" })).not.toThrow();
  });
});
