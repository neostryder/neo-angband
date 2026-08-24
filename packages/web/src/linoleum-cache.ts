/**
 * Generate a Linoleum loose pack from a mod's compact source tilesheet on first
 * selection, then keep its generated files in IndexedDB.  The mod installer owns
 * downloaded source bytes; this store owns only a derived cache, partitioned by
 * the mod id and a source revision supplied in the manifest.
 */

import { planTilesheetConversion } from "@rpgm-tools/neo-angband-linoleum/conversion-plan";
import type { PackConfig } from "@rpgm-tools/neo-angband-linoleum";
import type { PrefSource } from "@rpgm-tools/neo-angband-linoleum";
import type { LinoleumTilesheetSource } from "@rpgm-tools/neo-angband-mod-sdk";
import { STORE_LINOLEUM, idbGet, idbPutMany, openDb } from "./idb";
import type { PackFileResolver } from "./pack-files";
import { assetMime } from "./pack-files";

export interface LinoleumCacheStore {
  get(key: string): Promise<Uint8Array | null>;
  put(entries: ReadonlyArray<readonly [string, Uint8Array]>): Promise<boolean>;
}

/** A browser-run conversion, injectable so cache behaviour has a node test. */
export type LinoleumConverter = (input: {
  source: LinoleumTilesheetSource;
  resolve: PackFileResolver;
}) => Promise<ReadonlyArray<readonly [string, Uint8Array]> | null>;

function bytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function cachePrefix(modId: string, source: LinoleumTilesheetSource): string {
  return `${modId}/${source.key}/${source.cacheKey}/`;
}

/** Copy only this view's bytes; Blob's type rejects a SharedArrayBuffer-backed view. */
function blobPart(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function cachedResolver(store: LinoleumCacheStore, prefix: string): PackFileResolver {
  const urls = new Map<string, string>();
  return async (path) => {
    const key = `${prefix}${path}`;
    const old = urls.get(key);
    if (old !== undefined) return old;
    const body = await store.get(key);
    if (body === null || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
    const exact = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    const type = assetMime(path);
    const url = URL.createObjectURL(type ? new Blob([exact], { type }) : new Blob([exact]));
    urls.set(key, url);
    return url;
  };
}

function memoryCache(): LinoleumCacheStore {
  const files = new Map<string, Uint8Array>();
  return {
    async get(key) {
      return files.get(key) ?? null;
    },
    async put(entries) {
      for (const [key, body] of entries) files.set(key, body);
      return true;
    },
  };
}

async function idbCache(scope: unknown): Promise<LinoleumCacheStore | null> {
  const db = await openDb(scope);
  if (db === null) return null;
  return {
    async get(key) {
      return bytes(await idbGet(db, STORE_LINOLEUM, key));
    },
    put(entries) {
      return idbPutMany(db, STORE_LINOLEUM, entries);
    },
  };
}

async function readBytes(resolve: PackFileResolver, path: string): Promise<Uint8Array | null> {
  try {
    const url = await resolve(path);
    if (url === null) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function canvasCrop(
  imageBytes: Uint8Array,
  crops: readonly { path: string; rect: { x: number; y: number; width: number; height: number } }[],
): Promise<ReadonlyArray<readonly [string, Uint8Array]> | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(new Blob([blobPart(imageBytes)], { type: "image/png" }));
  } catch {
    return null;
  }
  try {
    const out: Array<readonly [string, Uint8Array]> = [];
    for (const crop of crops) {
      const canvas = document.createElement("canvas");
      canvas.width = crop.rect.width;
      canvas.height = crop.rect.height;
      const context = canvas.getContext("2d");
      if (context === null) return null;
      context.imageSmoothingEnabled = false;
      context.drawImage(
        image,
        crop.rect.x,
        crop.rect.y,
        crop.rect.width,
        crop.rect.height,
        0,
        0,
        crop.rect.width,
        crop.rect.height,
      );
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob === null) return null;
      out.push([crop.path, new Uint8Array(await blob.arrayBuffer())]);
    }
    return out;
  } finally {
    image.close();
  }
}

/** Convert compact source files with the same plan the Node exporter uses. */
export const browserLinoleumConverter: LinoleumConverter = async ({ source, resolve }) => {
  const image = await readBytes(resolve, source.image);
  if (image === null) return null;
  const prefBodies = await Promise.all(source.prefFiles.map((path) => readBytes(resolve, path)));
  if (prefBodies.some((body) => body === null)) return null;
  let bitmap: ImageBitmap;
  try {
    if (typeof createImageBitmap !== "function") return null;
    bitmap = await createImageBitmap(new Blob([blobPart(image)], { type: "image/png" }));
  } catch {
    return null;
  }
  const prefSources: PrefSource[] = source.prefFiles.map((name, index) => ({
    name: name.split("/").at(-1) ?? name,
    lines: new TextDecoder().decode(prefBodies[index]!).split(/\r\n|\n|\r/),
  }));
  const config: PackConfig = {
    key: source.key,
    packId: source.packId,
    displayName: source.displayName,
    sourceMode: source.key,
    sourceDirectory: "",
    imageFile: source.image,
    resolution: source.resolution,
    ...(source.tileWidth === undefined ? {} : { tileWidth: source.tileWidth }),
    ...(source.tileHeight === undefined ? {} : { tileHeight: source.tileHeight }),
    ...(source.overdrawRow === undefined ? {} : { overdrawRow: source.overdrawRow }),
    ...(source.overdrawMax === undefined ? {} : { overdrawMax: source.overdrawMax }),
    primaryPref: prefSources[0]?.name ?? "",
    prefFiles: prefSources.map((pref) => pref.name),
  };
  const plan = planTilesheetConversion({
    pack: config,
    prefSources,
    sheetWidth: bitmap.width,
    sheetHeight: bitmap.height,
  });
  bitmap.close();
  const cropped = await canvasCrop(image, plan.crops);
  if (cropped === null) return null;
  /* Prefs are mirrored byte-for-byte, just as the Node exporter copies them,
   * rather than being decoded and re-encoded through the planning API. */
  const out: Array<readonly [string, Uint8Array]> = source.prefFiles.map((path, index) => [
    prefSources[index]!.name,
    prefBodies[index]!,
  ] as const);
  out.push(...[...plan.files].map(([path, text]) => [path, new TextEncoder().encode(text)] as const));
  out.push(...cropped);
  return out;
};

/**
 * Return the generated loose-pack resolver.  A cache hit reads only manifest.txt;
 * a miss runs the converter exactly once and atomically stores every generated
 * file.  If persistent storage is unavailable the generated map stays usable for
 * this selection but is honestly not retained for a later launch.
 */
export async function ensureLinoleumTilesheetPack(input: {
  modId: string;
  source: LinoleumTilesheetSource;
  resolve: PackFileResolver;
  scope?: unknown;
  cache?: LinoleumCacheStore | null;
  converter?: LinoleumConverter;
}): Promise<PackFileResolver> {
  const persistent = input.cache === undefined ? await idbCache(input.scope ?? globalThis) : input.cache;
  const cache = persistent ?? memoryCache();
  const prefix = cachePrefix(input.modId, input.source);
  if (await cache.get(`${prefix}manifest.txt`) !== null) return cachedResolver(cache, prefix);
  const produced = await (input.converter ?? browserLinoleumConverter)({
    source: input.source,
    resolve: input.resolve,
  });
  if (produced === null || produced.length === 0) return input.resolve;
  const entries = produced.map(([path, body]) => [`${prefix}${path}`, body] as const);
  if (await cache.put(entries)) return cachedResolver(cache, prefix);
  /* A quota refusal must not turn a selected tileset into raw source files.
   * It is still usable for this selection, just not retained past this page. */
  const transient = memoryCache();
  await transient.put(entries);
  return cachedResolver(transient, prefix);
}
