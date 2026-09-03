import { cloneWorkerJson } from "./clone";
import type { WorkerJson } from "./protocol";

export type SnapshotDomain = "engine.facts";
export type WorkerHook = "artifact.commit";
export type WorkerPolicy = "object-list.order-v1";

export interface RegionCell {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly style?: { readonly fg?: string; readonly bg?: string; readonly bold?: boolean };
}

export interface RegionDeclaration {
  readonly id: string;
  readonly layer: "hud" | "overlay";
  readonly placement: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly inputActions: readonly string[];
}

export interface CommandDeclaration {
  readonly id: string;
  readonly verb: string;
  readonly input: "none" | "direction";
  readonly intentCodes: readonly string[];
}

export interface ModWorkerTransportDeps {
  readonly snapshots?: Partial<Record<SnapshotDomain, () => { readonly revision: number; readonly data: WorkerJson }>>;
  readonly commands?: {
    register(code: string, action: () => number): void;
    revoke?(code: string): void;
    setVerb?(code: string, verb: string): void;
  };
  readonly onCommandIntent?: (pluginId: string, commandId: string, intentCode: string) => void;
  readonly hookTimeoutMs?: number;
  readonly onProblem?: (pluginId: string, message: string) => void;
}

interface HookPeer {
  readonly pluginId: string;
  readonly loadOrder: number;
  readonly request: (hook: WorkerHook, sequence: number, input: WorkerJson) => Promise<HookResult>;
}

interface HookResult { readonly decision: "allow" | "deny"; readonly patch?: WorkerJson; }

/**
 * Host-owned stores for API-2's declarative surfaces. Workers only write cloned
 * records here; hot paths read these caches synchronously and never message a
 * Worker.
 */
export class ModWorkerTransport {
  private readonly snapshots: Record<SnapshotDomain, () => { readonly revision: number; readonly data: WorkerJson }>;
  private readonly policies = new Map<WorkerPolicy, Map<string, { revision: number; body: WorkerJson; loadOrder: number }>>();
  private readonly hooks = new Map<string, HookPeer>();
  private readonly declarations = new Map<string, CommandDeclaration>();
  private readonly regions = new Map<string, { declaration: RegionDeclaration; cells: readonly RegionCell[]; visible: boolean }>();

  constructor(private readonly deps: ModWorkerTransportDeps = {}) {
    this.snapshots = {
      "engine.facts": () => ({
        revision: 1,
        data: { commandFallbackVerb: "do that with", objectListCoordinates: ["dy", "dx"] },
      }),
      ...deps.snapshots,
    };
  }

  snapshot(domain: string, _revision: number | undefined, _selector: WorkerJson): { revision: number; data: WorkerJson } {
    if (!isSnapshotDomain(domain)) throw new Error("query.snapshot requires an allow-listed domain");
    if (!validSnapshotSelector(domain, _selector)) throw new Error("query.snapshot selector does not match its domain grammar");
    const snapshot = this.snapshots[domain]();
    return { revision: snapshot.revision, data: cloneWorkerJson(snapshot.data) };
  }

  installPolicy(pluginId: string, loadOrder: number, policy: string, revision: number, body: WorkerJson): void {
    if (policy !== "object-list.order-v1" || !Number.isInteger(revision) || revision < 0 || !validOrderPolicy(body)) {
      throw new Error("policy.install requires a known policy and its declared grammar");
    }
    const entries = this.policies.get(policy) ?? new Map();
    entries.set(pluginId, { revision, body: cloneWorkerJson(body), loadOrder });
    this.policies.set(policy, entries);
  }

  /** Later load-order policies are primary keys, like composeModHooks' comparator fold. */
  compareObjectList(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): number {
    const entries = [...(this.policies.get("object-list.order-v1")?.values() ?? [])].sort((x, y) => y.loadOrder - x.loadOrder);
    for (const entry of entries) {
      const keys = (entry.body as { keys: string[] }).keys;
      for (const key of keys) {
        const result = (a[key] ?? 0) - (b[key] ?? 0);
        if (result !== 0) return result;
      }
    }
    return 0;
  }

  addHookPeer(peer: HookPeer): void { this.hooks.set(peer.pluginId, peer); }
  removePlugin(pluginId: string): void {
    this.hooks.delete(pluginId);
    for (const entries of this.policies.values()) entries.delete(pluginId);
    for (const key of [...this.declarations.keys()]) if (key.startsWith(`${pluginId}:`)) this.revoke(pluginId, "command", key.slice(pluginId.length + 1));
    for (const key of [...this.regions.keys()]) if (key.startsWith(`${pluginId}:`)) this.regions.delete(key);
  }

  /** artifactCommit's all-must-agree fold: load order, serial, first denial wins. */
  async artifactCommit(input: { artifactIndex: number; alreadyCreated: boolean }): Promise<boolean> {
    let sequence = 0;
    for (const peer of [...this.hooks.values()].sort((a, b) => a.loadOrder - b.loadOrder)) {
      sequence += 1;
      const result = await this.withTimeout(peer, "artifact.commit", sequence, input);
      if (result.decision === "deny") return false;
    }
    return true;
  }

  declare(pluginId: string, kind: string, id: string, definition: WorkerJson): void {
    if (kind !== "command" || !validId(id) || !validCommand(definition)) throw new Error("registry.declare requires a declared kind grammar");
    const command = cloneWorkerJson(definition) as unknown as CommandDeclaration;
    const key = `${pluginId}:${id}`;
    this.declarations.set(key, command);
    this.deps.commands?.register(id, () => {
      this.deps.onCommandIntent?.(pluginId, id, command.intentCodes[0] ?? "");
      return 0;
    });
    this.deps.commands?.setVerb?.(id, command.verb);
  }

  revoke(pluginId: string, kind: string, id: string): void {
    if (kind !== "command" || !validId(id)) throw new Error("registry.revoke requires a declared kind and id");
    if (!this.declarations.delete(`${pluginId}:${id}`)) return;
    this.deps.commands?.revoke?.(id);
  }

  hasCommand(pluginId: string, id: string): boolean { return this.declarations.has(`${pluginId}:${id}`); }
  declareRegion(pluginId: string, declaration: WorkerJson): void {
    if (!validRegionDeclaration(declaration)) throw new Error("ui.region.declare requires a bounded region grammar");
    const region = cloneWorkerJson(declaration) as unknown as RegionDeclaration;
    this.regions.set(`${pluginId}:${region.id}`, { declaration: region, cells: [], visible: true });
  }
  patchRegion(pluginId: string, id: string, patch: WorkerJson): void {
    if (!validId(id) || !validRegionPatch(patch)) throw new Error("ui.region.patch requires bounded display cells");
    const region = this.regions.get(`${pluginId}:${id}`);
    if (!region) throw new Error("ui.region.patch requires a declared own region");
    this.regions.set(`${pluginId}:${id}`, { ...region, cells: cloneWorkerJson((patch as { cells: WorkerJson }).cells) as unknown as RegionCell[], visible: (patch as { visible?: boolean }).visible ?? region.visible });
  }
  paintRegion(pluginId: string, id: string, paint: (cell: RegionCell) => void): void {
    const region = this.regions.get(`${pluginId}:${id}`);
    if (!region || !region.visible) return;
    for (const cell of region.cells) paint(cell);
  }

  private async withTimeout(peer: HookPeer, hook: WorkerHook, sequence: number, input: WorkerJson): Promise<HookResult> {
    const timeoutMs = this.deps.hookTimeoutMs ?? 5000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        peer.request(hook, sequence, cloneWorkerJson(input)),
        new Promise<HookResult>((resolve) => { timeout = setTimeout(() => resolve({ decision: "allow" }), timeoutMs); }),
      ]);
    } catch (error) {
      this.deps.onProblem?.(peer.pluginId, `hook ${hook} failed: ${error instanceof Error ? error.message : String(error)}`);
      return { decision: "allow" };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

export function isSnapshotDomain(value: string): value is SnapshotDomain { return value === "engine.facts"; }
export function validId(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value); }
function validSnapshotSelector(domain: SnapshotDomain, value: WorkerJson): boolean { return domain === "engine.facts" && record(value) && Object.keys(value).length === 0; }
function validOrderPolicy(value: unknown): boolean { return record(value) && Object.keys(value).length === 1 && Array.isArray(value.keys) && value.keys.length > 0 && value.keys.length <= 4 && value.keys.every((key: unknown) => key === "dy" || key === "dx"); }
function validCommand(value: unknown): boolean { return record(value) && only(value, ["id", "verb", "input", "intentCodes"]) && validId(value.id) && typeof value.verb === "string" && value.verb.length > 0 && value.verb.length <= 64 && (value.input === "none" || value.input === "direction") && Array.isArray(value.intentCodes) && value.intentCodes.length > 0 && value.intentCodes.length <= 8 && value.intentCodes.every(validId); }
function validRegionDeclaration(value: unknown): boolean { if (!record(value) || !only(value, ["id", "layer", "placement", "inputActions"]) || !validId(value.id) || (value.layer !== "hud" && value.layer !== "overlay") || !record(value.placement) || !only(value.placement, ["x", "y", "width", "height"]) || ![value.placement.x, value.placement.y, value.placement.width, value.placement.height].every((n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 500) || !Array.isArray(value.inputActions) || value.inputActions.length > 16 || !value.inputActions.every(validId)) return false; return (value.placement.width as number) > 0 && (value.placement.height as number) > 0; }
function validRegionPatch(value: unknown): boolean { return record(value) && only(value, ["cells", "visible"]) && Array.isArray(value.cells) && value.cells.length <= 1024 && (value.visible === undefined || typeof value.visible === "boolean") && value.cells.every((cell: unknown) => record(cell) && only(cell, ["x", "y", "text", "style"]) && Number.isInteger(cell.x) && Number.isInteger(cell.y) && typeof cell.text === "string" && cell.text.length <= 256 && (cell.style === undefined || (record(cell.style) && only(cell.style, ["fg", "bg", "bold"]) && (cell.style.fg === undefined || typeof cell.style.fg === "string") && (cell.style.bg === undefined || typeof cell.style.bg === "string") && (cell.style.bold === undefined || typeof cell.style.bold === "boolean")))); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
