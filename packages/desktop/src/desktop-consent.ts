import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { checkSecretHosts, networkGrantCovers, parseCapability } from "@rpgm-tools/neo-angband-mod-sdk";
import { desktopBackupFolderKey } from "./backup-folder.js";
import type { DesktopConsentMemory } from "./net-relay.js";

interface Approval {
  grants: string[];
  destinations: string[];
}

/** Payload changes retain consent; installation tokens still expire on navigation. */
export function createDesktopConsentStore(userBase: string): DesktopConsentMemory {
  const file = path.join(userBase, "mod-desktop-consent.json");
  const load = (): Record<string, Approval> => {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const valid = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
      const entries = Object.entries(parsed);
      if (entries.some(([key, value]: [string, unknown]) => !/^[a-f0-9]{64}$/u.test(key) || !value || typeof value !== "object" ||
        !valid((value as Approval).grants) || !valid((value as Approval).destinations))) return {};
      for (const [, value] of entries) {
        const approval = value as Approval;
        if (approval.grants.some((cap) => cap !== "backup:folder" && !cap.startsWith("network:"))) return {};
        for (const cap of approval.grants) parseCapability(cap);
        const network = approval.grants.filter((cap) => cap.startsWith("network:")).map((cap) => cap.slice(8));
        if (approval.destinations.some((host) => host === "*" || host === "local" || !checkSecretHosts([host], network).ok)) return {};
      }
      return Object.fromEntries(entries) as Record<string, Approval>;
    } catch { return {}; }
  };
  const save = (records: Record<string, Approval>): void => {
    const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      fs.mkdirSync(userBase, { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(records), { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
  };
  return {
    approved: (modId, grants, destinations) => {
      const prior = load()[desktopBackupFolderKey(modId)];
      try {
        return prior !== undefined && grants.every((cap) => prior.grants.includes(cap) ||
          cap.startsWith("network:") && networkGrantCovers(prior.grants.filter((grant) => grant.startsWith("network:")).map((grant) => grant.slice(8)), cap)) &&
          destinations.every((host) => networkGrantCovers(prior.destinations, `network:${host}`));
      } catch { return false; }
    },
    remember: (modId, grants, destinations) => save({ ...load(), [desktopBackupFolderKey(modId)]: { grants: [...grants], destinations: [...destinations] } }),
    forget: (modId) => {
      const records = load();
      delete records[desktopBackupFolderKey(modId)];
      save(records);
    },
  };
}
