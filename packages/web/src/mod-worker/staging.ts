/**
 * Staging a Worker mod's module graph as bytes for the isolated runtime.
 *
 * The isolated Worker runs in an opaque origin (isolation.ts). It cannot load a
 * URL of the game's origin: a blob: URL is usable only by the origin that made
 * it, and an opaque origin is never same-origin with anything. So the host reads
 * every module the entry reaches, here, and hands the frame the TEXT. The frame
 * turns each one into a data: URL and links them.
 *
 * Each module is split into parts: runs of source text, and the index of an
 * earlier module wherever a specifier stood. The frame needs no parser to link
 * them; it joins the parts and writes each dependency's data: URL in place of its
 * index. Dependencies come first and the entry is last, so every index points
 * backwards.
 *
 * Only the mod's own files are staged. A specifier must resolve to a blob: URL
 * of the game's own origin (a folder picked in a browser, already resolved by
 * mod-modules.ts) or to a file under the entry's own folder on the game's origin
 * (the desktop shell and a served mods directory). A bare package name, another
 * origin, a data: URL or a path out of the folder is refused with the file at
 * fault named, before any code runs.
 */

import { findSpecifiers } from "../mod-modules";

/** One staged module: source text runs, and earlier-module indexes where a specifier stood. */
export interface StagedModule {
  /** Where the text came from, for messages only. Never loaded by the frame. */
  readonly label: string;
  readonly parts: readonly (string | number)[];
}

export interface StagedModuleGraph {
  /** Dependencies first; the entry is the last module. */
  readonly modules: readonly StagedModule[];
  /** Total source characters, for the size limit. */
  readonly size: number;
}

/** A mod's whole module graph may hold at most this many files. */
export const MAX_STAGED_MODULES = 256;
/** And at most this many characters of source, all files together. */
export const MAX_STAGED_SOURCE = 16 * 1024 * 1024;

export interface StageOptions {
  /** The game's own origin (`location.origin`). */
  readonly origin: string;
  /** One module's text, or null when it cannot be read. */
  readonly read: (url: string) => Promise<string | null>;
}

/**
 * Read the module graph that starts at `entryUrl` into staged parts.
 *
 * Throws with a message naming the file at fault when the graph has a cycle, a
 * module cannot be read, a specifier leaves the mod, or a limit is passed.
 */
export async function stageModuleGraph(entryUrl: string, options: StageOptions): Promise<StagedModuleGraph> {
  const entry = parseUrl(entryUrl);
  const folder = entry === null || entry.protocol === "blob:" ? null : entry.href.slice(0, entry.href.lastIndexOf("/") + 1);
  if (entry === null || !ownUrl(entry, options.origin, folder)) {
    throw new Error(`the Worker entry ${entryUrl} is not a file of this game's own origin`);
  }
  const modules: StagedModule[] = [];
  const done = new Map<string, number>();
  const chain: string[] = [];
  let size = 0;

  const build = async (url: URL, label: string): Promise<number> => {
    const already = done.get(url.href);
    if (already !== undefined) return already;
    if (chain.includes(url.href)) {
      const importer = chain.at(-1);
      throw new Error(`${importer === undefined ? label : labelFor(new URL(importer), folder)} and ${label} import each other, and a Worker mod's modules cannot form a cycle`);
    }
    const text = await options.read(url.href);
    if (text === null) throw new Error(`${label} could not be read`);
    size += text.length;
    if (size > MAX_STAGED_SOURCE) throw new Error(`the Worker mod's scripts are larger than ${String(MAX_STAGED_SOURCE)} characters`);
    chain.push(url.href);
    const parts: (string | number)[] = [];
    let last = 0;
    for (const found of findSpecifiers(text)) {
      const target = resolveSpecifier(found.spec, url);
      if (target === null || !ownUrl(target, options.origin, folder)) {
        throw new Error(`${label} imports "${found.spec}", which is not one of the mod's own files`);
      }
      const index = await build(target, labelFor(target, folder));
      parts.push(text.slice(last, found.start), index);
      last = found.end;
    }
    parts.push(text.slice(last));
    chain.pop();
    if (modules.length >= MAX_STAGED_MODULES) throw new Error(`the Worker mod has more than ${String(MAX_STAGED_MODULES)} script files`);
    modules.push({ label, parts: parts.filter((part) => part !== "") });
    done.set(url.href, modules.length - 1);
    return modules.length - 1;
  };

  await build(entry, labelFor(entry, folder));
  return { modules, size };
}

function parseUrl(value: string, base?: URL): URL | null {
  try {
    return base === undefined ? new URL(value) : new URL(value, base);
  } catch {
    return null;
  }
}

/** A relative specifier against its importer, or an absolute one as it stands. Bare names are null. */
function resolveSpecifier(spec: string, from: URL): URL | null {
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) {
    return from.protocol === "blob:" ? null : parseUrl(spec, from);
  }
  return /^[a-z][a-z0-9+.-]*:/iu.test(spec) ? parseUrl(spec) : null;
}

/**
 * A blob: URL this origin made, when the entry is one; otherwise a URL of this
 * origin under the mod's folder.
 */
function ownUrl(url: URL, origin: string, folder: string | null): boolean {
  if (originOf(url) !== origin) return false;
  if (folder === null) return url.protocol === "blob:";
  return url.protocol !== "blob:" && url.search === "" && url.hash === "" && url.href.startsWith(folder);
}

/**
 * `scheme://host` for a URL, and the creating origin for a blob: URL. Built by
 * hand rather than read from `URL.origin`, which is "null" for a custom scheme
 * such as the desktop shell's `neo-angband:` outside a browser engine.
 */
function originOf(url: URL): string {
  if (url.protocol === "blob:") {
    const inner = parseUrl(url.pathname);
    return inner === null || inner.protocol === "blob:" ? "null" : originOf(inner);
  }
  return `${url.protocol}//${url.host}`;
}

function labelFor(url: URL, folder: string | null): string {
  return folder !== null && url.href.startsWith(folder) ? decodeURIComponent(url.href.slice(folder.length)) : url.href;
}
