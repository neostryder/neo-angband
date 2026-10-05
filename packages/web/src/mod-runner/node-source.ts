/**
 * A mods directory read straight off the local disk, for the headless runner.
 *
 * Each path given is either one mod folder (it holds a manifest.json) or a
 * directory of mod folders, such as a staged payload directory. A folder is
 * listed under the id its manifest declares, so a staged copy whose folder name
 * is not the mod's id still loads. Everything about what makes a usable mod stays
 * in readModDir; this only enumerates files and hands out file URLs.
 *
 * Nothing here reaches the network: code and assets are served as file: URLs.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ModDirEntry, ModDirSource } from "../disk-packs";

/** Folders the walk never enters. */
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

const isCode = (path: string): boolean => /\.m?js$/u.test(path);
const isRecordFile = (path: string): boolean => !path.includes("/") && path.toLowerCase().endsWith(".json");

function walk(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    if (entry.isDirectory() && (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith("."))) continue;
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(root, path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** The id a manifest declares, schema 1 or the schema 2 envelope, or null when it has none. */
function manifestId(folder: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null) return null;
    const data = (raw as { data?: unknown }).data;
    const fields = typeof data === "object" && data !== null ? data : raw;
    const id = (fields as { id?: unknown }).id;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

/** The mod folders under each path: the path itself when it is one, else its children that are. */
function modFolders(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const given of paths) {
    const path = resolve(given);
    if (existsSync(join(path, "manifest.json"))) {
      out.push(path);
      continue;
    }
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new Error(`${given} is not a mod folder or a directory of mod folders`);
    }
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(path, entry.name, "manifest.json"))) {
        out.push(join(path, entry.name));
      }
    }
  }
  return out;
}

/** The source, plus where each listed mod lives on disk (for attributing a stack trace). */
export interface NodeModsSource extends ModDirSource {
  /** The folder a listed mod id was read from. */
  folderOf(id: string): string | undefined;
}

/** A ModDirSource over local mod folders. Throws when a path is neither a mod nor a folder of mods. */
export function nodeModsSource(paths: readonly string[]): NodeModsSource {
  const folders = new Map<string, string>();
  for (const folder of modFolders(paths)) {
    const id = manifestId(folder) ?? basename(folder);
    if (!folders.has(id)) folders.set(id, folder);
  }
  const folderFor = (id: string): string => {
    const folder = folders.get(id);
    if (folder === undefined) throw new Error(`no mod folder is listed for ${id}`);
    return folder;
  };
  const fileUrl = async (id: string, file: string): Promise<string | null> => {
    const path = join(folderFor(id), file);
    return existsSync(path) ? pathToFileURL(path).href : null;
  };
  return {
    kind: "app",
    dir: () => (paths.length === 1 && paths[0] !== undefined ? resolve(paths[0]) : null),
    list: async (): Promise<readonly ModDirEntry[]> =>
      [...folders].map(([id, folder]) => {
        const all = walk(folder);
        return {
          id,
          files: all.filter(isRecordFile),
          code: all.filter(isCode),
          assets: all.filter((path) => !isCode(path) && !isRecordFile(path)),
        };
      }),
    readJson: async (id, file) => JSON.parse(readFileSync(join(folderFor(id), file), "utf8")) as unknown,
    order: async () => [...folders.keys()],
    codeUrl: fileUrl,
    assetUrl: fileUrl,
    folderOf: (id) => folders.get(id),
  };
}
