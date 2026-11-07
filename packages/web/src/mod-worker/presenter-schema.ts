import { cloneWorkerJson, payloadBytes } from "./clone";
import type { WorkerGridCommand, WorkerPresentationDescription } from "./protocol";

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

export function presentationDescription(value: unknown): WorkerPresentationDescription {
  const json = cloneWorkerJson(value);
  if (payloadBytes(json) > 32768 || !record(json, ["title", "lines", "rows"]) || !text(json.title, 256) ||
    !Array.isArray(json.lines) || json.lines.length > 64 || !json.lines.every((line) => text(line, 256)) ||
    !Array.isArray(json.rows) || json.rows.length > 64 || !json.rows.every((row: unknown) => record(row, ["id", "label"]) &&
      text(row.id, 64) && /^[a-zA-Z0-9:_-]+$/.test(row.id) && text(row.label, 256)) ||
    new Set(json.rows.map((row) => (row as { id: string }).id)).size !== json.rows.length) {
    throw new Error("a presentation needs a title, at most 64 text lines, and at most 64 uniquely named rows within 32768 bytes");
  }
  return json as unknown as WorkerPresentationDescription;
}

export const GRID_COLORS = Object.freeze({ normal: "#d8d8dc", muted: "#888888", warning: "#ffff00", danger: "#ff4040", good: "#40ff40" }); // palette-exempt: fixed host tokens exclude mod CSS.

export function gridCommands(value: unknown): readonly WorkerGridCommand[] {
  const json = cloneWorkerJson(value);
  if (payloadBytes(json) > 60000 || !Array.isArray(json) || json.length > 512 || !json.every((command) =>
    record(command, ["col", "row", "glyph", "color"]) && [command.col, command.row].every((n) => Number.isSafeInteger(n) && Math.abs(n as number) <= 32767) &&
    text(command.glyph, 2) && [...command.glyph].length === 1 && typeof command.color === "string" && Object.hasOwn(GRID_COLORS, command.color))) {
    throw new Error("a frame needs at most 512 grid glyphs with integer coordinates and host color tokens within 60000 bytes");
  }
  return json as unknown as readonly WorkerGridCommand[];
}
