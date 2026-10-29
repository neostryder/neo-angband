/**
 * Which capability each part of the mod API needs, as the code checks read it.
 *
 * The three handles a mod is given are the API 1 plugin context (`ctx`), the API
 * 1 registry host (`host`, the first argument of `register`) and the API 2 root
 * (`mod`, the argument of `start`). A path names a member under one of them:
 * `ctx.net`, `host.effects`, `api2.view.player`. A member listed here is gated:
 * the host leaves it out, or throws on first use, unless the manifest grants
 * what it needs. Members not listed are given to every mod.
 */

import type { CapabilitySet } from "../capabilities.js";

export type HandleRoot = "ctx" | "host" | "api2";

/** What a gated member needs. */
export interface CapabilityNeed {
  /** The capability or capabilities, as an author would add them to the manifest. */
  readonly label: string;
  covered(caps: CapabilitySet): boolean;
}

const has = (caps: CapabilitySet, cap: string): boolean => {
  try {
    return caps.has(cap);
  } catch {
    return false;
  }
};

/** Needs one of `caps`. */
export const anyOf = (...caps: string[]): CapabilityNeed => ({
  label: caps.map((c) => `"${c}"`).join(" or "),
  covered: (set) => caps.some((c) => has(set, c)),
});

/** Needs at least one `network:` grant. */
export const ANY_NETWORK: CapabilityNeed = {
  label: "a \"network:<host>\" capability",
  covered: (set) => set.networkGrants().length > 0,
};

const HUD = anyOf("ui:messages.replace", "ui:sidebar.replace", "ui:status.replace", "ui:*.replace");

/** Gated members, keyed `root:dotted.path`. */
const GATED_BASE: ReadonlyMap<string, CapabilityNeed> = new Map<string, CapabilityNeed>([
  ["ctx:net", ANY_NETWORK],
  ["ctx:installMod", anyOf("mod:install")],
  ["ctx:reloadGame", anyOf("mod:install", "mod:session")],
  ["ctx:loadModForSession", anyOf("mod:session")],
  ["ctx:readMod", anyOf("mod:read")],
  ["ctx:debug", anyOf("debug:spawn")],
  ["ctx:wizard", anyOf("debug:wizard")],
  ["ctx:intent", anyOf("input:intent")],
  ["ctx:prompt", anyOf("input:prompt.reply")],
  ["ctx:saves", anyOf("saves:manage")],
  ["ctx:session", anyOf("session:control")],
  ["ctx:title", anyOf("ui:title")],
  ["ctx:profiles", anyOf("profiles:manage")],
  ["ctx:keymaps", anyOf("keymap:write")],
  ["ctx:keybindings", anyOf("keymap:edit")],
  ["ctx:knowledge", anyOf("state:knowledge.read", "state:*.read")],
  ["ctx:options", anyOf("state:options.read", "state:*.read", "options:manage")],
  ["ctx:options.set", anyOf("options:write", "options:manage")],
  ["ctx:backupFolder", anyOf("backup:folder")],
  ["ctx:ui", anyOf("ui:panel.mount")],
  ["ctx:character", anyOf("state:player.read", "state:*.read")],
  ["ctx:inspect", anyOf("state:inventory.read", "state:monsters.read", "state:spells.read", "state:map.read", "state:player.read", "state:*.read")],
  ["ctx:display.setVisualFilter", anyOf("display:filter")],
  ["ctx:display.setChromeTheme", anyOf("display:filter")],
  ["ctx:shared.publish", anyOf("shared:publish")],
  ["ctx:shared.withdraw", anyOf("shared:publish")],
  ["ctx:shared.read", anyOf("shared:read")],
  ["ctx:shared.onChange", anyOf("shared:read")],

  ["host:effects", anyOf("registry:effect", "registry:*")],
  ["host:rooms", anyOf("registry:room", "registry:*")],
  ["host:profiles", anyOf("registry:profile", "registry:*")],
  ["host:blows", anyOf("registry:blow", "registry:*")],
  ["host:stores", anyOf("registry:store", "registry:*")],
  ["host:commands", anyOf("registry:command", "registry:*")],
  ["host:monsters", anyOf("registry:monster", "registry:*")],
  ["host:projections", anyOf("registry:projection", "registry:*")],
  ["host:uiEntry", anyOf("registry:ui-entry", "registry:*")],
  ["host:glyphs", anyOf("registry:glyph", "registry:*")],
  ["host:effectInfo", anyOf("registry:effect-info", "registry:*")],
  ["host:randart", anyOf("registry:randart", "registry:*")],
  ["host:tval", anyOf("registry:tval", "registry:*")],
  ["host:rune", anyOf("registry:rune", "registry:*")],
  ["host:vocab", anyOf("registry:vocab", "registry:*")],
  ["host:messages", anyOf("registry:message", "registry:*")],
  ["host:menus", anyOf("registry:menu", "registry:*")],
  ["host:tiles", anyOf("registry:tiles", "registry:*")],

  ["api2:view.player", anyOf("state:player.read", "state:*.read")],
  ["api2:view.monsters", anyOf("state:monsters.read", "state:*.read")],
  ["api2:view.level", anyOf("state:map.read", "state:*.read")],
  ["api2:view.input", anyOf("state:interaction.read", "state:*.read")],
  ["api2:act.submit", anyOf("input:intent")],
  ["api2:act.answer", anyOf("input:prompt.reply")],
  ["api2:ui.mount", anyOf("ui:panel.mount")],
  ["api2:ui.patch", anyOf("ui:panel.mount")],
  ["api2:ui.unmount", anyOf("ui:panel.mount")],
  ["api2:ui.mountPage", anyOf("ui:panel.mount")],
  ["api2:ui.overlay", anyOf("ui:panel.mount")],
  ["api2:ui.title", anyOf("ui:title")],
  ["api2:ui.commands.register", anyOf("command:add", "registry:command", "registry:*")],
  ["api2:ui.gameMenu.register", anyOf("ui:menu.row", "registry:menu", "registry:*")],
  ["api2:ui.keys.bind", anyOf("keymap:write")],
  ["api2:ui.keys.isBindableTriggerKey", anyOf("keymap:write")],
  ["api2:backupFolder", anyOf("backup:folder")],
  ["api2:net", ANY_NETWORK],
  ["api2:manage.profiles", anyOf("profiles:manage")],
  ["api2:manage.session", anyOf("session:control")],
  ["api2:manage.saves", anyOf("saves:manage")],
  ["api2:manage.options.get", anyOf("state:options.read", "state:*.read", "options:manage")],
  ["api2:manage.options.set", anyOf("options:write", "options:manage")],
  ["api2:manage.keys", anyOf("keymap:edit")],
  ["api2:manage.mods", anyOf("mod:install")],
  ["api2:manage.authoring", anyOf("mod:authoring")],
  ["api2:manage.wizard", anyOf("debug:wizard")],
  ["api2:manage.loadForSession", anyOf("mod:session")],
  ["api2:manage.reloadGame", anyOf("mod:install", "mod:session")],
  ["api2:store.kv", anyOf("store:kv")],
  ["api2:store.session", anyOf("store:session")],
  ["api2:truth", anyOf("state:map-actual.read", "state:monsters-actual.read")],
  ["api2:truth.monsters", anyOf("state:map-actual.read", "state:monsters-actual.read")],
  ["api2:truth.race", anyOf("state:map-actual.read", "state:monsters-actual.read")],
  ["api2:truth.level", anyOf("state:map-actual.read")],
  ["api2:truth.storeKnowledge", anyOf("state:map-actual.read")],
]);

/**
 * `mod.engine.registry` is the host an API 1 `register(host, ctx)` is given, so each of its members
 * needs what the same member of `host` needs.
 */
export const GATED_MEMBERS: ReadonlyMap<string, CapabilityNeed> = new Map<string, CapabilityNeed>([
  ...GATED_BASE,
  ...[...GATED_BASE].filter(([member]) => member.startsWith("host:")).map(([member, need]) => [`api2:engine.registry.${member.slice(5)}`, need] as const),
]);

/** Event subscriptions, whose capability is `event:<first argument>`. */
export const EVENT_SUBSCRIBE: ReadonlySet<string> = new Set(["ctx:events.on", "api2:events.on"]);

/** Title screen rows, whose first argument carries the row's `id`. */
export const TITLE_ROW: ReadonlySet<string> = new Set(["api2:ui.title.registerRow"]);

/** The id a title row, like a panel or a button action, must match. */
export const TITLE_ROW_ID = /^[a-z][a-z0-9-]{0,63}$/u;

/** Network requests, whose first argument carries the URL. */
export const NET_REQUEST: ReadonlySet<string> = new Set(["ctx:net.request", "api2:net.request"]);

/**
 * Secret bindings, and which argument holds the host list: `ctx.net.secrets.set(name, value, { hosts })`,
 * `ctx.net.secrets.fromEnv(name, vars, { hosts })`, `credentials.set(name, value, hosts)` and
 * `credentials.fromEnvironment(name, vars, hosts)`.
 */
export const SECRET_BIND: ReadonlyMap<string, { readonly index: number; readonly field?: string }> = new Map([
  ["ctx:net.secrets.set", { index: 2, field: "hosts" }],
  ["ctx:net.secrets.fromEnv", { index: 2, field: "hosts" }],
  ["api2:net.credentials.set", { index: 2 }],
  ["api2:net.credentials.fromEnvironment", { index: 2 }],
]);

/**
 * API 1 plugin methods the host calls only when the manifest grants their
 * capability: the game keeps its own display, HUD, menus, screens, character
 * creation or regions otherwise.
 */
export const FACET_METHODS: ReadonlyMap<string, CapabilityNeed> = new Map([
  ["frontend", anyOf("display:replace")],
  ["hud", HUD],
  ["menu", anyOf("ui:menu.replace", "ui:*.replace")],
  ["screen", anyOf("ui:screen.replace", "ui:*.replace")],
  ["birth", anyOf("ui:birth.replace", "ui:*.replace")],
  ["regions", anyOf("ui:region.create")],
]);

/**
 * What an API 2 `controller` member needs before it can drive anything: the
 * game's state to decide from, the right to submit intents, and the right to
 * answer prompts. Without any one of the three the host skips the controller
 * and says nothing, so the mod holds the keyboard and never moves.
 */
export const CONTROLLER_NEEDS: readonly CapabilityNeed[] = [
  anyOf("state:interaction.read", "state:*.read"),
  anyOf("input:intent"),
  anyOf("input:prompt.reply"),
];

const key = (root: HandleRoot, path: readonly string[]): string => `${root}:${path.join(".")}`;

/** What the member at `path` under `root` needs, or undefined when it is given to every mod. */
export function gatedMember(root: HandleRoot, path: readonly string[]): CapabilityNeed | undefined {
  return GATED_MEMBERS.get(key(root, path));
}

/** The key the special-call tables use. */
export const memberKey = key;

const PREFIXES: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  const all = [...GATED_MEMBERS.keys(), ...EVENT_SUBSCRIBE, ...NET_REQUEST, ...SECRET_BIND.keys()];
  for (const full of all) {
    const [root, dotted] = full.split(":") as [string, string];
    const parts = dotted.split(".");
    for (let i = 0; i <= parts.length; i++) out.add(`${root}:${parts.slice(0, i).join(".")}`);
  }
  return out;
})();

/**
 * True when `path` is a gated member or has one below it, so losing track of
 * the handle at `path` could hide a call that needs a capability.
 */
export function reachesGated(root: HandleRoot, path: readonly string[]): boolean {
  return PREFIXES.has(key(root, path));
}

/**
 * True when the game leaves the member at `key` out of the handle unless the
 * manifest grants its capability, so code can test for it: every top-level
 * `ctx` member, and `net`, `manage` and `truth` on the API 2 root. The registry
 * facades on `host` are always present and throw instead, and the other API 2
 * members answer "not granted".
 */
export function omittedWhenUngranted(key: string): boolean {
  const [root, dotted = ""] = key.split(":");
  const parts = dotted.split(".");
  if (parts.length !== 1) return false;
  return root === "ctx" || (root === "api2" && ["net", "manage", "truth"].includes(parts[0] as string));
}
