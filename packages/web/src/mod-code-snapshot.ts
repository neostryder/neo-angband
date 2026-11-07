import { MOD_PERMISSION_TEXT, validateManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { DiskPackReport } from "./disk-packs";
import { buildModuleGraph } from "./mod-modules";
import { sha256Hex } from "./mod-install";
import { setConsentBindings } from "./mod-consent-binding";
import type { ModTier } from "./mod-tier";

interface Payload {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly digest: string;
  readonly urls: Map<string, string>;
  readonly codeUrls: Map<string, string>;
}

let payloads: ReadonlyMap<string, Payload> = new Map();

export function modPayloadDigest(id: string): string | null {
  return payloads.get(id)?.digest ?? null;
}

export function modPayloadBytes(id: string, file: string): Uint8Array | null {
  const bytes = payloads.get(id)?.files.get(file);
  return bytes ? new Uint8Array(bytes) : null;
}

export async function modPayloadUrl(id: string, file: string, code = false): Promise<string | null> {
  const payload = payloads.get(id);
  if (!payload?.files.has(file)) return null;
  const cached = (code ? payload.codeUrls : payload.urls).get(file);
  if (cached) return cached;
  if (code) {
    const graph = await buildModuleGraph(file, {
      read: async (path) => {
        const bytes = payload.files.get(path);
        return bytes ? new TextDecoder().decode(bytes) : null;
      },
      urlFor: (path, text) => {
        const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
        payload.codeUrls.set(path, url);
        return url;
      },
    });
    if (graph.problem) throw new Error(graph.problem);
    return graph.url;
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(payload.files.get(file)!).buffer]));
  payload.urls.set(file, url);
  return url;
}

export async function readModPayload(url: string, limit: number, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
    if (!response.ok || !response.body) throw new Error(MOD_PERMISSION_TEXT.unavailable);
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) > limit) throw new Error(MOD_PERMISSION_TEXT.quota);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > limit) { await reader.cancel(); throw new Error(MOD_PERMISSION_TEXT.quota); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally { clearTimeout(timeout); }
}

export async function prepareModPayloads(
  report: DiskPackReport,
  tierOf: (id: string) => ModTier,
  bytesOf: (url: string, limit: number, signal?: AbortSignal) => Promise<Uint8Array> = (url, limit, signal) => readModPayload(url, limit, fetch, signal),
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
  enabled?: (id: string) => boolean,
): Promise<void> {
  const next = new Map<string, Payload>();
  const bindings = new Map<string, string | null>();
  const controller = new AbortController();
  let totalSize = 0;
  let expired = false;
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { expired = true; controller.abort(); reject(new Error(MOD_PERMISSION_TEXT.quota)); }, 15000);
  });
  const bounded = <T>(work: Promise<T>): Promise<T> => Promise.race([work, deadline]);
  try {
    for (const pack of report.packs) {
      const id = pack.manifest.id;
      if (tierOf(id).trust === "first-party") continue;
      bindings.set(id, null);
      try {
        if (!subtle || !report.assetUrl || expired || totalSize >= 128 * 1024 * 1024 || (enabled && !enabled(id))) continue;
        const paths = [...new Set(["manifest.json", ...Object.keys(pack.files).map((key) => key + ".json"), ...pack.code, ...pack.assets])].sort();
        if (paths.length > 4096) continue;
        const files = new Map<string, Uint8Array>();
        const hashes: [string, string][] = new Array(paths.length);
        let size = 0;
        let cursor = 0;
        let failed = false;
        await Promise.all(Array.from({ length: Math.min(4, paths.length) }, async () => {
          try {
            while (!failed && cursor < paths.length) {
              const index = cursor++;
              const file = paths[index]!;
              const url = await bounded(report.assetUrl!(id, file));
              if (!url) throw new Error(MOD_PERMISSION_TEXT.unavailable);
              const limit = Math.min(64 * 1024 * 1024 - size, 128 * 1024 * 1024 - totalSize);
              const bytes = new Uint8Array(await bounded(bytesOf(url, limit, controller.signal)));
              size += bytes.length;
              totalSize += bytes.length;
              if (size > 64 * 1024 * 1024 || totalSize > 128 * 1024 * 1024) throw new Error(MOD_PERMISSION_TEXT.quota);
              files.set(file, bytes);
              hashes[index] = [file, await bounded(sha256Hex(bytes, subtle!))];
            }
          } catch { failed = true; }
        }));
        if (failed) continue;
        const text = (file: string): string => new TextDecoder().decode(files.get(file)!);
        const manifest = validateManifest(JSON.parse(text("manifest.json")), { code: [...pack.code] });
        if (JSON.stringify(manifest) !== JSON.stringify(pack.manifest)) continue;
        if (Object.entries(pack.files).some(([key, value]) => JSON.stringify(JSON.parse(text(key + ".json"))) !== JSON.stringify(value))) continue;
        const digest = await bounded(sha256Hex(new TextEncoder().encode(JSON.stringify(hashes)), subtle));
        const binding = await bounded(sha256Hex(new TextEncoder().encode(JSON.stringify([id, digest, tierOf(id).execution, [...new Set(pack.manifest.capabilities ?? [])].sort()])), subtle));
        const prior = payloads.get(id);
        next.set(id, prior?.digest === digest ? prior : { files, digest, urls: new Map(), codeUrls: new Map() });
        bindings.set(id, binding);
      } catch {
        // A partial payload cannot authorize any code or permission.
      }
    }
  } finally { clearTimeout(timeout!); }
  const previous = payloads;
  payloads = next;
  setConsentBindings(bindings);
  for (const [id, payload] of previous) {
    if (next.get(id) === payload) continue;
    for (const url of [...payload.urls.values(), ...payload.codeUrls.values()]) URL.revokeObjectURL(url);
  }
}
