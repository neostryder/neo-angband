/**
 * The preload and main process share these argument checks because every page script can call the bridges.
 *
 * The page can call every function the preload exposes. These checks reject a
 * path, a command string, or a batch that is not the shape the game itself sends.
 * They do not decide whether the player allowed the action. Quit and update
 * still ask in the main process, because a check here cannot draw that dialog.
 */

const UPDATE_TAG = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/u;
const MEASURED_DIGEST = /^[a-f0-9]{64}$/u;
export const MOD_AUTHORITY_CHANNEL = "neo-mod-authority";

export interface MeasuredCaller {
  readonly modId: string;
  readonly digest: string;
}

/**
 * The page can name any mod in a consent call. The preload substitutes the caller
 * the host armed, and drops the token before the main process sees the report.
 */
export function applyMeasuredConsent(arg: unknown, caller: MeasuredCaller | null): Record<string, unknown> | null {
  if (!caller || !MEASURED_DIGEST.test(caller.digest)) return null;
  if (!arg || typeof arg !== "object" || Array.isArray(arg)) return null;
  const a = arg as Record<string, unknown>;
  if (a["hostPurpose"] !== undefined) return null;
  const next: Record<string, unknown> = { ...a, modId: caller.modId, digest: caller.digest };
  delete next["measuredToken"];
  return next;
}

/**
 * Turn a page's consent request into an authority report, or null to refuse it.
 * A host purpose request marked `quiet` comes from a query that must never open a
 * dialog (the boot-time sync check, the Mods screen's folder name). It is refused
 * outright unless the player has already chosen a folder for this installation,
 * so a player who never set up profile sync, and an unattended lab run, never
 * see the native prompt.
 */
export function desktopConsentReport(
  arg: unknown,
  hostDigest: () => string,
  remembered: (modId: string, digest: string) => boolean = () => true,
): unknown {
  if (!arg || typeof arg !== "object" || Array.isArray(arg)) return null;
  const a = arg as Record<string, unknown>;
  if (a["hostPurpose"] !== undefined) {
    if (a["hostPurpose"] !== "mod-profile-sync" || Object.keys(a).some((key) => !["hostPurpose", "installation", "quiet"].includes(key))) return null;
    if (a["quiet"] !== undefined && a["quiet"] !== true) return null;
    try {
      const modId = "@host/mod-profile-sync";
      const digest = hostDigest();
      if (a["quiet"] === true && !remembered(modId, digest)) return null;
      return { modId, digest, grants: ["backup:folder"], destinations: [], installation: a["installation"], ...(a["quiet"] === true ? { quiet: true } : {}) };
    } catch { return null; }
  }
  return typeof a["modId"] === "string" && a["modId"].startsWith("@host/") ? null : arg;
}
const RESERVED_LEAF = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])[ .]*(\.|$)/iu;

const HOST_DIRS = new Set(["user", "save", "panic", "scores", "archive"]);

const LEAF_OPS = new Set(["displayPath", "isFile", "readText", "writeText", "unlink", "rename", "mtime"]);

export function isSafeHostLeaf(name: unknown): name is string {
  if (typeof name !== "string" || name.length < 1 || name.length > 255) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0") || name.includes(":")) return false;
  if (name === "." || name === ".." || name.includes("..")) return false;
  if (name.endsWith(" ") || name.endsWith(".")) return false;
  if (/[<>"|?*]/u.test(name) || [...name].some((char) => char.charCodeAt(0) < 32)) return false;
  if (RESERVED_LEAF.test(name)) return false;
  return true;
}

export function hostFsFailure(op: unknown): unknown {
  if (op === "listFiles") return [];
  if (op === "readText" || op === "mtime") return null;
  if (op === "writeText") return "create-failed";
  if (op === "displayPath") return "";
  return false;
}

export function hostFsCallIsSafe(op: unknown, args: unknown): boolean {
  if (typeof op !== "string" || !Array.isArray(args)) return false;
  if (typeof args[0] !== "string" || !HOST_DIRS.has(args[0])) return false;
  if (op === "listFiles") return args.length === 1;
  if (!LEAF_OPS.has(op)) return false;
  if (!isSafeHostLeaf(args[1])) return false;
  if (op === "rename") return args.length === 3 && isSafeHostLeaf(args[2]);
  if (op === "writeText") {
    if (typeof args[2] !== "string" || args[2].length > 16 * 1024 * 1024 || args.length > 5) return false;
    if (args.length >= 4 && typeof args[3] !== "boolean") return false;
    if (args.length === 5 && (typeof args[4] !== "number" || !Number.isInteger(args[4]) || args[4] < 1 || args[4] > 4)) return false;
    return true;
  }
  return args.length === 2;
}

/**
 * The updater chooses its own archive, so the page can name only a release tag.
 */
export function updateCallIsSafe(op: unknown, arg: unknown): boolean {
  if (op === "shape" || op === "apply") return arg === undefined || arg === null;
  if (op === "download") return typeof arg === "string" && UPDATE_TAG.test(arg) && !arg.includes("..");
  if (op === "reveal") {
    if (arg === undefined) return true;
    if (typeof arg !== "string" || arg.length > 2048 || /[\r\n\0]/u.test(arg)) return false;
    try {
      const url = new URL(arg);
      return url.protocol === "https:" && url.host === "github.com" && !url.username && !url.password &&
        (url.pathname === "/neostryder/neo-angband/releases" || url.pathname.startsWith("/neostryder/neo-angband/releases/"));
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * A mixed or oversized batch is dropped whole so a rejected call cannot partly write the log.
 */
export function capLogBatch(payload: unknown): string[] | null {
  if (!Array.isArray(payload) || payload.length > 2000) return null;
  const out: string[] = [];
  let bytes = 0;
  for (const line of payload) {
    if (typeof line !== "string") return null;
    if (line.length > 8000) return null;
    const size = new TextEncoder().encode(line).length;
    if (bytes + size > 1024 * 1024) return null;
    out.push(line);
    bytes += size;
  }
  return out;
}

export async function confirmHostAction(
  show: (options: { type: "question"; title: string; message: string; buttons: string[]; defaultId: number; cancelId: number }) => Promise<{ response: number }>,
  message: string,
  accept: string,
): Promise<boolean> {
  try {
    const result = await show({ type: "question", title: "Neo Angband", message, buttons: [accept, "Cancel"], defaultId: 1, cancelId: 1 });
    return result.response === 0;
  } catch {
    return false;
  }
}
