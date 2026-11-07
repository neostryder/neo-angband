/**
 * The isolated execution origin for API-2 Worker mods.
 *
 * A Worker started from the game's page shares the game's origin: it can open
 * the game's IndexedDB, read its Cache Storage, and fetch anything the network
 * allows. So the Worker is not started by the game's page. It is started by a
 * hidden `<iframe sandbox="allow-scripts">` whose document comes from `srcdoc`.
 * Without `allow-same-origin` that frame has an opaque origin. The frame starts
 * the Worker from a data: URL, which gives the Worker an opaque origin of its
 * own and the frame's Content Security Policy. Three layers follow:
 *
 *  1. Opaque origin. IndexedDB, Cache Storage and the origin-private file
 *     system refuse an opaque origin or give it an empty store of its own, and
 *     nothing in it is same-origin with the game, so the game's own URLs and
 *     blob: URLs are out of reach.
 *  2. CSP (modFrameCsp). `connect-src 'none'` stops fetch, XHR, WebSocket,
 *     EventSource and WebTransport before a request is made; `script-src`
 *     admits only the frame's own nonce and data: URLs, so no remote script or
 *     module loads and `eval` is refused.
 *  3. Global lockdown (lockDownModWorkerScope). Before the mod's entry is
 *     imported, the Worker deletes the network, storage and nested-worker
 *     globals from its own scope. This is defence in depth for an engine that
 *     enforces less of 1 or 2, never the boundary on its own.
 *
 * Why data: and not blob: URLs, MEASURED with Playwright on Chromium, Gecko
 * and WebKit: inside an opaque-origin frame, Chromium refuses a module Worker
 * from a blob: URL, and WebKit refuses a Worker from a blob: URL of any type and
 * any import of a blob: module made by another context. A classic Worker from a
 * data: URL that imports data: modules runs in all three. The Worker is classic
 * for the same reason; it loads the mod's modules with `import()`, which a
 * classic Worker has.
 *
 * The frame retains the host ports. It forwards only bounded JSON text from
 * the Worker, after parsing and validation in the frame. A separate control
 * channel authenticates boot and carries Worker errors and the order to stop.
 * Stopping removes the frame, which ends its document and every Worker in it.
 *
 * docs/modding/WORKER_ISOLATION.md describes what this does and does not stop.
 */

import { MOD_PERMISSION_TEXT } from "@rpgm-tools/neo-angband-mod-sdk";
import { installModWorkerBootstrap } from "./bootstrap";
import type { ModWorkerLike } from "./host";
import type { HostToModWorker } from "./protocol";
import type { StagedModuleGraph } from "./staging";

/** Host to frame, once, transferring the boot port and nothing else. */
export const MOD_FRAME_HELLO = "neo-angband/mod-frame/hello";
/** Frame to host on the boot port, echoing the nonce that was embedded in the frame. */
export const MOD_FRAME_ACK = "neo-angband/mod-frame/ack";
/** Host to frame on the boot port, once the nonce matches. Carries the module source. */
export const MOD_FRAME_BOOT = "neo-angband/mod-frame/boot";
/** Frame to Worker, once, with the measured module URLs and no host port. */
export const MOD_WORKER_PORT = "neo-angband/mod-worker/port";
/** Worker to frame, once, after the bootstrap is installed and before host traffic is forwarded. */
export const MOD_WORKER_LIVE = "neo-angband/mod-worker/live";

/**
 * The most characters the frame builds when it links a mod's modules into data:
 * URLs. Each module embeds the URLs of its imports, percent-encoded again, so
 * deep or diamond-shaped graphs grow faster than their source does. A graph
 * past this fails to boot with a message, instead of exhausting memory.
 */
export const MAX_LINKED_SOURCE = 64 * 1024 * 1024;

/** What the host posts to the frame's window. The module source is not in it. */
export interface ModFrameHello {
  readonly type: typeof MOD_FRAME_HELLO;
  readonly nonce: string;
}

/** What the host sends the frame on the boot port, after the nonce matches. */
export interface ModFrameBoot {
  readonly type: typeof MOD_FRAME_BOOT;
  readonly nonce: string;
  readonly name: string;
  readonly workerSource: string;
  readonly modules: StagedModuleGraph["modules"];
  /** MAX_LINKED_SOURCE, sent along because the relay can import nothing of the game's. */
  readonly linkLimit: number;
}

/** Frame to host on the control port. */
export type ModFrameReport =
  | { readonly type: "frame.ready"; readonly modules: number }
  | { readonly type: "frame.error"; readonly message: string };

/**
 * The frame document's policy.
 *
 * `script-src` names the one inline script by nonce and allows data: for the
 * Worker's own modules; there is no 'unsafe-eval' and no 'unsafe-inline'.
 * Allowing data: lets a mod build and import code at run time, which gives it
 * nothing it does not already have: it runs code in this sandbox either way.
 * `worker-src data:` admits the one Worker, and `child-src` repeats it for
 * engines that still read workers from there. Everything else is 'none',
 * `connect-src` above all, so a mod's only way out is the host broker.
 */
export function modFrameCsp(nonce: string): string {
  if (!/^[A-Za-z0-9+/=_-]{16,}$/u.test(nonce)) throw new Error("mod frame nonce must be at least 16 base64 characters");
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' data:`,
    "worker-src data:",
    "child-src data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "img-src 'none'",
    "media-src 'none'",
    "font-src 'none'",
    "style-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** The sandboxed frame's whole document. */
export function modFrameDocument(nonce: string): string {
  const relay = modFrameRelay.toString();
  if (/<\/script/iu.test(relay)) throw new Error("mod frame relay cannot be embedded in a document");
  return [
    "<!doctype html>",
    "<html><head>",
    "<meta charset=\"utf-8\">",
    `<meta http-equiv="Content-Security-Policy" content="${modFrameCsp(nonce)}">`,
    "<title>mod</title>",
    "</head><body>",
    `<script nonce="${nonce}">(${relay})(window, ${JSON.stringify(nonce)});</script>`,
    "</body></html>",
  ].join("");
}

/** The environment the relay reads from the frame's window. Narrow so a test can supply one. */
export interface ModFrameWindow {
  readonly parent: unknown;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  readonly Worker: new (url: string, options: WorkerOptions) => Worker;
}

/**
 * The frame's only script, shipped as source text inside modFrameDocument. It
 * refers to nothing but its parameter and the language's own globals.
 *
 * A single-use nonce binds the transferred control port to this frame. Module
 * source arrives only on that port. The frame keeps the host port so raw
 * Worker handles cannot reach the page, even if a mod bypasses its proxy.
 */
export function modFrameRelay(win: ModFrameWindow, nonce: string): void {
  let booted = false;
  win.addEventListener("message", (event: MessageEvent) => {
    if (booted || event.source !== win.parent) return;
    const hello = event.data as { type?: unknown; nonce?: unknown } | null;
    if (hello === null || typeof hello !== "object" || hello.type !== "neo-angband/mod-frame/hello" || hello.nonce !== nonce || event.ports.length !== 1) return;
    const control = event.ports[0];
    if (control === undefined) return;
    booted = true;
    control.onmessage = (boot: MessageEvent): void => {
      const data = boot.data as ModFrameBoot | null;
      if (data === null || typeof data !== "object" || data.type !== "neo-angband/mod-frame/boot" || data.nonce !== nonce || boot.ports.length !== 1) return;
      control.onmessage = null;
      const hostPort = boot.ports[0];
      if (hostPort === undefined) return;
      const urls: string[] = [];
      const dataUrl = (text: string): string => `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}`;
      const report = (message: unknown): void => control.postMessage({ type: "frame.error", message: String(message instanceof Error ? message.message : message).slice(0, 4096) });
      try {
        if (typeof data.workerSource !== "string" || typeof data.name !== "string" || !Array.isArray(data.modules) || data.modules.length === 0 || typeof data.linkLimit !== "number") throw new Error("malformed boot message");
        const modules = data.modules as { parts?: unknown }[];
        const limit = data.linkLimit;
        let linked = 0;
        for (let index = 0; index < modules.length; index += 1) {
          const parts = modules[index]?.parts;
          if (!Array.isArray(parts)) throw new Error("malformed staged module");
          let text = "";
          for (const part of parts as unknown[]) {
            if (typeof part === "string") text += part;
            else if (typeof part === "number" && Number.isInteger(part) && part >= 0 && part < index) text += JSON.stringify(urls[part]);
            else throw new Error("staged module refers forward or to nothing");
            if (text.length > limit) break;
          }
          const url = dataUrl(text);
          linked += url.length;
          if (text.length > limit || linked > limit) throw new Error(`the mod's modules come to more than ${String(limit)} characters once linked`);
          urls.push(url);
        }
        const worker = new win.Worker(dataUrl(data.workerSource), { type: "classic", name: data.name });
        worker.onerror = (error: ErrorEvent): void => {
          error.preventDefault();
          report(error.message || "the mod Worker failed to load");
        };
        worker.onmessageerror = (): void => report("the mod Worker sent a message that could not be read");
        let live = false;
        worker.onmessage = (message: MessageEvent): void => {
          if (!live) {
            if (message.data !== "neo-angband/mod-worker/live" || message.ports.length !== 0) return;
            live = true;
            hostPort.onmessage = (incoming: MessageEvent): void => worker.postMessage(incoming.data);
            return;
          }
          /* The page never receives the Worker's objects or transferred handles. */
          if (message.ports.length !== 0 || typeof message.data !== "string" || message.data.length > 65536) return;
          try {
            if (new TextEncoder().encode(message.data).byteLength > 65536) return;
            const json: unknown = JSON.parse(message.data);
            const valid = (value: unknown, depth: number): boolean => {
              if (depth > 64) return false;
              if (value === null || typeof value === "string" || typeof value === "boolean") return true;
              if (typeof value === "number") return Number.isFinite(value);
              if (Array.isArray(value)) return value.every((child) => valid(child, depth + 1));
              return typeof value === "object" && Object.values(value).every((child) => valid(child, depth + 1));
            };
            if (valid(json, 0)) hostPort.postMessage(json);
          } catch { /* Malformed or oversized data has no authority on the page. */ }
        };
        control.onmessage = (message: MessageEvent): void => {
          if ((message.data as { type?: unknown } | null)?.type !== "frame.terminate") return;
          worker.terminate();
          hostPort.close();
          control.close();
        };
        worker.postMessage({ type: "neo-angband/mod-worker/port", entryUrl: urls[modules.length - 1] });
        control.postMessage({ type: "frame.ready", modules: modules.length });
      } catch (err) {
        report(err);
      }
    };
    control.postMessage({ type: "neo-angband/mod-frame/ack", nonce });
  });
}

/**
 * Remove what a mod could reach the network, storage or another Worker with,
 * from every object on the scope's prototype chain. Runs in the Worker before
 * the mod's entry is imported, and refers to nothing outside itself.
 *
 * Returns the names that are still reachable afterwards, which an engine that
 * makes a global non-configurable can cause. Production boot refuses leftovers.
 */
export function lockDownModWorkerScope(scope: object): string[] {
  const names = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "WebSocketStream",
    "EventSource",
    "WebTransport",
    "indexedDB",
    "webkitIndexedDB",
    "caches",
    "cookieStore",
    "Worker",
    "SharedWorker",
    "importScripts",
    "BroadcastChannel",
    "RTCPeerConnection",
    "RTCDataChannel",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
    "SharedArrayBuffer",
    "Atomics",
    "OffscreenCanvas",
    "Blob",
    "localStorage",
    "sessionStorage",
    "webkitRequestFileSystem",
    "requestFileSystem",
    "FileSystemHandle",
    "FileSystemDirectoryHandle",
    "FileSystemFileHandle",
    "StorageManager",
    "Cache",
    "CacheStorage",
    "StorageBucket",
    "StorageBucketManager",
  ];
  const left: string[] = [];
  const remove = (root: object, name: string, label: string): void => {
    for (let target: object | null = root; target !== null; target = Object.getPrototypeOf(target) as object | null) {
      const own = Object.getOwnPropertyDescriptor(target, name);
      if (own === undefined) continue;
      if (own.configurable === true) {
        Reflect.deleteProperty(target, name);
      } else if (own.writable === true) {
        Reflect.set(target, name, undefined);
      }
    }
    try {
      if ((root as Record<string, unknown>)[name] !== undefined) left.push(label);
    } catch { /* A getter that refuses access leaves no reachable authority. */ }
  };
  for (const name of names) remove(scope, name, name);
  const globals = scope as Record<string, unknown>;
  const url = globals["URL"];
  if (typeof url === "function" || (typeof url === "object" && url !== null)) remove(url, "createObjectURL", "URL.createObjectURL");
  const navigator = globals["navigator"];
  if (typeof navigator === "object" && navigator !== null) {
    for (const name of ["sendBeacon", "serviceWorker", "storage", "storageBuckets", "storageFoundation", "webkitTemporaryStorage", "webkitPersistentStorage", "locks", "getStorageDirectory"]) remove(navigator, name, `navigator.${name}`);
  }
  return left;
}

/**
 * The isolated Worker's script, a classic one: the lockdown, then the API 2 bootstrap
 * installed on a private JSON transport, importing the frame-linked
 * entry and nothing else.
 */
export function isolatedWorkerSource(protocolVersion: string, options: { readonly lockDown?: boolean } = {}): string {
  const lockDown = options.lockDown ?? true;
  return [
    `const lockDown = (${lockDownModWorkerScope.toString()});`,
    `const install = (${installModWorkerBootstrap.toString()});`,
    lockDown ? "const left = lockDown(self); if (left.length) throw new Error(('mod Worker lockdown failed: ' + left.join(', ')).slice(0, 1024));" : "",
    "for (const name of ['MessagePort', 'MessageEvent']) { const ctor = self[name]; if (ctor) { Object.freeze(ctor.prototype); Object.freeze(ctor); Object.defineProperty(self, name, { value: ctor, writable: false, configurable: false }); } }",
    "const post = self.postMessage.bind(self);",
    "const stringify = JSON.stringify;",
    "self.onmessage = (event) => {",
    "  const data = event.data;",
    `  if (data === null || typeof data !== "object" || data.type !== ${JSON.stringify(MOD_WORKER_PORT)} || typeof data.entryUrl !== "string") return;`,
    "  self.onmessage = null;",
    "  const entryUrl = data.entryUrl;",
    "  const scope = { onmessage: null, postMessage: (message) => post(stringify(message)) };",
    `  install(scope, ${JSON.stringify(protocolVersion)}, () => import(entryUrl), ${JSON.stringify(MOD_PERMISSION_TEXT)});`,
    "  self.onmessage = (incoming) => scope.onmessage?.(incoming);",
    `  post(${JSON.stringify(MOD_WORKER_LIVE)});`,
    "};",
    "",
  ].join("\n");
}

/** A frame the host can post to and take away again. */
export interface ModFrameHandle {
  /** Resolves once the frame's script has run. */
  readonly loaded: Promise<void>;
  post(message: ModFrameHello, transfer: Transferable[]): void;
  remove(): void;
}

/** Make the sandboxed frame. The default puts a hidden iframe on `document.body`. */
export type ModFrameFactory = (html: string, name: string) => ModFrameHandle;

export const domModFrame: ModFrameFactory = (html, name) => {
  const frame = document.createElement("iframe");
  /* allow-scripts and nothing else: no allow-same-origin (the origin stays
   * opaque), no forms, popups, top navigation, downloads or modals. */
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = `mod ${name}`;
  frame.style.display = "none";
  const loaded = new Promise<void>((resolve, reject) => {
    frame.addEventListener("load", () => resolve(), { once: true });
    frame.addEventListener("error", () => reject(new Error("mod frame did not load")), { once: true });
  });
  frame.srcdoc = html;
  document.body.append(frame);
  return {
    loaded,
    post: (message, transfer) => {
      /* "*" because the frame's origin is opaque and has no name to target.
       * The frame was made here, from srcdoc, and nothing can navigate it. */
      frame.contentWindow?.postMessage(message, "*", transfer);
    },
    remove: () => frame.remove(),
  };
};

export interface IsolatedModWorkerOptions {
  readonly id: string;
  readonly graph: StagedModuleGraph;
  readonly protocolVersion: string;
  /** Test seam; the game uses domModFrame. */
  readonly frame?: ModFrameFactory;
  /** Probe seam: false leaves the Worker's globals in place to test the other two layers alone. */
  readonly lockDown?: boolean;
  /** A fresh nonce per frame. */
  readonly nonce?: string;
  /** Test seam; the game uses MAX_LINKED_SOURCE. */
  readonly linkLimit?: number;
}

/**
 * A ModWorkerLike whose Worker runs in an opaque-origin sandboxed frame.
 *
 * Messages the host posts before the Worker is running wait in the channel and
 * arrive in order. A frame-reported failure arrives through `onerror`, which
 * startModWorker already treats as a boot failure.
 */
export function createIsolatedModWorker(options: IsolatedModWorkerOptions): ModWorkerLike {
  const channel = new MessageChannel();
  const control = new MessageChannel();
  const name = `neo-angband-mod:${options.id}`;
  const nonce = options.nonce ?? freshNonce();
  const frame = (options.frame ?? domModFrame)(modFrameDocument(nonce), name);
  let stopped = false;
  let acknowledged = false;
  const isolated: ModWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message: HostToModWorker): void {
      if (!stopped) channel.port1.postMessage(message);
    },
    terminate(): void {
      if (stopped) return;
      stopped = true;
      control.port1.postMessage({ type: "frame.terminate" });
      channel.port1.close();
      control.port1.close();
      frame.remove();
    },
  };
  channel.port1.onmessage = (event: MessageEvent<unknown>): void => {
    if (!stopped) isolated.onmessage?.(event);
  };
  const raise = (message: string): void => {
    if (!stopped) isolated.onerror?.(errorEvent(message));
  };
  control.port1.onmessage = (event: MessageEvent<unknown>): void => {
    const ack = event.data as { type?: unknown; nonce?: unknown } | null;
    if (!stopped && !acknowledged && ack?.type === MOD_FRAME_ACK && ack.nonce === nonce && event.ports.length === 0) {
      acknowledged = true;
      const boot: ModFrameBoot = {
        type: MOD_FRAME_BOOT,
        nonce,
        name,
        workerSource: isolatedWorkerSource(options.protocolVersion, options.lockDown === false ? { lockDown: false } : {}),
        modules: options.graph.modules,
        linkLimit: options.linkLimit ?? MAX_LINKED_SOURCE,
      };
      control.port1.postMessage(boot, [channel.port2]);
      return;
    }
    const report = event.data as Partial<ModFrameReport> | null;
    if (report?.type === "frame.error") raise(typeof report.message === "string" ? report.message : "the mod frame failed");
  };
  void frame.loaded.then(
    () => {
      if (stopped) return;
      frame.post({ type: MOD_FRAME_HELLO, nonce }, [control.port2]);
    },
    (err: unknown) => raise(err instanceof Error ? err.message : String(err)),
  );
  return isolated;
}

function freshNonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function errorEvent(message: string): ErrorEvent {
  return typeof ErrorEvent === "function" ? new ErrorEvent("error", { message }) : ({ message } as ErrorEvent);
}
