/**
 * Generate a Linoleum loose pack from a mod's compact source tilesheet on first
 * selection, then keep its generated files in IndexedDB.  The mod installer owns
 * downloaded source bytes; this store owns only a derived cache, partitioned by
 * the mod id and a source revision supplied in the manifest.
 */

import { planTilesheetConversion, tileMapDocumentText } from "@rpgm-tools/neo-angband-linoleum/conversion-plan";
import type { PackConfig } from "@rpgm-tools/neo-angband-linoleum";
import type { PrefSource } from "@rpgm-tools/neo-angband-linoleum";
import { parsePoolsFile, parseTargetsFile } from "@rpgm-tools/neo-angband-linoleum/targets";
import {
  linoleumPackFormat,
  linoleumTileMapFormat,
  parseDocument,
  serializeDocument,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { Infer, LinoleumTilesheetSource } from "@rpgm-tools/neo-angband-mod-sdk";
import { STORE_LINOLEUM, idbDelete, idbGet, idbPutMany, openDb } from "./idb";
import type { PackFileResolver } from "./pack-files";
import { assetMime } from "./pack-files";
import { parseFamiliesFile, parseLinoleumManifest, parseTallFile } from "./linoleum-pack";

export interface LinoleumCacheStore {
  get(key: string): Promise<Uint8Array | null>;
  put(entries: ReadonlyArray<readonly [string, Uint8Array]>): Promise<boolean>;
  /** Drop keys after a converted document has been read back. */
  remove(keys: readonly string[]): Promise<boolean>;
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
    async remove(keys) {
      for (const key of keys) files.delete(key);
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
    async remove(keys) {
      for (const key of keys) await idbDelete(db, STORE_LINOLEUM, key);
      return true;
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

/** Rebuild selector inputs from a validated compact tile-map document. */
export function tileMapPrefSources(data: Infer<(typeof linoleumTileMapFormat)["validator"]>): PrefSource[] | null {
  const sources: PrefSource[] = [];
  for (const file of data.files) {
    const lines: string[] = [];
    for (const selector of file.selectors) {
      if (selector.row > 127 || selector.column > 127) return null;
      const suffix = selector.condition === undefined ? "" : `:when:${selector.condition}`;
      if (suffix && !selector.selector.endsWith(suffix)) return null;
      const value = suffix ? selector.selector.slice(0, -suffix.length) : selector.selector;
      if (selector.condition !== undefined) lines.push(`?:${selector.condition}`);
      lines.push(`${selector.type}:${value}:${selector.row}:${selector.column}`);
    }
    sources.push({ name: file.name, lines });
  }
  return sources;
}

/** Convert compact source files with the same plan the Node exporter uses. */
export const browserLinoleumConverter: LinoleumConverter = async ({ source, resolve }) => {
  const image = await readBytes(resolve, source.image);
  if (image === null) return null;
  let prefSources: PrefSource[];
  if (source.tileMap !== undefined) {
    const body = await readBytes(resolve, source.tileMap);
    if (body === null) return null;
    const parsed = parseDocument(new TextDecoder().decode(body), linoleumTileMapFormat);
    if (!parsed.ok) return null;
    const sources = tileMapPrefSources(parsed.data);
    if (sources === null) return null;
    prefSources = sources;
  } else {
    const names = source.prefFiles ?? [];
    const prefBodies = await Promise.all(names.map((path) => readBytes(resolve, path)));
    if (prefBodies.some((body) => body === null)) return null;
    prefSources = names.map((name, index) => ({
      name: name.split("/").at(-1) ?? name,
      lines: new TextDecoder().decode(prefBodies[index]!).split(/\r\n|\n|\r/),
    }));
  }
  let bitmap: ImageBitmap;
  try {
    if (typeof createImageBitmap !== "function") return null;
    bitmap = await createImageBitmap(new Blob([blobPart(image)], { type: "image/png" }));
  } catch {
    return null;
  }
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
  /* The plan already carries pack.json and tile-map.json. */
  const out: Array<readonly [string, Uint8Array]> = [...plan.files].map(
    ([path, text]) => [path, new TextEncoder().encode(text)] as const,
  );
  out.push(...cropped);
  return out;
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

async function cachedText(store: LinoleumCacheStore, key: string): Promise<string | null> {
  const body = await store.get(key);
  return body === null ? null : textDecoder.decode(body);
}

/**
 * Turn a cache that still holds the text maps into pack.json, then drop the
 * old keys. Returns false without writing when the old files cannot become a
 * valid document, so a broken cache is not replaced with a guess.
 */
async function convertLegacyCache(
  cache: LinoleumCacheStore,
  prefix: string,
  source: LinoleumTilesheetSource,
): Promise<boolean> {
  const manifestText = await cachedText(cache, `${prefix}manifest.txt`);
  if (manifestText === null) return false;
  const manifest = parseLinoleumManifest(manifestText);
  if (manifest === null || manifest.format !== "png") return false;
  const targetsPath = manifest.maps.get("targets");
  if (targetsPath === undefined) return false;
  const targetsText = await cachedText(cache, `${prefix}${targetsPath}`);
  if (targetsText === null) return false;
  const named = async (kind: string): Promise<string | null | undefined> => {
    const path = manifest.maps.get(kind);
    if (path === undefined) return undefined;
    return cachedText(cache, `${prefix}${path}`);
  };
  const poolsText = await named("pools");
  const familiesText = await named("families");
  const tallText = await named("tall");
  if (poolsText === null || familiesText === null || tallText === null) return false;

  const families = familiesText === undefined
    ? []
    : [...parseFamiliesFile(familiesText).entries()].map(([id, family]) => ({
      id,
      asset: family.asset,
      ...(family.selection === undefined ? {} : { selection: family.selection }),
      ...(family.effect?.glowAlpha === undefined ? {} : { glowAlpha: family.effect.glowAlpha }),
      ...(family.effect?.tint === undefined ? {} : { tint: family.effect.tint }),
      ...(family.effect?.pulse === undefined ? {} : { pulse: family.effect.pulse }),
    }));
  const pools = poolsText === undefined
    ? []
    : parsePoolsFile(poolsText).map((pool) => ({
      id: pool.poolId,
      selection: pool.selection,
      members: [...pool.members],
    }));
  const tall = tallText === undefined ? [] : [...parseTallFile(tallText)];
  const data = {
    packId: manifest.packId,
    displayName: manifest.displayName,
    imageFormat: "png" as const,
    resolution: manifest.resolution,
    targets: parseTargetsFile(targetsText),
    ...(families.length === 0 ? {} : { families }),
    ...(pools.length === 0 ? {} : { pools }),
    ...(tall.length === 0 ? {} : { tall }),
  };
  let packJson: string;
  try {
    packJson = serializeDocument(linoleumPackFormat, data);
  } catch {
    return false;
  }
  if (!parseDocument(packJson, linoleumPackFormat).ok) return false;

  const entries: Array<readonly [string, Uint8Array]> = [
    [`${prefix}pack.json`, textEncoder.encode(packJson)],
  ];
  const prefSources: PrefSource[] = [];
  for (const path of source.prefFiles ?? []) {
    const name = path.split("/").at(-1) ?? path;
    const body = await cachedText(cache, `${prefix}${name}`);
    if (body === null) continue;
    prefSources.push({ name, lines: body.split(/\r\n|\n|\r/) });
  }
  let tileJson: string;
  try {
    tileJson = tileMapDocumentText(prefSources);
  } catch {
    return false;
  }
  if (!parseDocument(tileJson, linoleumTileMapFormat).ok) return false;
  entries.push([`${prefix}tile-map.json`, textEncoder.encode(tileJson)]);
  if (!await cache.put(entries)) return false;
  const back = await cachedText(cache, `${prefix}pack.json`);
  if (back === null || !parseDocument(back, linoleumPackFormat).ok) return false;
  const tileBack = await cachedText(cache, `${prefix}tile-map.json`);
  if (tileBack === null || !parseDocument(tileBack, linoleumTileMapFormat).ok) return false;

  const stale = [`${prefix}manifest.txt`, `${prefix}${targetsPath}`];
  for (const kind of ["pools", "families", "tall"]) {
    const path = manifest.maps.get(kind);
    if (path !== undefined) stale.push(`${prefix}${path}`);
  }
  for (const path of source.prefFiles ?? []) {
    stale.push(`${prefix}${path.split("/").at(-1) ?? path}`);
  }
  await cache.remove(stale);
  return true;
}

/**
 * Return the generated loose-pack resolver. A cache hit reads pack.json. A
 * cache that still holds the old text maps is converted once and rewritten.
 * A miss runs the converter exactly once. If persistent storage is
 * unavailable the generated map stays usable for this selection and is not
 * retained for a later launch.
 */
export async function ensureLinoleumTilesheetPack(input: {
  modId: string;
  source: LinoleumTilesheetSource;
  resolve: PackFileResolver;
  scope?: unknown;
  cache?: LinoleumCacheStore | null;
  converter?: LinoleumConverter;
  /** Called only for a cache miss, immediately before source-atlas conversion. */
  onConversionStart?: () => void;
  /** Paired with onConversionStart after conversion and cache persistence settle. */
  onConversionFinish?: () => void;
}): Promise<PackFileResolver> {
  const persistent = input.cache === undefined ? await idbCache(input.scope ?? globalThis) : input.cache;
  const cache = persistent ?? memoryCache();
  const prefix = cachePrefix(input.modId, input.source);
  if (await cache.get(`${prefix}pack.json`) !== null) return cachedResolver(cache, prefix);
  if (await cache.get(`${prefix}manifest.txt`) !== null) {
    const converted = await convertLegacyCache(cache, prefix, input.source);
    if (converted && await cache.get(`${prefix}pack.json`) !== null) {
      return cachedResolver(cache, prefix);
    }
  }
  input.onConversionStart?.();
  try {
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
  } finally {
    input.onConversionFinish?.();
  }
}
