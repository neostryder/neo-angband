import { defineFormat, json, keyInput, type ValidationIssue, type Validator } from "./index.js";

/**
 * The role names the web adapter assigns to pad buttons. Kept here so the
 * document schema and the adapter cannot spell a role two different ways.
 */
export const GAMEPAD_ROLE_IDS = [
  "confirm",
  "cancel",
  "commands",
  "layer",
  "stop",
  "wait",
  "page-prev",
  "page-next",
  "legend",
] as const;

const roleTarget = json.object({
  kind: json.enum(["role"] as const),
  role: json.enum(GAMEPAD_ROLE_IDS),
});
const commandTarget = json.object({
  kind: json.enum(["command"] as const),
  command: json.string,
});
const keyTarget = json.object({
  kind: json.enum(["key"] as const),
  key: keyInput,
});

/** One button target: an adapter role, a game command, or one literal key. */
export const gamepadTarget: Validator<
  | { kind: "role"; role: (typeof GAMEPAD_ROLE_IDS)[number] }
  | { kind: "command"; command: string }
  | { kind: "key"; key: { key: string; code: string; modifiers: ("alt" | "control" | "meta" | "shift")[] } }
> = {
  validate(value, path = "$") {
    if (typeof value !== "object" || value === null || !("kind" in value)) {
      return { ok: false, issues: [{ path, message: "expected a button target" }] };
    }
    const kind = (value as { kind?: unknown }).kind;
    if (kind === "role") return roleTarget.validate(value, path);
    if (kind === "command") {
      const result = commandTarget.validate(value, path);
      if (!result.ok) return result;
      if (result.value.command.length === 0) {
        return { ok: false, issues: [{ path: `${path}["command"]`, message: "expected a nonempty string" }] };
      }
      return result;
    }
    if (kind === "key") return keyTarget.validate(value, path);
    return { ok: false, issues: [{ path: `${path}["kind"]`, message: "expected role, command, or key" }] };
  },
};

const binding = json.object({
  index: json.integer,
  target: gamepadTarget,
});

const pad = json.object({
  signature: json.string,
  buttons: json.array(binding),
  layer: json.array(binding),
  deadZone: json.object({
    inner: json.finiteNumber,
    outer: json.finiteNumber,
  }),
});

const validator = json.object({
  pads: json.array(pad),
});

function duplicateIndexes(rows: readonly { index: number }[], path: string): ValidationIssue[] {
  const seen = new Set<number>();
  const issues: ValidationIssue[] = [];
  rows.forEach((row, index) => {
    if (row.index < 0) issues.push({ path: `${path}[${index}]["index"]`, message: "expected a non-negative integer" });
    if (seen.has(row.index)) issues.push({ path: `${path}[${index}]["index"]`, message: "duplicate button index" });
    seen.add(row.index);
  });
  return issues;
}

const gamepadValidator: typeof validator = {
  validate(value, path = "$") {
    const result = validator.validate(value, path);
    if (!result.ok) return result;
    const issues: ValidationIssue[] = [];
    result.value.pads.forEach((row, index) => {
      const at = `${path}["pads"][${index}]`;
      if (row.signature.length === 0) issues.push({ path: `${at}["signature"]`, message: "expected a nonempty string" });
      issues.push(...duplicateIndexes(row.buttons, `${at}["buttons"]`));
      issues.push(...duplicateIndexes(row.layer, `${at}["layer"]`));
    });
    return issues.length ? { ok: false, issues } : result;
  },
};

export const gamepadBindingsFormat = defineFormat({
  format: "neo-angband/prefs/gamepad-bindings",
  schemaVersion: 1,
  validator: gamepadValidator,
  sample: {
    pads: [
      {
        signature: "xbox/standard/17/4",
        buttons: [
          { index: 0, target: { kind: "role", role: "confirm" } },
          { index: 1, target: { kind: "command", command: "g" } },
        ],
        layer: [
          { index: 9, target: { kind: "key", key: { key: "Escape", code: "Escape", modifiers: [] } } },
        ],
        deadZone: { inner: 0.25, outer: 0.95 },
      },
    ],
  },
});
