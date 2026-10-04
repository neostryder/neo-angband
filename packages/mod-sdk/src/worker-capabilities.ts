/**
 * The capability names the retired Worker preview ABI used, and what each one
 * is called in the one vocabulary both runtimes now share.
 *
 * A Worker mod and an in-process mod ask for the same permission by the same
 * name. The preview ABI had names of its own for some of them; this table
 * maps every one explicitly, so an old manifest keeps loading and is never
 * read as asking for more than it did. A name that maps to null has no API 2
 * permission: either API 2 needs none for it (a mod's own preferences and
 * files), or the surface it opened has no API 2 form at all.
 */

/** Every retired Worker capability name, and its API 2 name or null. */
export const WORKER_CAPABILITY_ALIASES: Readonly<Record<string, string | null>> = Object.freeze({
  /* Host-drawn panels are API 2's `ui.mount`, behind the same permission in both runtimes. */
  "ui:panel": "ui:panel.mount",
  /* The preview's state model was the player's own figures. */
  "state:model.read": "state:player.read",
  /* API 2 asks no permission for a mod's own preferences and files. */
  "prefs:read": null,
  "prefs:write": null,
  "asset:read": null,
  /* No API 2 form. `command:submit` ran named host commands; API 2 acts
   * through `act.submit` under `input:intent`, which it does not imply. */
  "command:submit": null,
  "ui:region": null,
  "query:snapshot": null,
  "registry:declare": null,
  /* Policies need no permission in API 2, and asynchronous hook answers are gone. */
  "policy:install": null,
  "hook:respond": null,
});

/**
 * The API 2 name for one capability string: its alias when it is a retired
 * Worker name (null when that has no API 2 permission), and the string itself
 * otherwise. A bare "*" is never a grant and maps to null.
 */
export function unifiedCapability(capability: string): string | null {
  if (capability === "*") return null;
  if (Object.prototype.hasOwnProperty.call(WORKER_CAPABILITY_ALIASES, capability)) {
    return WORKER_CAPABILITY_ALIASES[capability] ?? null;
  }
  return capability;
}

/** A capability list under its API 2 names, in order, without duplicates or nulls. */
export function unifiedCapabilities(capabilities: readonly string[]): string[] {
  const out: string[] = [];
  for (const capability of capabilities) {
    const name = unifiedCapability(capability);
    if (name !== null && !out.includes(name)) out.push(name);
  }
  return out;
}
