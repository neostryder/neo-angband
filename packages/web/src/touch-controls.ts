import { addControlDomOwner } from "./input-door";
import { controlProfile, saveControlProfile } from "./control-profile";
import { controlKey, controlSurface, stopControlInput, type ControlAction } from "./control-surface";
import "./touch-controls.css";

export interface TouchControlsHost {
  stop(): void;
  save(): void;
}

/** A temporary DOM surface over the same questions the terminal is answering. */
export function installTouchControls(host: TouchControlsHost): () => void {
  const root = document.createElement("section");
  root.id = "touch-controls";
  root.setAttribute("aria-label", "Touch controls");
  const launcher = document.createElement("div");
  launcher.className = "touch-launcher";
  const sheet = document.createElement("section");
  sheet.className = "touch-sheet";
  sheet.setAttribute("aria-label", "Current controls");
  root.append(sheet, launcher);
  document.body.append(root);
  let expanded = false;
  let keysOpen = false;
  let commandsOpen = false;
  let lastToken: number | undefined;
  let pointerToken: number | undefined;
  const layoutKey = `neo-angband:controls:${controlProfile()}`;
  try { expanded = localStorage.getItem(layoutKey) === "expanded"; } catch { /* Use compact default. */ }

  function button(parent: HTMLElement, label: string, action: () => void, disabled = false): HTMLButtonElement {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.disabled = disabled;
    node.addEventListener("click", (event) => {
      event.preventDefault();
      action();
    });
    parent.append(node);
    return node;
  }

  const show = (): void => {
    expanded = !expanded;
    try { localStorage.setItem(layoutKey, expanded ? "expanded" : "compact"); } catch { /* Session only. */ }
    render();
  };
  const toggle = button(launcher, "Controls", show);
  button(launcher, "Back / Stop", () => { host.stop(); });

  // Own DOM fields and buttons without taking ownership away from mod panels.
  const removeOwner = addControlDomOwner({
    owns: (event) => root.isConnected && event.composedPath().includes(root),
    escape: (event) => {
      if (!event.composedPath().includes(root)) return false;
      if (commandsOpen || keysOpen) { commandsOpen = false; keysOpen = false; render(); }
      else stopControlInput();
      return true;
    },
  });
  // A pointer which started on a previous prompt cannot answer a new one.
  root.addEventListener("pointerdown", () => { pointerToken = controlSurface.current()?.token; }, true);

  function actionButton(parent: HTMLElement, action: ControlAction, token: number): HTMLButtonElement {
    const node = button(parent, action.label, () => {
      if (pointerToken !== undefined && pointerToken !== token) return;
      controlSurface.invoke(token, action.id);
    }, action.disabled);
    node.setAttribute("aria-pressed", String(action.selected ?? false));
    return node;
  }

  function field(parent: HTMLElement, label: string, value: string, max: number, submit: (value: string) => void): void {
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("aria-label", label);
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.value = value;
    input.maxLength = max;
    form.append(input);
    button(form, "Send", () => submit(input.value));
    form.addEventListener("submit", (event) => { event.preventDefault(); submit(input.value); });
    parent.append(form);
  }

  function navigation(parent: HTMLElement, compass: boolean, token?: number): void {
    const pad = document.createElement("div");
    pad.className = "touch-pad";
    pad.setAttribute("aria-label", compass ? "Direction pad" : "Menu navigation");
    const cells = compass
      ? [["NW", "7"], ["N", "8"], ["NE", "9"], ["W", "4"], ["Wait", "5"], ["E", "6"], ["SW", "1"], ["S", "2"], ["SE", "3"]]
      : [["Page up", "PageUp"], ["Up", "ArrowUp"], ["Page down", "PageDown"], ["Left", "ArrowLeft"], ["Select", "Enter"], ["Right", "ArrowRight"], ["Home", "Home"], ["Down", "ArrowDown"], ["End", "End"]];
    for (const [label, key] of cells) button(pad, label!, () => {
      if (controlSurface.current()?.token !== token) return;
      controlKey(key!);
    });
    parent.append(pad);
  }

  function render(): void {
    const snapshot = controlSurface.current();
    const context = snapshot?.context;
    if (snapshot?.token !== lastToken) {
      if (snapshot) expanded = true;
      else expanded = false;
      commandsOpen = false;
      keysOpen = false;
      lastToken = snapshot?.token;
    }
    toggle.textContent = expanded ? "Hide controls" : "Controls";
    toggle.setAttribute("aria-expanded", String(expanded));
    sheet.hidden = !expanded;
    sheet.replaceChildren();
    if (!expanded) return;
    const heading = document.createElement("h2");
    heading.textContent = commandsOpen ? "Commands" : context?.label ?? "Explore";
    sheet.append(heading);
    if (context?.detail) {
      const detail = document.createElement("p");
      detail.className = "touch-detail";
      detail.textContent = context.detail;
      if (context.rows) {
        const disclosure = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Details";
        disclosure.append(summary, detail);
        sheet.append(disclosure);
      } else sheet.append(detail);
    }
    const tools = document.createElement("div");
    tools.className = "touch-actions";
    sheet.append(tools);
    button(tools, "Commands", () => { commandsOpen = !commandsOpen; render(); }, !controlSurface.canCommand() || !!context);
    button(tools, "Keys", () => { keysOpen = !keysOpen; render(); });

    if (commandsOpen) {
      const search = document.createElement("input");
      search.type = "search";
      search.setAttribute("aria-label", "Find command");
      search.placeholder = "Find command";
      sheet.append(search);
      const list = document.createElement("div");
      list.className = "touch-rows";
      const commands = controlSurface.commands();
      const paintCommands = (): void => {
        list.replaceChildren();
        for (const command of commands.filter((item) => `${item.category} ${item.label}`.toLowerCase().includes(search.value.toLowerCase()))) {
          button(list, `${command.category}: ${command.label}`, () => {
            if (!controlSurface.canCommand() || controlSurface.current()) return;
            expanded = false;
            commandsOpen = false;
            render();
            controlSurface.invokeCommand(command.id);
          }, command.disabled);
        }
      };
      search.addEventListener("input", paintCommands);
      sheet.append(list);
      paintCommands();
      return;
    }

    if (keysOpen) {
      let ctrl = false;
      const modifier = button(sheet, "Control: off", () => {
        ctrl = !ctrl;
        modifier.textContent = `Control: ${ctrl ? "on" : "off"}`;
      });
      field(sheet, "One key", "", 1, (value) => { if (value) controlKey(value, ctrl); });
      const special = document.createElement("div");
      special.className = "touch-actions";
      for (const key of ["Escape", "Enter", "Tab", "Backspace", "Delete", " ", "/", "|", "-", "?", "*", "'", "=", "@", "{", "}", "!", "&", "^", "\\", ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]) {
        button(special, key === " " ? "Space" : key, () => controlKey(key, ctrl));
      }
      sheet.append(special);
      navigation(sheet, false, snapshot?.token);
      return;
    }

    if (context?.text && snapshot) {
      const token = snapshot.token;
      field(sheet, context.label, context.text.value, context.text.maxLength, (value) => controlSurface.submit(token, value));
    }
    if (context?.rows && snapshot) {
      navigation(sheet, false, snapshot.token);
      const rows = document.createElement("div");
      rows.className = "touch-rows";
      for (const action of context.rows) actionButton(rows, action, snapshot.token);
      sheet.append(rows);
      rows.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
    }
    if (snapshot && context?.replies) {
      const compass = document.createElement("div");
      compass.className = "touch-pad";
      compass.setAttribute("aria-label", "Direction pad");
      const actions = document.createElement("div");
      actions.className = "touch-actions";
      for (const action of context.replies) {
        const dir = action.direction;
        if ((context.kind === "direction" || context.kind === "target") && dir !== undefined) {
          const node = actionButton(compass, action, snapshot.token);
          node.style.gridRow = String(3 - Math.floor((dir - 1) / 3));
          node.style.gridColumn = String((dir - 1) % 3 + 1);
        } else actionButton(actions, action, snapshot.token);
      }
      if (compass.childElementCount) sheet.append(compass);
      sheet.append(actions);
    }
    if (context?.kind === "key" && !context.text) navigation(sheet, false, snapshot?.token);
    if (!context) {
      navigation(sheet, controlSurface.canCommand());
      const preferences = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Control profile";
      preferences.append(summary);
      for (const profile of ["touch", "desktop"] as const) {
        button(preferences, `Use ${profile} profile`, () => {
          host.save();
          saveControlProfile(profile);
          window.location.reload();
        }, controlProfile() === profile || !controlSurface.canCommand());
      }
      sheet.append(preferences);
    }
  }

  const unsubscribe = controlSurface.subscribe(render);
  render();
  return () => { unsubscribe(); removeOwner(); root.remove(); };
}
