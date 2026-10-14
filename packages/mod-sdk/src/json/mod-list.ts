import { defineFormat, json, type Infer } from "./index.js";

const strings = json.array(json.string);
const numbers = json.map(json.finiteNumber, json.string);
const booleans = json.map(json.boolean, json.string);
const pin = json.object({ id: json.string, before: json.optional(strings), after: json.optional(strings) });

export const modListValidator = json.object({
  name: json.string,
  mods: json.array(json.object({
    id: json.string,
    name: json.string,
    version: json.string,
    repository: json.nullable(json.string),
    tag: json.nullable(json.string),
    commit: json.nullable(json.string),
    payloadDigest: json.nullable(json.map(json.string, json.string)),
    api: json.string,
    settings: numbers,
    sections: booleans,
  })),
  resolvedOrder: strings,
  orderPins: json.array(pin),
  conflictOverrides: json.map(json.string, json.string),
  ruleChoices: booleans,
});

export type SaveModList = Infer<typeof modListValidator>;

export const modListsFormat = defineFormat({
  format: "neo-angband/web/mod-lists",
  schemaVersion: 1,
  validator: json.object({ lists: json.map(modListValidator, json.string) }),
  sample: { lists: {} },
});

export const modSaveApprovalFormat = defineFormat({
  format: "neo-angband/web/mod-save-approval",
  schemaVersion: 1,
  validator: json.object({ slot: json.string, revision: json.string, allowOverwrite: json.boolean }),
  sample: { slot: "character", revision: "1", allowOverwrite: false },
});

export const modInstallRevisionFormat = defineFormat({
  format: "neo-angband/web/mod-install-revision",
  schemaVersion: 1,
  validator: json.object({ revision: json.string }),
  sample: { revision: "revision" },
});
