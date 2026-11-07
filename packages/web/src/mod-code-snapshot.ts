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
  const cached = payload.urls.get(file);
  if (cached) return cached;
  if (code) {
    const graph = await buildModuleGraph(file, {
      read: async (path) => {
        const bytes = payload.files.get(path);
        return bytes ? new TextDecoder().decode(bytes) : null;
      },
      urlFor: (path, text) => {
        const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
        payload.urls.set(path, url);
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

export async function readModPayload(url: string, limit: number, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url, { signal: controller.signal });
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
  bytesOf: (url: string, limit: number) => Promise<Uint8Array> = readModPayload,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<void> {
  const next = new Map<string, Payload>();
  const bindings = new Map<string, string | null>();
  for (const pack of report.packs) {
    const id = pack.manifest.id;
    if (tierOf(id).trust === "first-party") continue;
    bindings.set(id, null);
    try {
      if (!subtle || !report.assetUrl) continue;
      const paths = [...new Set(["manifest.json", ...Object.keys(pack.files).map((key) => key + ".json"), ...pack.code, ...pack.assets])].sort();
      if (paths.length > 4096) continue;
      const files = new Map<string, Uint8Array>();
      const hashes: [string, string][] = [];
      let size = 0;
      for (const file of paths) {
        const url = await report.assetUrl(id, file);
        if (!url) throw new Error(MOD_PERMISSION_TEXT.unavailable);
        const bytes = new Uint8Array(await bytesOf(url, 64 * 1024 * 1024 - size));
        size += bytes.length;
        if (size > 64 * 1024 * 1024) throw new Error(MOD_PERMISSION_TEXT.quota);
        files.set(file, bytes);
        hashes.push([file, await sha256Hex(bytes, subtle)]);
      }
      const text = (file: string): string => new TextDecoder().decode(files.get(file)!);
      const manifest = validateManifest(JSON.parse(text("manifest.json")), { code: [...pack.code] });
      if (JSON.stringify(manifest) !== JSON.stringify(pack.manifest)) continue;
      if (Object.entries(pack.files).some(([key, value]) => JSON.stringify(JSON.parse(text(key + ".json"))) !== JSON.stringify(value))) continue;
      const digest = await sha256Hex(new TextEncoder().encode(JSON.stringify(hashes)), subtle);
      const binding = await sha256Hex(new TextEncoder().encode(JSON.stringify([id, digest, [...new Set(pack.manifest.capabilities ?? [])].sort()])), subtle);
      const prior = payloads.get(id);
      next.set(id, prior?.digest === digest ? prior : { files, digest, urls: new Map() });
      bindings.set(id, binding);
    } catch {
      // A partial payload cannot authorize any code or permission.
    }
  }
  const previous = payloads;
  payloads = next;
  setConsentBindings(bindings);
  for (const [id, payload] of previous) {
    if (next.get(id) === payload) continue;
    for (const url of payload.urls.values()) URL.revokeObjectURL(url);
  }
}
