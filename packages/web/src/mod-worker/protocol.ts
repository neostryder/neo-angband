/**
 * The Worker broker's wire protocol: how a Worker mod reaches the mod API,
 * version 2, from inside its sandbox.
 *
 * The protocol version describes transport only. The API a mod is written
 * against is the manifest's `api` range, checked by the loader and again by
 * the host when the Worker reports what it holds; this number changes only
 * when these messages change incompatibly. Every value is structured-clone
 * data, never a host handle.
 *
 * The Worker side is a proxy: each `ModApi2` method becomes one `call`, which
 * the host runs against the same domain implementations an in-process mod
 * uses (mod-api2-host.ts) and answers with the same `Api2Result`. Listener and
 * callback ids are chosen by the Worker, so a delivery can never race the
 * reply that registered it.
 *
 * Every message carries the broker's epoch. The host asks the Worker things
 * (`ask`) with an id and the epoch they were asked in; an answer for an ask the
 * host has given up on, or from an epoch it has left, is dropped and counted.
 */

/** Version 2 replaced the preview ABI's protocol (1.x) with the API 2 proxy. */
export const MOD_WORKER_PROTOCOL_VERSION = "2.0.0";

export type WorkerLogLevel = "info" | "warn" | "error";
export type WorkerJson = null | boolean | number | string | WorkerJson[] | { [key: string]: WorkerJson };
export type WorkerNotGranted = { readonly ok: false; readonly reason: "not-granted"; readonly capability: string };

/** Host-rendered panel controls. Text is always assigned with textContent. */
export type ModWorkerPanelNode = import("@rpgm-tools/neo-angband-mod-sdk").Api2PanelNode;

export interface ModWorkerPanel {
  readonly id: string;
  readonly title?: string;
  readonly modal?: boolean;
  readonly root: ModWorkerPanelNode;
}

export interface ModWorkerPanelPatch {
  readonly title?: string | null;
  readonly root?: ModWorkerPanelNode;
  readonly visible?: boolean;
}

/**
 * The `ModApi2` methods a Worker may call, by path. Anything else is refused
 * before it reaches the host's domains. `manage` and `truth` are absent: a
 * Worker mod never holds them.
 */
export const WORKER_CALLS = [
  "meta.settings",
  "meta.setSetting",
  "meta.mods",
  "view.world",
  "view.options",
  "view.character",
  "view.knowledge",
  "view.messages",
  "view.player",
  "view.monsters",
  "view.level",
  "view.look",
  "view.simulateLoadout",
  "view.catalogue",
  "view.inspect.simulateLoadout",
  "view.inspect.item",
  "view.inspect.itemRules",
  "view.inspect.itemTester",
  "view.inspect.bookForItem",
  "view.inspect.spell",
  "view.inspect.monsterRecall",
  "view.inspect.projectionPath",
  "view.inspect.blastArea",
  "view.inspect.travelPath",
  "view.inspect.compareLoadoutSlots",
  "view.inspect.tileActions",
  "view.input",
  "view.isCurrent",
  "act.submit",
  "act.answer",
  "act.controller.owns",
  "act.controller.setStatus",
  "act.controller.markNondeterministic",
  "act.controller.release",
  "events.on",
  "events.off",
  "content.own",
  "content.colors",
  "content.asset",
  "content.records",
  "content.boundRecords",
  "content.activations",
  "content.activation",
  "content.lookup",
  "ui.mount",
  "ui.patch",
  "ui.unmount",
  "ui.onKey",
  "ui.offKey",
  "ui.commands.register",
  "ui.gameMenu.register",
  "ui.keys.isBindableTriggerKey",
  "ui.keys.bind",
  "ui.keys.list",
  "ui.keys.remove",
  "store.prefs.get",
  "store.prefs.set",
  "store.install.get",
  "store.install.set",
  "store.character.get",
  "store.character.set",
  "backupFolder.name",
  "backupFolder.choose",
  "backupFolder.forget",
  "backupFolder.write",
  "backupFolder.list",
  "backupFolder.onSave",
  "backupFolder.off",
  "net.request",
  "net.credentials.status",
  "net.credentials.set",
  "net.credentials.fromEnvironment",
  "net.credentials.remove",
] as const;

export type WorkerCall = (typeof WORKER_CALLS)[number];

/** What `init` tells the Worker about its mod. Everything `meta` answers synchronously. */
export interface WorkerMeta {
  readonly id: string;
  readonly api: string;
  readonly engine: string;
  readonly tier: "public";
  readonly flags: Readonly<Record<string, boolean>>;
  readonly newCharacter: boolean;
  /** The permissions granted, under their API 2 names. Never "*". */
  readonly granted: readonly string[];
  /** Whether the mod has a `net` domain (it names at least one network host). */
  readonly net: boolean;
  /** Every API 2 hook name, for `hooks.available`. */
  readonly hooks: readonly string[];
}

/** What the Worker found in the mod's definition, sent once with `ready`. */
export interface WorkerDefinitionSummary {
  /** The definition's `api` range. */
  readonly api: string;
  /** Notification hooks the mod declared, which the host forwards as `notify`. */
  readonly notify: readonly string[];
  /** Hooks that return an answer, declared as functions; a Worker declares those as policies. */
  readonly misplaced: readonly string[];
  /** The policy tables, or null when it declares none. Checked by the host. */
  readonly policies: WorkerJson;
  readonly migrateBag: boolean;
  /** `prefs.version`, or null when the mod declares no preference migration. */
  readonly prefsVersion: number | null;
  readonly installVersion?: number | null;
  readonly start: boolean;
  readonly stop: boolean;
}

/** A question the host asks the Worker, answered with `answer`. */
export type WorkerQuestion =
  | { readonly kind: "migrateBag"; readonly data: WorkerJson; readonly fromSchema: number }
  | { readonly kind: "prefs.migrate"; readonly value: WorkerJson; readonly fromVersion: number }
  | { readonly kind: "install.migrate"; readonly value: WorkerJson; readonly fromVersion: number }
  | { readonly kind: "ping" };

interface Addressed {
  readonly pluginId: string;
  readonly epoch: number;
}

export type HostToModWorker =
  | (Addressed & { readonly type: "init"; readonly protocolVersion: string; readonly entryUrl: string; readonly meta: WorkerMeta })
  | (Addressed & { readonly type: "reply"; readonly requestId: number; readonly ok: true; readonly result: WorkerJson })
  | (Addressed & { readonly type: "reply"; readonly requestId: number; readonly ok: false; readonly error: string })
  | (Addressed & { readonly type: "event"; readonly listenerId: number; readonly payload: WorkerJson })
  | (Addressed & { readonly type: "ui.action"; readonly callbackId: number; readonly action: string; readonly value?: string | boolean })
  | (Addressed & { readonly type: "ui.dismissed"; readonly callbackId: number })
  | (Addressed & { readonly type: "backup.save"; readonly callbackId: number; readonly file: { readonly name: string; readonly text: string } })
  | (Addressed & { readonly type: "ask"; readonly askId: number; readonly question: WorkerQuestion })
  | (Addressed & { readonly type: "notify"; readonly hook: string; readonly args: readonly WorkerJson[] })
  /** `policyHooks`: the hooks the host applies from the mod's policy tables, for `hooks.active`. */
  | (Addressed & { readonly type: "start"; readonly policyHooks: readonly string[] })
  | (Addressed & { readonly type: "teardown" });

interface FromWorker extends Addressed {
  readonly protocolVersion: string;
}

export type ModWorkerToHost =
  | (FromWorker & { readonly type: "ready"; readonly summary: WorkerDefinitionSummary })
  | (FromWorker & { readonly type: "call"; readonly requestId: number; readonly method: string; readonly args: readonly WorkerJson[] })
  | (FromWorker & { readonly type: "answer"; readonly askId: number; readonly ok: true; readonly value: WorkerJson })
  | (FromWorker & { readonly type: "answer"; readonly askId: number; readonly ok: false; readonly error: string })
  | (FromWorker & { readonly type: "log"; readonly level: WorkerLogLevel; readonly message: string })
  | (FromWorker & { readonly type: "fault"; readonly site: string; readonly message: string });
