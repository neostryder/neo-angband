// A script element or an event-handler string runs as the page, so both are refused.
// Reserved storage names stay on the page object this membrane does not hand out.

const BLOCKED_PROP = new Set([
  "localStorage", "sessionStorage", "indexedDB", "caches", "cookieStore", "storage",
  "neoHostFs", "neoDesktop", "fetch", "XMLHttpRequest", "WebSocket", "EventSource",
  "open", "Worker", "SharedWorker", "webkitIndexedDB", "chrome", "process",
  "contentWindow", "contentDocument", "frameElement", "history", "navigation",
  "serviceWorker", "eval", "Function", "importScripts",
]);
const BLOCKED_MARKUP = new Set(["innerHTML", "outerHTML", "insertAdjacentHTML", "srcdoc"]);
const BLOCKED_TAGS = new Set(["script", "iframe", "object", "embed", "frame", "frameset", "portal", "link"]);
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "data"]);
const RESERVED_KEY = /^(?:neo-angband:|neo:)/u;
const RESERVED_DB = new Set(["neo-angband"]);
const CTORS = [
  "HTMLElement", "HTMLCanvasElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
  "HTMLAnchorElement", "HTMLOptionElement", "HTMLButtonElement", "HTMLImageElement", "Element", "Node",
  "ShadowRoot", "SVGElement", "Text", "Comment", "DocumentFragment", "Image",
] as const;

type HostFn = ((...args: unknown[]) => unknown) & { readonly name: string; prototype?: object | null };

const toWrapper = new WeakMap<object, object>();
const toTarget = new WeakMap<object, object>();
const listeners = new WeakMap<object, EventListener>();

let pageWindow: (Window & typeof globalThis) | null = null;
let pageDocument: Document | null = null;
let locationView: object = {};
let navigatorView: object = {};
let cachedGlobals: Record<string, unknown> | null = null;

function unwrap(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unwrap);
  if (value !== null && (typeof value === "object" || typeof value === "function") && toTarget.has(value as object)) {
    return toTarget.get(value as object);
  }
  return value;
}

function isLeaf(value: object): boolean {
  if (value instanceof Error || value instanceof Date || value instanceof RegExp) return true;
  if (typeof ArrayBuffer !== "undefined" && (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)) return true;
  const tag = Object.prototype.toString.call(value);
  return tag.startsWith("[object IDB") || tag === "[object Blob]" || tag === "[object File]" || tag === "[object MediaQueryList]";
}

function unsafeUrl(value: string): boolean {
  const text = value.trim().toLowerCase();
  return text.startsWith("javascript:") || text.startsWith("vbscript:") || text.startsWith("data:text/html");
}

function blockedProp(prop: PropertyKey): boolean {
  return typeof prop === "string" && (BLOCKED_PROP.has(prop) || BLOCKED_MARKUP.has(prop));
}

function adaptListener(fn: object): EventListener {
  const known = listeners.get(fn);
  if (known) return known;
  const adapted: EventListener = function (this: unknown, event: Event) {
    return Reflect.apply(fn as HostFn, wrap(this), [wrap(event)]);
  };
  listeners.set(fn, adapted);
  return adapted;
}

function callThrough(fn: HostFn, thisArg: unknown, args: unknown[]): unknown {
  if (fn.name === "insertAdjacentHTML" || fn.name === "write" || fn.name === "writeln") {
    throw new TypeError("mod document cannot parse markup");
  }
  const next = args.map(unwrap);
  if ((fn.name === "createElement" || fn.name === "createElementNS") && next.length) {
    const tag = String(fn.name === "createElementNS" ? next[1] : next[0]).toLowerCase();
    if (BLOCKED_TAGS.has(tag)) throw new TypeError("mod document cannot create this element");
  }
  if ((fn.name === "addEventListener" || fn.name === "removeEventListener") && typeof next[1] === "function") {
    next[1] = adaptListener(next[1] as object);
  }
  if ((fn.name === "setAttribute" || fn.name === "setAttributeNS") && next.length >= 2) {
    const attr = String(fn.name === "setAttributeNS" ? next[1] : next[0]);
    const value = String((fn.name === "setAttributeNS" ? next[2] : next[1]) ?? "");
    if (/^on/iu.test(attr)) throw new TypeError("mod document cannot set an event handler attribute");
    if (URL_ATTRS.has(attr.toLowerCase()) && unsafeUrl(value)) throw new TypeError("mod document cannot set this URL");
  }
  return wrap(Reflect.apply(fn, unwrap(thisArg), next));
}

function wrapFunction(fn: HostFn): HostFn {
  const cached = toWrapper.get(fn);
  if (cached) return cached as HostFn;
  const proxy = new Proxy(fn, {
    apply(_target, thisArg, args) { return callThrough(fn, thisArg, args); },
    construct(target, args, newTarget): object {
      const rawNew = unwrap(newTarget);
      const created = Reflect.construct(
        target,
        args.map(unwrap),
        typeof rawNew === "function" ? rawNew as new (...args: unknown[]) => object : target,
      );
      return wrap(created) as object;
    },
    get(target, prop) {
      if (prop === "prototype") return target.prototype ? wrapObject(target.prototype as object) : target.prototype;
      if (blockedProp(prop)) return undefined;
      return wrap(Reflect.get(target, prop, target));
    },
    getPrototypeOf(target) { return Object.getPrototypeOf(target) as object | null; },
  });
  toWrapper.set(fn, proxy);
  toTarget.set(proxy, fn);
  return proxy as HostFn;
}

function wrapObject(value: object): object {
  const cached = toWrapper.get(value);
  if (cached) return cached;
  const proxy = new Proxy(value, {
    get(target, prop) {
      if (blockedProp(prop)) return undefined;
      if ((prop === "write" || prop === "writeln") && target === pageDocument) return undefined;
      if (prop === "location" && (target === pageWindow || target === pageDocument)) return locationView;
      if (prop === "navigator" && target === pageWindow) return navigatorView;
      let read: unknown;
      try { read = Reflect.get(target, prop, target); } catch { return undefined; }
      if (typeof read === "function") return wrapFunction(read as HostFn);
      return wrap(read);
    },
    set(target, prop, next) {
      if (blockedProp(prop) || prop === "location") return false;
      let stored = unwrap(next);
      if (typeof prop === "string" && /^on/iu.test(prop) && prop.length > 2) {
        if (typeof stored === "string") throw new TypeError("mod document cannot set an event handler attribute");
        if (typeof stored === "function") stored = adaptListener(stored);
      }
      if (typeof prop === "string" && URL_ATTRS.has(prop.toLowerCase()) && typeof stored === "string" && unsafeUrl(stored)) return false;
      return Reflect.set(target, prop, stored, target);
    },
    has(target, prop) { return !blockedProp(prop) && Reflect.has(target, prop); },
    getPrototypeOf(target) {
      const proto = Object.getPrototypeOf(target) as object | null;
      return proto ? wrapObject(proto) : null;
    },
    setPrototypeOf() { return false; },
    getOwnPropertyDescriptor(target, prop) {
      if (blockedProp(prop)) return undefined;
      const desc = Reflect.getOwnPropertyDescriptor(target, prop);
      if (!desc) return undefined;
      if ("value" in desc) return { ...desc, value: wrap(desc.value) };
      if (desc.get) {
        let read: unknown;
        try { read = desc.get.call(target); } catch { return undefined; }
        return { configurable: true, enumerable: Boolean(desc.enumerable), writable: Boolean(desc.set), value: wrap(read) };
      }
      return desc;
    },
  });
  toWrapper.set(value, proxy);
  toTarget.set(proxy, value);
  return proxy;
}

function wrap(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const kind = typeof value;
  if (kind !== "object" && kind !== "function") return value;
  const object = value as object;
  if (toWrapper.has(object)) return toWrapper.get(object);
  if (toTarget.has(object)) return value;
  if (isLeaf(object)) return value;
  if (kind === "function") return wrapFunction(value as HostFn);
  if (Array.isArray(value)) return value.map(wrap);
  if (Object.prototype.toString.call(value) === "[object Promise]") {
    return (value as Promise<unknown>).then(wrap, (error: unknown) => Promise.reject(error));
  }
  return wrapObject(object);
}

function filteredStorage(real: Storage): Storage {
  const hidden = (key: string): boolean => RESERVED_KEY.test(key);
  const visible = (): string[] => {
    const keys: string[] = [];
    for (let i = 0; i < real.length; i += 1) {
      const key = real.key(i);
      if (key !== null && !hidden(key)) keys.push(key);
    }
    return keys;
  };
  return {
    get length(): number { return visible().length; },
    clear(): void { for (const key of visible()) real.removeItem(key); },
    getItem(key: string): string | null { return hidden(key) ? null : real.getItem(key); },
    key(index: number): string | null { return visible()[index] ?? null; },
    removeItem(key: string): void { if (!hidden(key)) real.removeItem(key); },
    setItem(key: string, value: string): void {
      if (hidden(key)) throw new DOMException("The mod cannot change this record.", "SecurityError");
      real.setItem(key, value);
    },
  };
}

function filteredIndexedDb(real: IDBFactory): IDBFactory {
  const refuse = (name: string): void => {
    if (RESERVED_DB.has(name)) throw new DOMException("The mod cannot open this database.", "SecurityError");
  };
  return {
    open(name: string, version?: number): IDBOpenDBRequest {
      refuse(name);
      return real.open(name, version);
    },
    deleteDatabase(name: string): IDBOpenDBRequest {
      refuse(name);
      return real.deleteDatabase(name);
    },
    cmp(first: BufferSource, second: BufferSource): number {
      return real.cmp(first, second);
    },
    databases(): Promise<IDBDatabaseInfo[]> {
      if (!real.databases) return Promise.resolve([]);
      return real.databases().then((entries) => entries.filter((entry) => !entry.name || !RESERVED_DB.has(entry.name)));
    },
  };
}

function adoptPage(nextWindow: Window & typeof globalThis, nextDocument: Document): Record<string, unknown> {
  pageWindow = nextWindow;
  pageDocument = nextDocument;
  const location = nextWindow.location;
  locationView = Object.freeze({
    href: location?.href ?? "",
    origin: location?.origin ?? "",
    pathname: location?.pathname ?? "",
    search: location?.search ?? "",
    hash: location?.hash ?? "",
    reload: (): void => { location?.reload(); },
    assign(): void { throw new TypeError("mod location is read-only"); },
    replace(): void { throw new TypeError("mod location is read-only"); },
  });
  const nav = nextWindow.navigator;
  navigatorView = Object.freeze({
    userAgent: nav?.userAgent ?? "",
    language: nav?.language ?? "",
    languages: Object.freeze([...(nav?.languages ?? [])]),
    platform: nav?.platform ?? "",
    hardwareConcurrency: nav?.hardwareConcurrency ?? 1,
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    vendor: nav?.vendor ?? "",
  });
  const ordinary = Function.prototype[Symbol.hasInstance];
  const page = nextWindow as unknown as Record<string, unknown>;
  for (const name of CTORS) {
    const ctor = page[name];
    if (typeof ctor !== "function") continue;
    try {
      Object.defineProperty(ctor, Symbol.hasInstance, {
        configurable: true,
        writable: true,
        value(value: unknown): boolean { return Boolean(ordinary.call(ctor, unwrap(value))); },
      });
    } catch {
      // A non-configurable brand still works through the wrapped constructor endowed below.
    }
  }
  const globals: Record<string, unknown> = {
    document: wrapObject(nextDocument),
    window: wrapObject(nextWindow),
    location: locationView,
    navigator: navigatorView,
  };
  for (const name of CTORS) {
    if (typeof page[name] === "function") globals[name] = wrapFunction(page[name] as HostFn);
  }
  for (const name of ["URL", "URLSearchParams", "Blob", "File", "crypto", "DecompressionStream", "CompressionStream"] as const) {
    if (page[name] !== undefined) globals[name] = page[name];
  }
  if (typeof nextWindow.matchMedia === "function") globals["matchMedia"] = nextWindow.matchMedia.bind(nextWindow);
  if (typeof nextWindow.requestAnimationFrame === "function") globals["requestAnimationFrame"] = nextWindow.requestAnimationFrame.bind(nextWindow);
  if (typeof nextWindow.cancelAnimationFrame === "function") globals["cancelAnimationFrame"] = nextWindow.cancelAnimationFrame.bind(nextWindow);
  if (typeof nextWindow.getComputedStyle === "function") globals["getComputedStyle"] = wrapFunction(nextWindow.getComputedStyle.bind(nextWindow) as HostFn);
  if (typeof nextWindow.prompt === "function") globals["prompt"] = nextWindow.prompt.bind(nextWindow);
  try { if (nextWindow.localStorage) globals["localStorage"] = filteredStorage(nextWindow.localStorage); } catch { /* Private mode has no storage. */ }
  try { if (nextWindow.sessionStorage) globals["sessionStorage"] = filteredStorage(nextWindow.sessionStorage); } catch { /* Same as localStorage. */ }
  if (nextWindow.indexedDB) globals["indexedDB"] = filteredIndexedDb(nextWindow.indexedDB);
  return globals;
}

export function domCompartmentGlobals(): Record<string, unknown> | null {
  const nextWindow = globalThis.window as (Window & typeof globalThis) | undefined;
  const nextDocument = globalThis.document;
  if (!nextWindow || !nextDocument || typeof nextDocument.createElement !== "function") return null;
  if (cachedGlobals && pageWindow === nextWindow) return cachedGlobals;
  cachedGlobals = adoptPage(nextWindow, nextDocument);
  return cachedGlobals;
}

export function membraneNode<T>(node: T): T {
  if (node === null || typeof node !== "object" || typeof (node as { nodeType?: unknown }).nodeType !== "number") return node;
  if (!domCompartmentGlobals()) return node;
  return wrap(node) as T;
}

// Host lists hold the real nodes and find the focused one with indexOf. The wrapper is a different object.
export function membraneTarget<T>(value: T): T {
  return unwrap(value) as T;
}
