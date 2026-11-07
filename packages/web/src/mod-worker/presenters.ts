import type { ModDisplay } from "../mod-plugin";
import type { InstalledMenu } from "../menu-runtime";
import type { InstalledScreen } from "../screen-runtime";
import type { MenuAnswer, MenuQuestion } from "../menu-view";
import type { ScreenView } from "../screen-view";
import { isCoreDrawn } from "../core-drawn";
import { addControlDomOwner, inputEvents } from "../input-door";
import { modPanelsSuspended, modPresentationSuspended, onModPanelSuspension, onModPermissionSuspension } from "../panel-runtime";
import { toWorkerJson, payloadBytes } from "./clone";
import { gridCommands, GRID_COLORS, presentationDescription } from "./presenter-schema";
import { PRESENTER_WORKER_CALLS, type WorkerJson, type WorkerPresenterQuestion, type WorkerPresentationDescription } from "./protocol";

interface Owner {
  readonly id: string;
  current(): boolean;
  readonly menu?: InstalledMenu;
  readonly screen?: InstalledScreen;
  readonly management?: () => Promise<boolean>;
}

const owners = new Map<symbol, Owner>();
interface Visibility { yielded: boolean; refresh?: () => void }
function lastOwner(family: "menu" | "screen" | "management"): Owner | undefined {
  return [...owners.values()].filter((owner) => owner.current() && owner[family]).at(-1);
}

export function workerMenuOwner(): InstalledMenu | null { return lastOwner("menu")?.menu ?? null; }
export function workerScreenOwner(): InstalledScreen | null { return lastOwner("screen")?.screen ?? null; }
export function openWorkerManagementScreen(): Promise<boolean> | undefined { return lastOwner("management")?.management?.(); }

/** The host retains the display, input handlers, and action implementations. */
export function createWorkerPresenters(options: {
  readonly id: string;
  readonly display: ModDisplay;
  held(capability: string): boolean;
  ask(question: WorkerPresenterQuestion): Promise<WorkerJson>;
  readonly doc?: Document;
}) {
  const doc = options.doc ?? document;
  const registrations = new Map<string, () => void>();
  const requests: number[] = [];
  const open = new Set<() => void>();
  let stopped = false;
  let suspension = 0;
  const offSuspension = onModPermissionSuspension((hidden) => {
    if (!hidden) return;
    suspension += 1;
    for (const close of open) close();
  });
  const allowed = (capability: string) => !stopped && options.held(capability);
  const visible = () => !modPanelsSuspended() && !doc.querySelector("dialog[open]");
  const request = async (callbackId: number, presentationId: string, phase: "describe" | "select", input: unknown, current: () => boolean) => {
    const generation = suspension;
    if (!current() || !visible()) throw new Error("the presentation is no longer authorized");
    const json = toWorkerJson(input);
    if (payloadBytes(json) > 32768) throw new Error("the presentation input exceeds 32768 bytes");
    const result = await options.ask({ kind: "presentation", callbackId, presentationId, phase, input: json });
    if (!current() || !visible() || generation !== suspension) throw new Error("the presentation was superseded");
    return result;
  };
  const show = (description: WorkerPresentationDescription, current: () => boolean, management: boolean, visibility?: Visibility): Promise<{ action: string } | null> => {
    if (!current() || !visible() || open.size > 0) return Promise.reject(new Error("the presentation is unavailable"));
    return new Promise((resolve, reject) => {
      const root = doc.createElement("div");
      const controls = doc.createElement("div");
      controls.setAttribute("aria-label", "Game presenter controls");
      controls.style.cssText = "position:fixed;z-index:2147483646;top:8px;right:8px;display:flex;gap:8px;background:#18181f;color:#d8d8dc;padding:8px"; // palette-exempt: reserved host controls stay above mod panels and below native dialogs.
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", `${options.id} presentation`);
      root.style.cssText = "position:fixed;z-index:15;overflow:auto;background:#18181f;color:#d8d8dc;padding:8px;box-sizing:border-box;font:14px/1.4 monospace"; // palette-exempt: host styles cannot be supplied by a mod.
      const title = doc.createElement("h2");
      title.textContent = description.title;
      root.append(title);
      for (const line of description.lines) {
        const row = doc.createElement("div");
        row.textContent = line;
        root.append(row);
      }
      let finished = false;
      const finish = (value?: { action: string } | null): void => {
        if (finished) return;
        finished = true;
        root.hidden = true;
        root.inert = true;
        controls.hidden = true;
        controls.inert = true;
        root.remove();
        controls.remove();
        clearInterval(timer);
        offFrame?.();
        offOwner();
        if (visibility) delete visibility.refresh;
        inputEvents.removeEventListener("keydown", onKey, true);
        open.delete(cancel);
        if (value === undefined) reject(new Error("the game resumed its own presentation"));
        else resolve(value);
      };
      const cancel = () => finish();
      const button = (label: string, run: () => void, parent: HTMLElement = root): void => {
        const element = doc.createElement("button");
        element.type = "button";
        element.textContent = label;
        element.addEventListener("click", () => { if (!finished && !visibility?.yielded && current() && visible()) run(); });
        parent.append(element);
      };
      button("Close", () => finish(null), controls);
      button(management ? "Permissions and game controls" : "Use game screen", cancel, controls);
      for (const row of description.rows) button(row.label, () => finish({ action: row.id }));
      const position = (): void => {
        if (finished) return;
        if (!current() || !visible()) { cancel(); return; }
        const pixels = options.display.snapshot().regions.map.pixels;
        if (!pixels || pixels.width < 1 || pixels.height < 1) { cancel(); return; }
        root.style.left = `${pixels.x}px`;
        root.style.top = `${pixels.y}px`;
        root.style.width = `${pixels.width}px`;
        root.style.height = `${pixels.height}px`;
        root.hidden = visibility?.yielded === true;
        root.inert = root.hidden;
        controls.hidden = root.hidden;
        controls.inert = root.hidden;
      };
      const onKey = (event: KeyboardEvent): void => {
        if (!current() || !visible() || visibility?.yielded) return;
        if (event.key === "Escape" && !event.repeat && !event.isComposing) {
          event.preventDefault();
          event.stopImmediatePropagation();
          finish(null);
        }
      };
      const timer = setInterval(position, 25);
      const offFrame = options.display.onFrame?.(position);
      const offOwner = addControlDomOwner({ owns: () => !finished && !root.hidden && (root.contains(doc.activeElement) || controls.contains(doc.activeElement)),
        escape: (event) => {
          if (finished || root.hidden || !current() || !visible() || event.repeat || event.isComposing) return false;
          finish(null);
          return true;
        } });
      if (visibility) visibility.refresh = position;
      open.add(cancel);
      doc.body.append(root, controls);
      inputEvents.addEventListener("keydown", onKey, true);
      position();
    });
  };
  const describe = async (callbackId: number, presentationId: string, input: unknown, current: () => boolean) => {
    return presentationDescription(await request(callbackId, presentationId, "describe", input, current));
  };
  const menu = async (callbackId: number, question: MenuQuestion, current: () => boolean): Promise<MenuAnswer | undefined> => {
    if (isCoreDrawn(question.id) || question.choices.length > 64) return undefined;
    const presentationId = crypto.randomUUID();
    try {
      const description = await describe(callbackId, presentationId, { id: question.id, title: question.title, footer: question.footer,
        choices: question.choices.map((choice) => ({ id: choice.id, label: choice.label, disabled: choice.disabled })), browseOnly: question.browseOnly }, current);
      const selected = await show(description, current, false);
      if (!selected) return { kind: "cancel" };
      const answer = await request(callbackId, presentationId, "select", selected, current);
      if (answer && typeof answer === "object" && !Array.isArray(answer)) {
        if (Object.keys(answer).length === 1 && answer.kind === "cancel") return { kind: "cancel" };
        if (Object.keys(answer).length === 2 && answer.kind === "choose" && typeof answer.choice === "string" && !question.browseOnly &&
          question.choices.some((choice) => choice.id === answer.choice && !choice.disabled)) return { kind: "choose", choice: answer.choice };
      }
    } catch { return undefined; }
    return undefined;
  };
  const screen = async (callbackId: number, view: ScreenView, current: () => boolean, visibility: Visibility): Promise<void> => {
    for (let count = 0; count < 64; count += 1) {
      if (isCoreDrawn(view.id)) throw new Error("the game owns this screen");
      const presentationId = crypto.randomUUID();
      const description = await describe(callbackId, presentationId, view, current);
      const selected = await show(description, current, false, visibility);
      if (!selected) return;
      const answer = await request(callbackId, presentationId, "select", selected, current);
      if (answer === null) return;
      if (typeof answer === "object" && !Array.isArray(answer) && Object.keys(answer).length === 1) {
        if (answer.kind === "dismiss") return;
        if (answer.kind === "refresh") continue;
      }
      // Live screen actions can commit after a prompt without rechecking this connection's authority.
      throw new Error("game actions require the game's own screen; a Worker screen can only dismiss or refresh");
    }
    throw new Error("the screen refresh limit was reached");
  };
  const frame = (callbackId: number, current: () => boolean): (() => void) => {
    let busy = false;
    let root: HTMLDivElement | undefined;
    let generation = 0;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { root?.remove(); root = undefined; clearTimeout(expiry); };
    const tick = async (): Promise<void> => {
      if (!current() || !visible() || modPresentationSuspended() || options.display.snapshot().mode !== "play") { clear(); return; }
      if (busy) return;
      busy = true;
      const serial = generation;
      const snapshot = options.display.snapshot();
      try {
        const value = await request(callbackId, crypto.randomUUID(), "describe", { grid: snapshot.grid, viewport: snapshot.viewport, map: snapshot.regions.map.cells }, current);
        const commands = gridCommands(value);
        const live = options.display.snapshot();
        if (generation !== serial || live.mode !== "play" || JSON.stringify(snapshot) !== JSON.stringify(live)) { clear(); return; }
        const { pixels, cells } = live.regions.map;
        if (!pixels) { clear(); return; }
        const next = doc.createElement("div");
        next.setAttribute("aria-label", `${options.id} map`);
        next.style.cssText = "position:fixed;z-index:10;overflow:hidden;pointer-events:none;background:#000000;font-family:monospace"; // palette-exempt: fixed grid tokens cannot accept CSS.
        next.style.left = `${pixels.x}px`;
        next.style.top = `${pixels.y}px`;
        next.style.width = `${pixels.width}px`;
        next.style.height = `${pixels.height}px`;
        next.inert = true;
        for (const command of commands) {
          if (command.col < 0 || command.row < 0 || command.col >= cells.cols || command.row >= cells.rows) continue;
          const glyph = doc.createElement("span");
          glyph.textContent = command.glyph;
          glyph.style.cssText = "position:absolute;overflow:hidden;white-space:pre";
          glyph.style.left = `${command.col * live.grid.cellWidth}px`;
          glyph.style.top = `${command.row * live.grid.cellHeight}px`;
          glyph.style.width = `${live.grid.cellWidth}px`;
          glyph.style.height = `${live.grid.cellHeight}px`;
          glyph.style.lineHeight = `${live.grid.cellHeight}px`;
          glyph.style.fontSize = `${Math.max(1, live.grid.cellHeight - 2)}px`;
          glyph.style.color = GRID_COLORS[command.color];
          next.append(glyph);
        }
        clear();
        root = next;
        doc.body.append(next);
        expiry = setTimeout(clear, 250);
      } catch { clear(); }
      finally { busy = false; }
    };
    const invalidate = () => { generation += 1; clear(); };
    const offFrame = options.display.onFrame?.(invalidate);
    const off = onModPanelSuspension((hidden) => { if (hidden) invalidate(); });
    const timer = setInterval(() => { void tick(); }, 100);
    void tick();
    return () => { generation += 1; clearInterval(timer); offFrame?.(); off(); clear(); };
  };
  return {
    replace(method: string, callbackId: number | null, epochCurrent: () => boolean): void {
      const capability = PRESENTER_WORKER_CALLS[method];
      if (!capability || !allowed(capability) || !visible()) throw new Error("the presenter is not authorized");
      const time = Date.now();
      while (requests[0] !== undefined && requests[0] <= time - 1000) requests.shift();
      if (requests.length >= 8) throw new Error("presenters can be replaced at most eight times per second");
      requests.push(time);
      if (callbackId !== null && (!Number.isSafeInteger(callbackId) || callbackId <= 0)) throw new Error("a presenter needs a positive callback id or null");
      registrations.get(method)?.();
      registrations.delete(method);
      if (callbackId === null) return;
      let active = true;
      const current = () => active && allowed(capability) && epochCurrent();
      const token = Symbol();
      let cleanup = () => {};
      if (method === "display.replace") cleanup = frame(callbackId, current);
      else owners.set(token, {
        id: options.id, current,
        ...(method === "ui.menu.replace" ? { menu: { id: options.id, presenter: { ask: (question) => menu(callbackId, question, current) } } } : {}),
        ...(method === "ui.screen.replace" ? { screen: { id: options.id, presenter: {
          show: (view) => {
            if (isCoreDrawn(view.id) || !current() || !visible()) return undefined;
            const visibility: Visibility = { yielded: false };
            return { dismissed: screen(callbackId, view, current, visibility), yieldTerminal: (request) => {
              visibility.yielded = request !== null;
              visibility.refresh?.();
            } };
          },
        } } } : {}),
        ...(method === "ui.management.replace" ? { management: async () => {
          try {
            const presentationId = crypto.randomUUID();
            const description = await describe(callbackId, presentationId, { id: "mods" }, current);
            const selected = await show(description, current, true);
            if (selected) await request(callbackId, presentationId, "select", selected, current);
            return true;
          } catch { return false; }
        } } : {}),
      });
      registrations.set(method, () => { active = false; owners.delete(token); cleanup(); for (const close of open) close(); });
    },
    teardown(): void {
      stopped = true;
      offSuspension();
      for (const cleanup of registrations.values()) cleanup();
      registrations.clear();
    },
  };
}
