import "ses";
import { ModuleSource } from "@endo/module-source";
import { domCompartmentGlobals } from "./mod-dom-facade.js";

export { domCompartmentGlobals, membraneNode, membraneTarget } from "./mod-dom-facade.js";

// Engine objects passed into a compartment stay live host objects. The DOM membrane does not cover them.
let initialized = false;

export function initializeModCompartments(): void {
  if (initialized) return;
  lockdown({
    errorTaming: "unsafe",
    stackFiltering: "verbose",
    overrideTaming: "severe",
    consoleTaming: "unsafe",
    errorTrapping: "none",
    unhandledRejectionTrapping: "none",
  });
  // SES freezes language intrinsics, while this browser prototype needs its own guard.
  if (typeof MessagePort !== "undefined") Object.freeze(MessagePort.prototype);
  initialized = true;
}

function resolveModule(specifier: string, referrer: string): string {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    throw new TypeError(`mod import is not relative: ${specifier}`);
  }
  const parts = referrer.split("/");
  parts.pop();
  for (const part of specifier.split("/")) {
    if (part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new TypeError("mod import leaves its measured payload");
      parts.pop();
    } else {
      if (!/^[a-zA-Z0-9_.-]+$/.test(part)) throw new TypeError("invalid mod module path");
      parts.push(part);
    }
  }
  const path = parts.join("/");
  if (!path.endsWith(".js") && !path.endsWith(".mjs")) throw new TypeError("mod imports need a JavaScript extension");
  return path;
}

export function createModCompartment(
  id: string,
  read: (path: string) => Uint8Array | null,
): Compartment {
  initializeModCompartments();
  const modules = new Map<string, ModuleSource>();
  const source = (path: string): ModuleSource => {
    const cached = modules.get(path);
    if (cached) return cached;
    const bytes = read(path);
    if (!bytes) throw new TypeError(`mod module is not in the measured payload: ${path}`);
    const record = new ModuleSource(new TextDecoder("utf-8", { fatal: true }).decode(bytes), `mod:${id}/${path}`);
    modules.set(path, record);
    return record;
  };
  const timer = (repeat: boolean) => (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]): ReturnType<typeof setTimeout> => {
    if (typeof callback !== "function") throw new TypeError("mod timers need a function");
    return repeat ? setInterval(() => callback(...args), delay) : setTimeout(() => callback(...args), delay);
  };
  return new Compartment({
    __options__: true,
    name: `mod:${id}`,
    globals: {
      ...(domCompartmentGlobals() ?? {}),
      Date,
      Math,
      setTimeout: timer(false),
      clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
      setInterval: timer(true),
      clearInterval: (handle: ReturnType<typeof setInterval>) => clearInterval(handle),
      performance: Object.freeze({ now: () => performance.now() }),
      TextEncoder,
      TextDecoder,
      structuredClone: (value: unknown) => structuredClone(value),
    },
    resolveHook: resolveModule,
    importHook: async (path: string) => source(path),
    importNowHook: source,
  });
}

export function importModCompartment(id: string, read: (path: string) => Uint8Array | null): unknown {
  const entry = read("plugin.js");
  if (!entry) throw new TypeError("mod entry is not in the measured payload");
  return createModCompartment(id, (path) => path === "plugin.js" ? entry : read(path)).importNow("plugin.js");
}
