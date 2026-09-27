# JSON document style

Neo Angband data files, preferences, and exports use one document envelope. The shared implementation is exported by `@rpgm-tools/neo-angband-mod-sdk` from `packages/mod-sdk/src/json`. Each format registers its own data validator and sample. Core, hosts, tools, and mods use the same parser and serializer at their read and write boundaries.

```json
{
  "format": "neo-angband/desktop/window-state",
  "schemaVersion": 1,
  "data": {
    "fullscreen": false,
    "maximized": false,
    "width": 1200,
    "height": 800,
    "position": null
  }
}
```

The root contains exactly `format`, `schemaVersion`, and `data`, in that order. A format tag has the shape `neo-angband/<domain>/<name>` with lower-case kebab-case segments. The schema version is a positive integer for this document shape. A mod's own version or a content pack's release version belongs inside `data`.

Property names use camelCase, including names imported from older snake_case files. Stable ids and declared enum strings use lower-case kebab-case. Booleans use JSON `true` and `false`. Numbers are finite; integer fields use safe integers. Colors use `{ red, green, blue, alpha }` with integer channels from 0 to 255. Key input uses `{ key, code, modifiers }`; modifiers are distinct values from `alt`, `control`, `meta`, and `shift`. Timestamps use UTC RFC 3339 strings ending in `Z`. Optional fields are omitted. A field accepts `null` only when its validator declares it nullable. Validators reject unknown fields and report the JSON path of each fault.

Define a format in the SDK and export its definition from the package entry point. Declare object properties in the order they should appear on disk. A sample is required by the registry contract test. Every version above 1 also needs a v1 sample and a migration for each adjacent version.

```ts
import { defineFormat, json } from "@rpgm-tools/neo-angband-mod-sdk";

export const exampleFormat = defineFormat({
  format: "neo-angband/example/settings",
  schemaVersion: 2,
  validator: json.object({ enabled: json.boolean, label: json.optional(json.string) }),
  migrations: { 1: (old) => ({ enabled: (old as { active: boolean }).active }) },
  sampleV1: { active: true },
  sample: { enabled: true },
});
```

The example migration renames `active` to `enabled` without changing its value. Each migration receives the prior version's `data` and returns the next version's `data`. Keep migrations pure and register every step from v1 through the current version. `parseDocument` rejects a future schema version without rewriting it. It returns typed current data or issues with JSON paths, even when the input is malformed.

```ts
import { parseDocument, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";

const parsed = parseDocument(fileText, exampleFormat);
if (parsed.ok) {
  const fileText = serializeDocument(exampleFormat, parsed.data);
  const storageText = serializeDocument(exampleFormat, parsed.data, { compact: true });
}
```

`serializeDocument` validates before writing. File and export output uses UTF-8, two-space indentation, LF line endings, and one final newline. Compact output has the same envelope and data on one line for browser storage. Object fields follow declaration order, object-map keys are sorted, and arrays keep their order. An invalid value causes `DocumentValidationError` with path-specific issues.

An old file is read once, converted to the new JSON document, and never written again. Remove the old file only after the new document reads back successfully. A corrupt or future document does not trigger a silent legacy fallback. The desktop `window.txt` to `window.json` conversion is the first example.
