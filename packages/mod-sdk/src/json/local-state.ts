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
