import { capabilityWithoutIt, describeCapability } from "../capability-describe";
import { canRunWithout } from "../mod-tier";
import type { PermissionConfirmation } from "./types";
import { log } from "../logging";

export function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== "object" || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

export function permissionConfirmation(modId: string, capability: string): PermissionConfirmation {
  return {
    modId,
    capability,
    consentText: describeCapability(capability).text,
    withoutIt: capabilityWithoutIt(capability),
    canRunWithout: canRunWithout(capability),
  };
}

export function refused(code: string, reason: string): { readonly status: "refused"; readonly code: string; readonly reason: string } {
  if (code !== "cancelled") log.warn("mods", reason, { code });
  return { status: "refused", code, reason };
}
