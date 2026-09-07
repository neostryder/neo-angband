/**
 * The two surfaces a pad needs that neither the keyboard nor a touchscreen do.
 *
 * A radial command wheel, because eighty-odd commands do not fit on a pad and
 * an alphabetical list steered one row at a time is slower than the keyboard it
 * replaces. And a mapping screen, because no two pads agree on what they have.
 *
 * Both are driven by the adapter rather than by the DOM's own key handling:
 * a player using a controller has no keyboard to fall back to, so a surface
 * that could only be operated with one would be a surface they cannot reach.
 * Pointer input works too, because a mouse is how these get tested and how a
 * player without a pad plugged in reads the legend.
 */
import { CLOCKWISE_FROM_NORTH } from "./gamepad-analog";
import type { AngbandDirection } from "./input-door";
import { controlSurface, type ControlCommand } from "./control-surface";
import { addControlDomOwner } from "./input-door";
import { buttonName, describePad } from "./gamepad-device";
import {
  GAMEPAD_ROLES, ROLE_LABEL, defaultBindings, rebind, roleOf, saveBindings,
  type BindingTarget, type GamepadBindings,
} from "./gamepad-bindings";
import type { ConnectedPad, GamepadHost } from "./gamepad-input";
import "./gamepad-controls.css";

export interface GamepadControlsHost {
  stop(): void;
}

/** Wedges per ring. Eight is the size a radial menu was measured at. */
const WEDGES = 8;

/** Where a wedge sits, as a fraction of the ring's radius. */
const RADIUS_PERCENT = 36;

type Ring =
  | { readonly kind: "categories"; readonly page: number }
  | { readonly kind: "commands"; readonly category: string; readonly page: number }
  /** The replies of the prompt that was open when the wheel was opened. */
  | { readonly kind: "replies"; readonly token: number; readonly page: number };

interface Wedge {
  readonly label: string;
  readonly detail?: string | undefined;
  readonly take: () => void;
  readonly disabled?: boolean | undefined;
}

function pageOf<T>(items: readonly T[], page: number): readonly T[] {
  return items.slice(page * WEDGES, page * WEDGES + WEDGES);
}

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / WEDGES));
}

/**
 * The controller shell.
 *
 * Returns the `GamepadHost` the adapter drives plus a teardown, and takes the
 * adapter back afterwards through `attach` because the two need each other:
 * the wheel needs the pad list, and the mapping screen needs to swallow a
 * button press.
 */
export function installGamepadControls(host: GamepadControlsHost): {
  readonly host: GamepadHost;
  attach(adapter: {
    captureButton(report: (index: number) => void): () => void;
    setBindings(index: number, bindings: GamepadBindings): void;
  }): void;
  dispose(): void;
} {
  const root = document.createElement("section");
  root.id = "gamepad-controls";
  root.setAttribute("aria-label", "Controller");
  const notice = document.createElement("p");
  notice.className = "gamepad-notice";
  notice.hidden = true;
  const wheel = document.createElement("div");
  wheel.className = "gamepad-wheel";
  wheel.setAttribute("role", "listbox");
  wheel.setAttribute("aria-label", "Command wheel");
  wheel.hidden = true;
  const legend = document.createElement("section");
  legend.className = "gamepad-legend";
  legend.setAttribute("aria-label", "Controller legend and mapping");
  legend.hidden = true;
  root.append(notice, wheel, legend);
  document.body.append(root);

  let pads: readonly ConnectedPad[] = [];
  let open: "wheel" | "legend" | undefined;
  let ring: Ring = { kind: "categories", page: 0 };
  let cursor = 0;
  let legendRow = 0;
  let releaseCapture: (() => void) | undefined;
  let noticeTimer: number | undefined;
  let adapter: { captureButton(report: (index: number) => void): () => void; setBindings(index: number, bindings: GamepadBindings): void } | undefined;

  // The legend's own buttons are real DOM. Without this the one window-level
  // keydown listener would read a click's focus follow-up as a game command.
  const removeOwner = addControlDomOwner({
    owns: (event) => root.isConnected && event.composedPath().includes(root),
    escape: () => {
      if (!open) return false;
      close();
      return true;
    },
  });

  /** The pad most recently reported, which is the one the notice named. */
  function pad(): ConnectedPad | undefined {
    return pads.at(-1);
  }

  function commands(): readonly ControlCommand[] {
    return controlSurface.commands();
  }

  function categories(): readonly string[] {
    const seen: string[] = [];
    for (const command of commands()) {
      if (!seen.includes(command.category)) seen.push(command.category);
    }
    return seen;
  }

  /**
   * The replies a stick cannot already answer.
   *
   * Directions are left out because the stick is pointing at them, and there is
   * no sense in a wheel wedge for north. What is left is the part of a prompt a
   * pad would otherwise have no way to reach at all: Choose target and Closest
   * at an aim prompt, Free cursor and Recall in the target loop, the item
   * sources, Yes and No.
   */
  function replyWedges(token: number): readonly Wedge[] {
    const snapshot = controlSurface.current();
    if (!snapshot || snapshot.token !== token) return [];
    const replies = (snapshot.context.replies ?? []).filter((action) => action.direction === undefined);
    return pageOf(replies, ring.page).map((action) => ({
      label: action.label,
      disabled: action.disabled,
      take: () => {
        close();
        controlSurface.invoke(token, action.id);
      },
    }));
  }

  /**
   * The wheel's current ring.
   *
   * Two levels, never three. Eight choices per level with one level of nesting
   * is where a radial menu was measured to stay under a ten percent error rate;
   * a third level is where that stops being true, so a long category pages
   * rather than subdividing.
   */
  function wedges(): readonly Wedge[] {
    if (ring.kind === "replies") return replyWedges(ring.token);
    if (ring.kind === "categories") {
      const all = categories();
      return pageOf(all, ring.page).map((category) => ({
        label: category,
        detail: `${commands().filter((command) => command.category === category).length} commands`,
        take: () => {
          ring = { kind: "commands", category, page: 0 };
          cursor = 0;
          render();
        },
      }));
    }
    const category = ring.category;
    const inCategory = commands().filter((command) => command.category === category);
    return pageOf(inCategory, ring.page).map((command) => ({
      label: command.label,
      detail: command.key,
      disabled: command.disabled,
      take: () => {
        close();
        controlSurface.invokeCommand(command.id);
      },
    }));
  }

  function ringPages(): number {
    const current = ring;
    if (current.kind === "categories") return pageCount(categories().length);
    if (current.kind === "commands") {
      return pageCount(commands().filter((command) => command.category === current.category).length);
    }
    const snapshot = controlSurface.current();
    if (!snapshot || snapshot.token !== current.token) return 1;
    return pageCount((snapshot.context.replies ?? [])
      .filter((action) => action.direction === undefined).length);
  }

  function close(): void {
    open = undefined;
    releaseCapture?.();
    releaseCapture = undefined;
    render();
  }

  /**
   * One button, two meanings, decided by what is on screen.
   *
   * With a prompt open the command catalogue is unreachable anyway, because the
   * shell will not start a command inside a prompt. So the same button shows
   * that prompt's own replies instead, and a pad reaches every answer of every
   * prompt shape without a second button nobody would remember.
   */
  function openWheel(): void {
    open = "wheel";
    const snapshot = controlSurface.current();
    ring = snapshot
      ? { kind: "replies", token: snapshot.token, page: 0 }
      : { kind: "categories", page: 0 };
    cursor = 0;
    render();
  }

  function renderWheel(): void {
    wheel.replaceChildren();
    const items = wedges();
    const hub = document.createElement("div");
    hub.className = "gamepad-hub";
    const title = document.createElement("strong");
    title.textContent = ring.kind === "commands"
      ? ring.category
      : ring.kind === "replies"
        ? controlSurface.current()?.context.label ?? "Prompt"
        : "Commands";
    const hint = document.createElement("span");
    const pages = ringPages();
    // The hub carries the selected label in full, which is what makes clipping
    // a long one out at the rim safe.
    hint.textContent = items[cursor]?.label ?? "";
    if (pages > 1) {
      const page = document.createElement("small");
      page.textContent = `Page ${ring.page + 1} of ${pages}`;
      hub.append(title, hint, page);
      wheel.append(hub);
    } else {
      hub.append(title, hint);
      wheel.append(hub);
    }
    items.forEach((item, index) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "gamepad-wedge";
      node.setAttribute("role", "option");
      node.setAttribute("aria-selected", String(index === cursor));
      node.disabled = item.disabled ?? false;
      // Placed by angle rather than laid out in a grid: the whole point of a
      // radial is that every choice is the same distance from the centre, and
      // that only holds if the position comes from the angle. The offset is a
      // fraction of the RING, not of the wedge, because a wedge holding two
      // lines of text is taller than one holding one and would otherwise sit at
      // a different radius from its neighbours.
      const angle = (index * (2 * Math.PI)) / WEDGES;
      node.style.left = `${50 + RADIUS_PERCENT * Math.sin(angle)}%`;
      node.style.top = `${50 - RADIUS_PERCENT * Math.cos(angle)}%`;
      const label = document.createElement("span");
      label.textContent = item.label;
      node.append(label);
      if (item.detail) {
        const detail = document.createElement("small");
        detail.textContent = item.detail;
        node.append(detail);
      }
      node.addEventListener("click", (event) => {
        event.preventDefault();
        cursor = index;
        item.take();
      });
      wheel.append(node);
    });
  }

  /**
   * A binding that is not one of the offered choices still has to show.
   *
   * The game menu is reached with a literal Escape rather than through a
   * command row, so its default binding is not in the list below. Left alone, a
   * `<select>` given a value it has no option for reports no selection at all,
   * and the row rendered blank: a player would have read their working Menu
   * button as unbound, and changing any part of that row would have thrown the
   * binding away without saying so.
   */
  function bindingLabel(target: BindingTarget): string {
    const role = roleOf(target);
    if (role) return ROLE_LABEL[role];
    if (target.startsWith("key:")) return `Key ${target.slice(4)}`;
    const key = target.slice(4);
    return commands().find((command) => command.key === key)?.label ?? `Command ${key}`;
  }

  function targetChoices(): readonly { readonly value: string; readonly label: string; readonly group: string }[] {
    const roles = GAMEPAD_ROLES.map((role) => ({
      value: `role:${role}`, label: ROLE_LABEL[role], group: "Controller",
    }));
    const named = commands()
      .filter((command): command is ControlCommand & { key: string } => typeof command.key === "string")
      .map((command) => ({ value: `cmd:${command.key}`, label: command.label, group: command.category }));
    return [{ value: "", label: "Unbound", group: "Controller" }, ...roles, ...named];
  }

  function apply(index: number, value: string, layered: boolean): void {
    const current = pad();
    if (!current) return;
    const next = rebind(current.bindings, index, value === "" ? undefined : value as BindingTarget, layered);
    current.bindings = next;
    adapter?.setBindings(current.index, next);
    saveBindings(current.signature, next);
    render();
  }

  function renderLegend(): void {
    legend.replaceChildren();
    const current = pad();
    const heading = document.createElement("h2");
    heading.textContent = "Controller";
    legend.append(heading);
    if (!current) {
      const empty = document.createElement("p");
      empty.textContent = "No controller detected. Press a button on a connected controller to wake it.";
      legend.append(empty);
      return;
    }
    const summary = document.createElement("p");
    summary.className = "gamepad-detail";
    summary.textContent = `${current.id} - ${describePad(current.capabilities)}`;
    legend.append(summary);

    const table = document.createElement("div");
    table.className = "gamepad-rows";
    const choices = targetChoices();
    for (let index = 0; index < current.capabilities.buttonCount; index++) {
      const row = document.createElement("div");
      row.className = "gamepad-row";
      row.setAttribute("aria-current", String(index === legendRow));
      const name = document.createElement("button");
      name.type = "button";
      name.className = "gamepad-name";
      name.textContent = buttonName(current.capabilities.family, index);
      name.addEventListener("click", () => {
        legendRow = index;
        render();
      });
      row.append(name);
      for (const layered of [false, true]) {
        const select = document.createElement("select");
        select.setAttribute("aria-label",
          `${buttonName(current.capabilities.family, index)}${layered ? " with the layer held" : ""}`);
        let group: HTMLOptGroupElement | undefined;
        let lastGroup = "";
        for (const choice of choices) {
          if (choice.group !== lastGroup) {
            group = document.createElement("optgroup");
            group.label = choice.group;
            select.append(group);
            lastGroup = choice.group;
          }
          const option = document.createElement("option");
          option.value = choice.value;
          option.textContent = choice.label;
          (group ?? select).append(option);
        }
        const bound = (layered ? current.bindings.layer : current.bindings.buttons)[index];
        if (bound && !choices.some((choice) => choice.value === bound)) {
          const option = document.createElement("option");
          option.value = bound;
          option.textContent = bindingLabel(bound);
          select.append(option);
        }
        select.value = bound ?? "";
        select.addEventListener("change", () => apply(index, select.value, layered));
        row.append(select);
      }
      table.append(row);
    }
    legend.append(table);

    const actions = document.createElement("div");
    actions.className = "gamepad-actions";
    const press = document.createElement("button");
    press.type = "button";
    press.textContent = releaseCapture ? "Press a button on the controller" : "Find a button";
    press.addEventListener("click", () => {
      releaseCapture?.();
      releaseCapture = adapter?.captureButton((index) => {
        legendRow = index;
        releaseCapture = undefined;
        render();
      });
      render();
    });
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Restore defaults";
    reset.addEventListener("click", () => {
      const fresh = defaultBindings(current.capabilities);
      current.bindings = fresh;
      adapter?.setBindings(current.index, fresh);
      saveBindings(current.signature, fresh);
      render();
    });
    const done = document.createElement("button");
    done.type = "button";
    done.textContent = "Close";
    done.addEventListener("click", close);
    actions.append(press, reset, done);
    legend.append(actions);
  }

  function render(): void {
    wheel.hidden = open !== "wheel";
    legend.hidden = open !== "legend";
    if (open === "wheel") renderWheel();
    if (open === "legend") renderLegend();
  }

  function show(text: string): void {
    notice.textContent = text;
    notice.hidden = false;
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 6000) as unknown as number;
  }

  const gamepadHost: GamepadHost = {
    overlayOpen: () => open !== undefined,
    overlayMove: (direction: AngbandDirection) => {
      if (open === "legend") {
        const count = pad()?.capabilities.buttonCount ?? 0;
        if (count === 0) return;
        if (direction === 8) legendRow = (legendRow + count - 1) % count;
        else if (direction === 2) legendRow = (legendRow + 1) % count;
        else return;
        render();
        legend.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
        return;
      }
      // A radial is chosen by ANGLE, so a direction names a wedge outright
      // rather than stepping a cursor towards one.
      const index = CLOCKWISE_FROM_NORTH.indexOf(direction);
      if (index < 0 || index >= wedges().length) return;
      cursor = index;
      render();
    },
    overlayConfirm: () => {
      if (open === "legend") return;
      // Point, then press. Selecting on RELEASE instead would make cancelling a
      // wheel impossible without a second gesture, because letting go is how a
      // player abandons one.
      wedges()[cursor]?.take();
    },
    overlayCancel: () => {
      // Backing out of a category returns to the categories; backing out of a
      // prompt's replies closes the wheel and leaves the prompt alone, because
      // the prompt's own Cancel is one of the replies rather than this button.
      if (open === "wheel" && ring.kind === "commands") {
        ring = { kind: "categories", page: 0 };
        cursor = 0;
        render();
        return;
      }
      close();
    },
    overlayPage: (delta: number) => {
      if (open !== "wheel") return;
      const pages = ringPages();
      const page = ((ring.page + delta) % pages + pages) % pages;
      ring = ring.kind === "categories" ? { kind: "categories", page } : { ...ring, page };
      cursor = 0;
      render();
    },
    toggleWheel: () => {
      if (open === "wheel") close();
      else openWheel();
    },
    toggleLegend: () => {
      if (open === "legend") close();
      else {
        open = "legend";
        legendRow = 0;
        render();
      }
    },
    stop: () => host.stop(),
    padsChanged: (next) => {
      const had = pads;
      pads = next;
      const current = next.at(-1);
      // Compared by identity, not by count: unplugging one pad and plugging in
      // a different one leaves the count where it was, and that is exactly the
      // moment a player most needs to be told which button is now the wheel.
      const arrived = current
        && !had.some((seen) => seen.index === current.index && seen.signature === current.signature);
      if (arrived) {
        show(`Controller ready: ${describePad(current.capabilities)}. `
          + `${buttonName(current.capabilities.family, wheelButton(current))} opens the command wheel.`);
      } else if (next.length === 0 && had.length > 0) {
        show("Controller disconnected.");
        if (open) close();
      }
      if (open === "legend") render();
    },
  };

  /** Which button the connection notice should name, from the live bindings. */
  function wheelButton(current: ConnectedPad): number {
    const found = Object.entries(current.bindings.buttons)
      .find(([, target]) => target === "role:commands");
    return found ? Number(found[0]) : 0;
  }

  return {
    host: gamepadHost,
    attach: (next) => { adapter = next; },
    dispose: () => {
      if (noticeTimer !== undefined) clearTimeout(noticeTimer);
      releaseCapture?.();
      removeOwner();
      root.remove();
    },
  };
}
