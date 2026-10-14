import type { ModWorkerPanel, ModWorkerPanelNode, ModWorkerPanelPatch, WorkerJson } from "./protocol";

const MAX_TEXT = 4096;
const MAX_CHILDREN = 32;

/** Parse the deliberately small host-owned panel vocabulary from cloned JSON. */
export function panelDescription(value: WorkerJson): ModWorkerPanel | null {
  if (!record(value) || !panelId(value["id"]) || !node(value["root"])) return null;
  if (value["title"] !== undefined && !text(value["title"])) return null;
  if (!only(value, ["id", "title", "root"])) return null;
  return value as unknown as ModWorkerPanel;
}

/** A patch replaces a title, root, visibility, or any combination of the three. */
export function panelPatch(value: WorkerJson): ModWorkerPanelPatch | null {
  if (!record(value) || !only(value, ["title", "root", "visible"])) return null;
  if (Object.keys(value).length === 0) return null;
  if (value["title"] !== undefined && value["title"] !== null && !text(value["title"])) return null;
  if (value["root"] !== undefined && !node(value["root"])) return null;
  if (value["visible"] !== undefined && typeof value["visible"] !== "boolean") return null;
  return value as unknown as ModWorkerPanelPatch;
}

export function panelId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function node(value: unknown, depth: number = 0): value is ModWorkerPanelNode {
  if (depth > 16 || !record(value) || typeof value["type"] !== "string") return false;
  if (value["type"] === "text") return only(value, ["type", "text"]) && text(value["text"]);
  if (value["type"] === "button") return only(value, ["type", "label", "action"]) && text(value["label"]) && panelId(value["action"]);
  if (value["type"] !== "row" && value["type"] !== "column") return false;
  if (!only(value, ["type", "children"]) || !Array.isArray(value["children"]) || value["children"].length > MAX_CHILDREN) return false;
  return value["children"].every((child) => node(child, depth + 1));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT;
}
