/**
 * API-2 ordinary-plugin Worker wire contract.
 *
 * This protocol is deliberately separate from MOD_API_VERSION. The manifest
 * selects the plugin ABI; this version changes only when these messages change
 * incompatibly. Every value is structured-clone data, never a host handle.
 */

export const MOD_WORKER_PROTOCOL_VERSION = "1.1.0";

export type WorkerLogLevel = "info" | "warn" | "error";
export type WorkerJson = null | boolean | number | string | WorkerJson[] | { [key: string]: WorkerJson };

/** The small, reactive read model exposed by the initial Worker ABI. */
export interface ModStateSnapshot {
  readonly turn: number;
  readonly dead: boolean;
  readonly level: { readonly depth: number; readonly width: number; readonly height: number };
  readonly player: {
    readonly name: string;
    readonly level: number;
    readonly experience: number;
    readonly gold: number;
    readonly hp: { readonly current: number; readonly max: number };
    readonly mana: { readonly current: number; readonly max: number };
    readonly speed: number;
    readonly position: { readonly x: number; readonly y: number };
  };
}

/** Host-rendered panel controls. Text is always assigned with textContent. */
export type ModWorkerPanelNode =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "button"; readonly label: string; readonly action: string }
  | { readonly type: "row"; readonly children: readonly ModWorkerPanelNode[] }
  | { readonly type: "column"; readonly children: readonly ModWorkerPanelNode[] };

export interface ModWorkerPanel {
  readonly id: string;
  readonly title?: string;
  readonly root: ModWorkerPanelNode;
}

export interface ModWorkerPanelPatch {
  readonly title?: string | null;
  readonly root?: ModWorkerPanelNode;
  readonly visible?: boolean;
}

export interface WorkerInitSnapshot {
  readonly id: string;
  readonly modApi: 2;
  readonly protocolVersion: string;
  readonly engineVersion: string;
  readonly modVersion: string;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly data: Readonly<Record<string, WorkerJson>>;
  readonly capabilities: readonly string[];
  readonly newCharacter: boolean;
}

export type HostToModWorker =
  | { readonly type: "init"; readonly protocolVersion: string; readonly pluginId: string; readonly entryUrl: string; readonly snapshot: WorkerInitSnapshot }
  | { readonly type: "migrateBag"; readonly requestId: number; readonly pluginId: string; readonly data: WorkerJson; readonly fromSchema: number }
  | { readonly type: "event.model"; readonly pluginId: string; readonly subscriptionId: string; readonly model: WorkerJson }
  | { readonly type: "ui.action"; readonly pluginId: string; readonly panelId: string; readonly action: string }
  | { readonly type: "teardown"; readonly pluginId: string };

export type ModWorkerRequest =
  | { readonly type: "log"; readonly protocolVersion: string; readonly pluginId: string; readonly level: WorkerLogLevel; readonly message: string }
  | { readonly type: "prefs.get"; readonly protocolVersion: string; readonly pluginId: string; readonly requestId: number }
  | { readonly type: "prefs.set"; readonly protocolVersion: string; readonly pluginId: string; readonly requestId: number; readonly value: WorkerJson | null }
  | { readonly type: "asset.read"; readonly protocolVersion: string; readonly pluginId: string; readonly requestId: number; readonly path: string }
  | { readonly type: "event.subscribe"; readonly protocolVersion: string; readonly pluginId: string; readonly requestId: number; readonly topic: string }
  | { readonly type: "command.submit"; readonly protocolVersion: string; readonly pluginId: string; readonly requestId: number; readonly code: string; readonly args: WorkerJson }
  | { readonly type: "ui.mount"; readonly protocolVersion: string; readonly pluginId: string; readonly requestId: number; readonly panel: WorkerJson }
  | { readonly type: "ui.patch"; readonly protocolVersion: string; readonly pluginId: string; readonly requestId: number; readonly panelId: string; readonly patch: WorkerJson }
  | { readonly type: "migrateBag.result"; readonly protocolVersion: string; readonly pluginId: string; readonly requestId: number; readonly data: WorkerJson }
  | { readonly type: "migrateBag.error"; readonly protocolVersion: string; readonly pluginId: string; readonly requestId: number; readonly error: string }
  | { readonly type: "ready"; readonly protocolVersion: string; readonly pluginId: string; readonly hasMigrateBag: boolean }
  | { readonly type: "teardown.ack"; readonly protocolVersion: string; readonly pluginId: string };

export type HostReply =
  | { readonly type: "reply"; readonly protocolVersion: string; readonly pluginId: string; readonly requestId: number; readonly ok: true; readonly value: WorkerJson | Uint8Array | null }
  | { readonly type: "reply"; readonly protocolVersion: string; readonly pluginId: string; readonly requestId: number; readonly ok: false; readonly error: string };

export type ModWorkerToHost = ModWorkerRequest;
