import { defineFormat, json } from "./index.js";

const score = json.object({
  what: json.string, pts: json.finiteNumber, gold: json.finiteNumber,
  turns: json.finiteNumber, day: json.string, who: json.string,
  uid: json.finiteNumber, pRace: json.finiteNumber, pClass: json.finiteNumber,
  curLev: json.finiteNumber, curDun: json.finiteNumber, maxLev: json.finiteNumber,
  maxDun: json.finiteNumber, how: json.string,
});
export const highScoresFormat = defineFormat({
  format: "neo-angband/web/high-scores", schemaVersion: 1,
  validator: json.object({ scores: json.array(score) }),
  sample: { scores: [] },
});

const stats = json.array(json.integer);
const birth = json.object({ raceName: json.string, className: json.string, name: json.string,
  sex: json.optional(json.string), roller: json.optional(json.string), stats: json.optional(stats),
  rolledStats: json.optional(stats), history: json.optional(json.string),
  birthOptions: json.optional(json.map(json.boolean, json.string)) });
export const birthChoiceFormat = defineFormat({
  format: "neo-angband/web/birth-choice", schemaVersion: 1,
  validator: json.object({ choice: birth }),
  sample: { choice: { raceName: "Human", className: "Warrior", name: "Player" } },
});

export const reloadStateFormat = defineFormat({
  format: "neo-angband/web/reload-state", schemaVersion: 1,
  validator: json.object({ values: json.map(json.string, json.string) }),
  sample: { values: {} },
});

export const loopbackPortFormat = defineFormat({ format: "neo-angband/desktop/loopback-port", schemaVersion: 1,
  validator: json.object({ port: json.integer }), sample: { port: 45871 } });
export const mergedOriginsFormat = defineFormat({ format: "neo-angband/desktop/merged-origins", schemaVersion: 1,
  validator: json.object({ ports: json.array(json.integer) }), sample: { ports: [] } });
export const deathLedgerFormat = defineFormat({ format: "neo-angband/desktop/death-ledger", schemaVersion: 1,
  validator: json.object({ ids: json.array(json.string) }), sample: { ids: [] } });
export const installedMarkerFormat = defineFormat({ format: "neo-angband/desktop/installed-marker", schemaVersion: 1,
  validator: json.object({ installed: json.boolean, note: json.optional(json.string) }), sample: { installed: true, note: "Where the savefiles are." } });
export const backupFolderFormat = defineFormat({ format: "neo-angband/desktop/backup-folder", schemaVersion: 1,
  validator: json.object({ path: json.string }), sample: { path: "C:/Backups" } });
/* The desktop version that last launched with this data folder. A different
 * version on the next launch is what takes a restore point. */
export const lastRunVersionFormat = defineFormat({ format: "neo-angband/desktop/last-run-version", schemaVersion: 1,
  validator: json.object({ version: json.string }), sample: { version: "1.20.0" } });
/* What one restore point holds: the version that was about to run, the one that ran
 * before it when known, and when it was taken (milliseconds since the epoch). */
export const restorePointFormat = defineFormat({ format: "neo-angband/desktop/restore-point", schemaVersion: 1,
  validator: json.object({ fromVersion: json.optional(json.string), toVersion: json.string, createdAt: json.finiteNumber,
    reason: json.enum(["update", "before-restore"] as const) }),
  sample: { fromVersion: "1.20.0", toVersion: "1.20.1", createdAt: 1790000000000, reason: "update" } });

/* One named secret a mod keeps for its own network requests. `hosts` lists the
 * `network:` grant hosts it may be sent to. The desktop app stores either an
 * OS-encrypted value (base64 of Electron safeStorage output) or the names of the
 * environment variables to read, tried in order. */
const desktopSecret = json.object({ hosts: json.array(json.string),
  encrypted: json.optional(json.string), env: json.optional(json.array(json.string)) });
export const modSecretsFormat = defineFormat({ format: "neo-angband/desktop/mod-secrets", schemaVersion: 1,
  validator: json.object({ mods: json.map(json.map(desktopSecret), json.string) }),
  sample: { mods: { squire: { jev: { hosts: ["api.typesafe.ai"], env: ["TYPESAFE_API_KEY", "JEV_API_KEY"] } } } } });
/* The browser fallback: page storage, readable by any script on the page. */
const pageSecret = json.object({ hosts: json.array(json.string), value: json.string });
export const modPageSecretsFormat = defineFormat({ format: "neo-angband/web/mod-secrets", schemaVersion: 1,
  validator: json.object({ secrets: json.map(pageSecret) }),
  sample: { secrets: { jev: { hosts: ["api.typesafe.ai"], value: "example" } } } });
