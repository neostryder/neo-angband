/**
 * The archive checks: a .zip a mod declares in `payload.archives`, read from its
 * central directory and measured entry by entry before anything inside it is
 * trusted. Pure JavaScript; deflated entries are inflated with the platform's
 * DecompressionStream, so the same code runs in Node and in a browser.
 */

import type { ModFinding } from "../mod-findings.js";
import { payloadPathProblem } from "./package-rules.js";
import { ARCHIVE_LIMITS, finding } from "./subject.js";

/** What reading one archive gives back. */
export interface ArchiveReading {
  readonly findings: ModFinding[];
  /** The files the archive unpacks to, when it could be read. Directories are left out. */
  readonly entries: Array<readonly [string, Uint8Array]>;
  /** Entries listed but not inflated, so their contents went unchecked. */
  readonly unread: string[];
}

interface CentralEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressed: number;
  readonly size: number;
  readonly localOffset: number;
  readonly symlink: boolean;
}

type Decompressor = new (format: string) => {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
};

const u16 = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, at: number): number => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = new TextDecoder("utf-8");
const latin1 = new TextDecoder("latin1");

/** Inflate raw deflate data, stopping as soon as the output passes `limit` bytes. */
async function inflateRaw(
  Ctor: Decompressor,
  data: Uint8Array,
  limit: number,
): Promise<{ readonly bytes: Uint8Array } | { readonly over: number } | { readonly error: string }> {
  let stream: InstanceType<Decompressor>;
  try {
    stream = new Ctor("deflate-raw");
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const writer = stream.writable.getWriter();
  writer.write(data).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return { over: total };
      }
      chunks.push(value);
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return { bytes: out };
}

/** The platform's raw-deflate decoder, or undefined when it has none. */
function deflateDecoder(): Decompressor | undefined {
  const Ctor = (globalThis as { DecompressionStream?: Decompressor }).DecompressionStream;
  if (Ctor === undefined) return undefined;
  try {
    new Ctor("deflate-raw");
    return Ctor;
  } catch {
    return undefined;
  }
}

/** The central directory, or why it cannot be read. */
function centralDirectory(bytes: Uint8Array): { readonly entries: CentralEntry[] } | { readonly problem: string; readonly zip64?: true } {
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= floor; at--) {
    if (u32(bytes, at) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return { problem: "it has no end-of-directory record, so it is not a zip archive" };
  const count = u16(bytes, eocd + 10);
  const size = u32(bytes, eocd + 12);
  const offset = u32(bytes, eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    return { problem: "it is a ZIP64 archive", zip64: true };
  }
  if (offset + size > eocd) return { problem: "its directory points past the end of the file" };
  const entries: CentralEntry[] = [];
  let at = offset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== 0x02014b50) {
      return { problem: `directory entry ${i + 1} of ${count} is damaged` };
    }
    const madeBy = u16(bytes, at + 4);
    const flags = u16(bytes, at + 8);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const external = u32(bytes, at + 38);
    const rawName = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = (flags & 0x800 ? utf8 : latin1).decode(rawName);
    const unixMode = (madeBy >>> 8) === 3 ? external >>> 16 : 0;
    entries.push({
      name,
      flags,
      method: u16(bytes, at + 10),
      crc: u32(bytes, at + 16),
      compressed: u32(bytes, at + 20),
      size: u32(bytes, at + 24),
      localOffset: u32(bytes, at + 42),
      symlink: (unixMode & 0o170000) === 0o120000,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { entries };
}

/**
 * Read and measure the archive `archive` (its path in the repository). Every
 * problem comes back as a finding; the entries come back only when they could
 * all be trusted.
 */
export async function readModArchive(archive: string, bytes: Uint8Array): Promise<ArchiveReading> {
  const findings: ModFinding[] = [];
  const entries: Array<readonly [string, Uint8Array]> = [];
  const unread: string[] = [];
  const at = (name?: string): { file: string; excerpt?: string } => (name === undefined ? { file: archive } : { file: archive, excerpt: name });

  if (bytes.length > ARCHIVE_LIMITS.maxArchiveBytes) {
    findings.push(finding("archive-size", `${archive} is ${bytes.length} bytes; an archive may be at most ${ARCHIVE_LIMITS.maxArchiveBytes}.`, { evidence: [at()] }));
    return { findings, entries, unread };
  }
  const directory = centralDirectory(bytes);
  if ("problem" in directory) {
    if (directory.zip64) {
      findings.push(finding("archive-unmeasured", `${archive} could not be measured: ${directory.problem}, which this checker does not read.`, { evidence: [at()] }));
    } else {
      findings.push(finding("archive-unreadable", `${archive} cannot be read: ${directory.problem}.`, { evidence: [at()] }));
    }
    return { findings, entries, unread };
  }
  const list = directory.entries;
  if (list.length > ARCHIVE_LIMITS.maxEntries) {
    findings.push(finding("archive-size", `${archive} holds ${list.length} entries; the limit is ${ARCHIVE_LIMITS.maxEntries}.`, { evidence: [at()] }));
  }

  const seen = new Map<string, string>();
  const spans: Array<{ readonly start: number; readonly end: number; readonly name: string }> = [];
  let declaredTotal = 0;
  let trusted = true;
  const files: Array<{ readonly entry: CentralEntry; readonly dataStart: number }> = [];

  for (const entry of list) {
    const isDir = entry.name.endsWith("/");
    const path = isDir ? entry.name.slice(0, -1) : entry.name;
    const problem = payloadPathProblem(path);
    if (problem !== null) {
      findings.push(finding("archive-path", `${archive} has an entry named ${JSON.stringify(entry.name)}: ${problem}.`, { evidence: [at(entry.name)] }));
      trusted = false;
      continue;
    }
    const folded = entry.name.toLowerCase();
    const earlier = seen.get(folded);
    if (earlier !== undefined) {
      findings.push(finding("archive-duplicate", earlier === entry.name
        ? `${archive} holds ${entry.name} twice.`
        : `${archive} holds ${entry.name} and ${earlier}, which differ only in case.`, { evidence: [at(entry.name)] }));
      trusted = false;
      continue;
    }
    seen.set(folded, entry.name);
    if (entry.symlink) {
      findings.push(finding("archive-entry-type", `${entry.name} in ${archive} is a symbolic link.`, { evidence: [at(entry.name)] }));
      trusted = false;
      continue;
    }
    if (entry.flags & 1) {
      findings.push(finding("archive-entry-type", `${entry.name} in ${archive} is encrypted.`, { evidence: [at(entry.name)] }));
      trusted = false;
      continue;
    }
    if (entry.method !== 0 && entry.method !== 8) {
      findings.push(finding("archive-entry-type", `${entry.name} in ${archive} uses compression method ${entry.method}; only stored (0) and deflated (8) entries can be read.`, { evidence: [at(entry.name)] }));
      trusted = false;
      continue;
    }
    const local = entry.localOffset;
    if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) {
      findings.push(finding("archive-unreadable", `${entry.name} in ${archive} has no local header where the directory says.`, { evidence: [at(entry.name)] }));
      trusted = false;
      continue;
    }
    const localNameLength = u16(bytes, local + 26);
    const localName = (u16(bytes, local + 6) & 0x800 ? utf8 : latin1).decode(bytes.subarray(local + 30, local + 30 + localNameLength));
    const localMethod = u16(bytes, local + 8);
    if (localName !== entry.name || localMethod !== entry.method) {
      findings.push(finding("archive-bomb", `${entry.name} in ${archive} has a local header that disagrees with the directory (${JSON.stringify(localName)}, method ${localMethod}).`, { evidence: [at(entry.name)] }));
      trusted = false;
      continue;
    }
    const dataStart = local + 30 + localNameLength + u16(bytes, local + 28);
    const dataEnd = dataStart + entry.compressed;
    if (dataEnd > bytes.length) {
      findings.push(finding("archive-unreadable", `${entry.name} in ${archive} runs past the end of the file.`, { evidence: [at(entry.name)] }));
      trusted = false;
      continue;
    }
    spans.push({ start: local, end: dataEnd, name: entry.name });
    if (isDir) continue;
    declaredTotal += entry.size;
    if (entry.size > Math.max(entry.compressed, 1) * ARCHIVE_LIMITS.maxRatio) {
      findings.push(finding("archive-bomb", `${entry.name} in ${archive} claims to inflate from ${entry.compressed} to ${entry.size} bytes, more than ${ARCHIVE_LIMITS.maxRatio} times its size.`, {
        evidence: [at(entry.name)],
      }));
      trusted = false;
      continue;
    }
    if (entry.size > ARCHIVE_LIMITS.maxFileBytes) {
      findings.push(finding("archive-size", `${entry.name} in ${archive} is ${entry.size} bytes once unpacked; one file may be at most ${ARCHIVE_LIMITS.maxFileBytes}.`, { evidence: [at(entry.name)] }));
      trusted = false;
      continue;
    }
    files.push({ entry, dataStart });
  }
  if (declaredTotal > ARCHIVE_LIMITS.maxTotalBytes) {
    findings.push(finding("archive-size", `${archive} unpacks to ${declaredTotal} bytes; the limit is ${ARCHIVE_LIMITS.maxTotalBytes}.`, { evidence: [at()] }));
    trusted = false;
  }
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1] as (typeof spans)[number];
    const next = spans[i] as (typeof spans)[number];
    if (next.start < prev.end) {
      findings.push(finding("archive-bomb", `${prev.name} and ${next.name} in ${archive} share the same bytes, the shape of an archive bomb.`, { evidence: [at(prev.name), at(next.name)] }));
      trusted = false;
    }
  }
  if (!trusted) return { findings, entries, unread };

  const Ctor = deflateDecoder();
  let unmeasured = false;
  for (const { entry, dataStart } of files) {
    const raw = bytes.subarray(dataStart, dataStart + entry.compressed);
    let content: Uint8Array;
    if (entry.method === 0) {
      if (entry.compressed !== entry.size) {
        findings.push(finding("archive-bomb", `${entry.name} in ${archive} is stored uncompressed but states two different sizes.`, { evidence: [at(entry.name)] }));
        continue;
      }
      content = raw.slice();
    } else {
      if (Ctor === undefined) {
        unmeasured = true;
        unread.push(entry.name);
        continue;
      }
      const result = await inflateRaw(Ctor, raw, entry.size);
      if ("over" in result) {
        findings.push(finding("archive-bomb", `${entry.name} in ${archive} inflates past the ${entry.size} bytes its header states.`, {
          evidence: [at(entry.name)],
          reproduction: `Inflating ${entry.name} produced more than ${entry.size} bytes before it was stopped.`,
        }));
        continue;
      }
      if ("error" in result) {
        findings.push(finding("archive-unreadable", `${entry.name} in ${archive} cannot be inflated: ${result.error}.`, { evidence: [at(entry.name)] }));
        continue;
      }
      content = result.bytes;
      if (content.length !== entry.size) {
        findings.push(finding("archive-unreadable", `${entry.name} in ${archive} inflates to ${content.length} bytes, not the ${entry.size} its header states.`, { evidence: [at(entry.name)] }));
        continue;
      }
    }
    if (crc32(content) !== entry.crc) {
      findings.push(finding("archive-unreadable", `${entry.name} in ${archive} fails its checksum.`, { evidence: [at(entry.name)] }));
      continue;
    }
    entries.push([entry.name, content]);
  }
  if (unmeasured) {
    findings.push(finding("archive-unmeasured", `${archive}: this platform has no deflate decoder, so ${unread.length} entries were not inflated or checked.`, {
      evidence: [at()],
    }));
  }
  return { findings, entries, unread };
}
