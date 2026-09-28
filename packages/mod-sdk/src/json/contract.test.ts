import { describe, expect, it } from "vitest";
import { autoinscriptionFormat } from "./autoinscriptions.js";
import { colorTableFormat } from "./color-table.js";
import { entryRendererFormat } from "./entry-renderers.js";
import { gamepadBindingsFormat } from "./gamepad-bindings.js";
import { keymapFormat } from "./keymaps.js";
import { soundMappingFormat } from "./sound-mappings.js";
import { subwindowLayoutFormat } from "./subwindow-layout.js";
import { visualOverrideFormat } from "./visual-overrides.js";
import { modStateFormat } from "./mod-state.js";
import { installedModFormat } from "./installed-mod.js";
import { modSettingValuesFormat } from "./mod-settings.js";
import { profilesFormat } from "./profiles.js";
import { settingsFormat } from "./settings.js";
import { windowStateFormat } from "./window-state.js";
import { highScoresFormat, birthChoiceFormat, reloadStateFormat, loopbackPortFormat, mergedOriginsFormat, deathLedgerFormat, installedMarkerFormat, backupFolderFormat, modSecretsFormat, modPageSecretsFormat } from "./local-state.js";
import { loadOrderFormat } from "./load-order.js";
import { buildIdFormat } from "./build-id.js";
import { modFontFormat, modLocaleFormat } from "./mod-resources.js";
import { color, defineFormat, json, keyInput, listFormats, parseDocument, serializeDocument, utcTimestamp } from "./index.js";

void [
  autoinscriptionFormat,
  colorTableFormat,
  entryRendererFormat,
  gamepadBindingsFormat,
  keymapFormat,
  soundMappingFormat,
  subwindowLayoutFormat,
  visualOverrideFormat,
  highScoresFormat, birthChoiceFormat, reloadStateFormat, loopbackPortFormat,
  mergedOriginsFormat, deathLedgerFormat, installedMarkerFormat, backupFolderFormat,
  modSecretsFormat, modPageSecretsFormat,
  settingsFormat,
  loadOrderFormat,
  buildIdFormat,
  modLocaleFormat,
  modFontFormat,
  modStateFormat,
  installedModFormat,
  modSettingValuesFormat,
  profilesFormat,
];

defineFormat({
  format: "neo-angband/test/migration-chain",
  schemaVersion: 3,
  validator: json.object({ label: json.string, count: json.integer }),
  migrations: {
    1: (data) => ({ label: (data as { name: string }).name }),
    2: (data) => ({ ...data as object, count: 0 }),
  },
  sampleV1: { name: "test" },
  sample: { label: "test", count: 0 },
});

const orderFormat = defineFormat({
  format: "neo-angband/test/order",
  schemaVersion: 1,
  validator: json.object({ later: json.map(json.integer), first: json.string }),
  sample: { later: { zed: 2, alpha: 1 }, first: "ok" },
});

describe("JSON format registry contract", () => {
  for (const format of listFormats()) {
    it(`${format.format} has a byte-stable sample and a complete migration chain`, () => {
      expect(format.sample, "every registered format needs a sample").toBeDefined();
      const serialized = serializeDocument(format.format, format.sample);
      const parsed = parseDocument(serialized, format.format);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(serializeDocument(format.format, parsed.data)).toBe(serialized);
      expect(serialized.endsWith("\n")).toBe(true);
      expect(serialized.includes("\r")).toBe(false);
      if (format.schemaVersion > 1) {
        expect(format.sampleV1, "migrated formats need a v1 sample").toBeDefined();
        const migrated = parseDocument({ format: format.format, schemaVersion: 1, data: format.sampleV1 }, format.format);
        expect(migrated.ok).toBe(true);
        if (migrated.ok) {
          expect(migrated.migrated).toBe(true);
          expect(migrated.schemaVersion).toBe(format.schemaVersion);
          expect(migrated.data).toEqual(format.sample);
        }
      }
    });
  }

  it("rejects wrong tags, future versions, and extra envelope fields with paths", () => {
    const data = windowStateFormat.sample;
    for (const [document, path] of [
      [{ format: "neo-angband/desktop/other", schemaVersion: 1, data }, "$.format"],
      [{ format: windowStateFormat.format, schemaVersion: 2, data }, "$.schemaVersion"],
      [{ format: windowStateFormat.format, schemaVersion: 1, data, extra: true }, '$["extra"]'],
    ] as const) {
      const result = parseDocument(document, windowStateFormat);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.map((issue) => issue.path)).toContain(path);
    }
    expect(parseDocument("{", windowStateFormat).ok).toBe(false);
  });

  it("validates every shared scalar rule", () => {
    const failures: readonly [string, string, string][] = [
      ["camelCase", "$.data", 'property bad_name'],
      ["enum", '$["value"]', "expected one of"],
      ["color", '$["red"]', "channel"],
      ["key", '$["modifiers"][0]', "expected one of"],
      ["timestamp", "$", "invalid UTC"],
      ["id", "$", "kebab-case"],
      ["number", "$", "finite"],
      ["boolean", "$", "JSON boolean"],
      ["optional", '$["maybe"]', "omit optional"],
      ["nullable", '$["name"]', "string"],
      ["unknown", '$["extra"]', "unknown field"],
    ];
    const results = [
      () => { try { json.object({ bad_name: json.string }); return ""; } catch (error) { return `$.data: ${(error as Error).message}`; } },
      () => json.object({ value: json.enum(["one-value"] as const) }).validate({ value: "TwoValue" }),
      () => color.validate({ red: 256, green: 0, blue: 0, alpha: 255 }),
      () => keyInput.validate({ key: "A", code: "KeyA", modifiers: ["ctrl"] }),
      () => utcTimestamp.validate("2026-02-30T01:02:03Z"),
      () => json.stableId.validate("Bad_id"),
      () => json.finiteNumber.validate(Infinity),
      () => json.boolean.validate(1),
      () => json.object({ maybe: json.optional(json.string) }).validate({ maybe: undefined }),
      () => json.object({ name: json.nullable(json.string) }).validate({ name: 1 }),
      () => json.object({ name: json.string }).validate({ name: "ok", extra: 1 }),
    ];
    failures.forEach(([name, path, message], index) => {
      const result = results[index]!();
      const text = typeof result === "string" ? result : result.ok ? "" : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" ");
      expect(text, name).toContain(path);
      expect(text, name).toContain(message);
    });
    expect(keyInput.validate({ key: "A", code: "KeyA", modifiers: ["shift", "shift"] }).ok).toBe(false);
    expect(color.validate({ red: -1, green: 0, blue: 0, alpha: 255 }).ok).toBe(false);
    expect(json.object({ name: json.string }).validate({ name: null }).ok).toBe(false);
    expect(json.array(json.optional(json.string)).validate([undefined]).ok).toBe(false);
    expect(json.map(json.optional(json.string)).validate({ entry: undefined }).ok).toBe(false);
  });

  it("sorts map keys and uses declaration order in compact output", () => {
    expect(serializeDocument(orderFormat, orderFormat.sample, { compact: true })).toBe(
      '{"format":"neo-angband/test/order","schemaVersion":1,"data":{"later":{"alpha":1,"zed":2},"first":"ok"}}',
    );
  });
});
