/**
 * The command wheel, and the pad mapping screen beside it.
 *
 * A radial command wheel, because eighty-odd commands do not fit on a pad and
 * an alphabetical list steered one row at a time is slower than the keyboard it
 * replaces. And a mapping screen, because no two pads agree on what they have.
 *
 * THE WHEEL IS NOT A CONTROLLER SURFACE ANY MORE. It is the one command
 * surface three devices share: a pad opens it with the button bound to
 * `role:commands`, a mouse with a right-click, a finger with a long press. All
 * three get the same rings, the same icons, the same words and the same commit
 * rule, because a player who learns it on one device has learned it on the
 * others. What differs is only how a wedge is pointed at, which is the part the
 * hardware settles rather than the design: a stick has an angle, a pointer has
 * a position. The mapping screen stays pad-only, because it is about buttons.
 *
 * Both are driven by the adapter as well as by the DOM's own handling: a player
 * using a controller has no keyboard to fall back to, so a surface that could
 * only be operated with one would be a surface they cannot reach.
 */
import { CLOCKWISE_FROM_NORTH } from "./gamepad-analog";
import type { AngbandDirection } from "./input-door";
import { commandName, controlSurface, type ControlCommand } from "./control-surface";
import { addControlDomOwner } from "./input-door";
import { buttonName, describePad } from "./gamepad-device";
import { buildIcon, type IconName } from "./gamepad-wheel-icons";
import {
  WEDGES, WHEEL_GROUPS, entryFor, groupCommands, replyEntry,
} from "./gamepad-wheel-plan";
import {
  GAMEPAD_ROLES, ROLE_LABEL, defaultBindings, rebind, roleOf, saveBindings,
  type BindingTarget, type GamepadBindings,
} from "./gamepad-bindings";
import type { ConnectedPad, GamepadHost } from "./gamepad-input";
import "./gamepad-controls.css";

export interface GamepadControlsHost {
  stop(): void;
}

/**
 * Where a wedge sits, as a fraction of the ring's radius.
 *
 * Two neighbours clear each other when EITHER axis separates them: on a ring of
 * eight, the north/north-east pair is separated horizontally by r*sin(45deg)
 * and the north-east/east pair vertically by r*cos(45deg), both 0.707r. So a
 * wedge no wider and no taller than 0.707r never touches one.
 */
const RADIUS_PERCENT = 38;

type Ring =
  | { readonly kind: "groups" }
  | { readonly kind: "group"; readonly id: string; readonly page: number }
  /** The replies of the prompt that was open when the wheel was opened. */
  | { readonly kind: "replies"; readonly token: number; readonly page: number };

interface Wedge {
  /** The full name, carried by the hub and by the accessible label. */
  readonly label: string;
  /** The one word printed under the icon. */
  readonly word: string;
  readonly icon: IconName;
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
  /** True while the wheel is on screen, whatever opened it. */
  wheelOpen(): boolean;
  /** Open the wheel from a pointer gesture rather than from a pad button. */
  openWheel(): void;
  closeWheel(): void;
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
  let ring: Ring = { kind: "groups" };
  let cursor = 0;
  let legendRow = 0;
  let releaseCapture: (() => void) | undefined;
  let noticeTimer: number | undefined;
  let adapter: { captureButton(report: (index: number) => void): () => void; setBindings(index: number, bindings: GamepadBindings): void } | undefined;
  /* The current ring's nodes and the hub line they write into. Held so that
   * moving the cursor repaints two attributes and one string rather than
   * rebuilding the ring: a pointer moves the cursor on every wedge it crosses,
   * and replacing the node under the pointer mid-gesture would cancel the
   * gesture that was selecting it. */
  let wedgeNodes: HTMLButtonElement[] = [];
  let wedgeItems: readonly Wedge[] = [];
  let hubHint: HTMLElement | undefined;

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

  /* A press that is not on a wedge is the pointer's ABANDON gesture, and it is
   * the same act as Escape on the keyboard and Cancel on the pad. It has to be
   * absorbed as well as acted on: the map is underneath, and a click that
   * closed the wheel and then walked the character would be one gesture doing
   * two things. */
  root.addEventListener("pointerdown", (event) => {
    if (open === undefined) return;
    /* The secondary button's own gesture is `contextmenu`, below. Closing here
     * as well would close on the press and let the menu event fall through to
     * the canvas, which would open the wheel straight back up. */
    if (event.button !== 0) return;
    const at = event.target as HTMLElement | null;
    if (at?.closest(".gamepad-wedge")) return;
    if (open === "legend" && at?.closest(".gamepad-legend")) return;
    event.preventDefault();
    /* THE HUB IS THE POINTER'S CANCEL, and it runs the pad's Cancel outright
     * rather than something like it. Without it a pointer had no way back from
     * a group's ring to the eight groups: the gesture that opens the wheel is
     * the gesture that closes it, so the only route was to close and reopen.
     * The centre of a radial is where every shipped one puts cancel anyway. */
    if (open === "wheel" && at?.closest(".gamepad-hub")) cancelRing();
    else close();
  });
  /* A second right-click closes the wheel the first one opened, and the
   * browser's own menu never appears over it. Bound on this root rather than on
   * the canvas because the wheel covers the canvas while it is up. */
  root.addEventListener("contextmenu", (event) => {
    if (open === undefined) return;
    event.preventDefault();
    close();
  });

  /** The pad most recently reported, which is the one the notice named. */
  function pad(): ConnectedPad | undefined {
    return pads.at(-1);
  }

  function commands(): readonly ControlCommand[] {
    return controlSurface.commands();
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
  function replyWedges(token: number, page: number): readonly Wedge[] {
    const snapshot = controlSurface.current();
    if (!snapshot || snapshot.token !== token) return [];
    const replies = (snapshot.context.replies ?? []).filter((action) => action.direction === undefined);
    return pageOf(replies, page).map((action) => ({
      label: action.label,
      ...replyEntry(action),
      disabled: action.disabled,
      take: () => {
        close();
        controlSurface.invoke(token, action.id);
      },
    }));
  }

  /** The commands on one group's ring, or every unclaimed command for More. */
  function inGroup(id: string): readonly ControlCommand[] {
    const group = WHEEL_GROUPS.find((candidate) => candidate.id === id);
    return group ? groupCommands(group, commands()) : [];
  }

  /**
   * The wheel's current ring.
   *
   * Two levels, never three. Eight choices per level with one level of nesting
   * is where a radial menu was measured to stay under a ten percent error rate;
   * a third level is where that stops being true, so a long group pages rather
   * than subdividing.
   */
  function wedges(): readonly Wedge[] {
    if (ring.kind === "replies") return replyWedges(ring.token, ring.page);
    if (ring.kind === "groups") {
      const all = commands();
      return WHEEL_GROUPS.map((group) => {
        const held = groupCommands(group, all).length;
        return {
          label: group.word,
          word: group.word,
          icon: group.icon,
          detail: `${held} command${held === 1 ? "" : "s"}`,
          take: () => {
            ring = { kind: "group", id: group.id, page: 0 };
            cursor = 0;
            render();
          },
        };
      });
    }
    return pageOf(inGroup(ring.id), ring.page).map((command) => ({
      label: command.label,
      ...entryFor(command),
      disabled: command.disabled,
      take: () => {
        close();
        controlSurface.invokeCommand(command.id);
      },
    }));
  }

  function ringPages(): number {
    const current = ring;
    // The first ring is exactly the eight groups, so it never pages: the page
    // counter only appears once the player is inside one.
    if (current.kind === "groups") return 1;
    if (current.kind === "group") return pageCount(inGroup(current.id).length);
    const snapshot = controlSurface.current();
    if (!snapshot || snapshot.token !== current.token) return 1;
    return pageCount((snapshot.context.replies ?? [])
      .filter((action) => action.direction === undefined).length);
  }

  /** The name the hub shows over the current ring. */
  function ringTitle(): string {
    const current = ring;
    if (current.kind === "group") {
      return WHEEL_GROUPS.find((group) => group.id === current.id)?.word ?? "Commands";
    }
    if (current.kind === "replies") return controlSurface.current()?.context.label ?? "Prompt";
    return "Commands";
  }

  /**
   * One step back, for the pad's Cancel button and the pointer's hub alike.
   *
   * Backing out of a group returns to the eight groups; backing out of a
   * prompt's replies closes the wheel and leaves the prompt alone, because the
   * prompt's own Cancel is one of the replies rather than this gesture.
   */
  function cancelRing(): void {
    if (open === "wheel" && ring.kind === "group") {
      ring = { kind: "groups" };
      cursor = 0;
      render();
      return;
    }
    close();
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
      : { kind: "groups" };
    cursor = 0;
    render();
  }

  function renderWheel(): void {
    wheel.replaceChildren();
    const items = wedges();
    const hub = document.createElement("div");
    hub.className = "gamepad-hub";
    const title = document.createElement("strong");
    title.textContent = ringTitle();
    const hint = document.createElement("span");
    hubHint = hint;
    const pages = ringPages();
    // The hub carries the selected item's name IN FULL. That is what makes the
    // one word at the rim safe: the wedge says Nearest and the hub says Fire at
    // nearest target, so nothing is lost by shortening the label under an icon.
    hub.append(title, hint);
    if (pages > 1) {
      const page = document.createElement("small");
      page.textContent = `Page ${(ring.kind === "groups" ? 0 : ring.page) + 1} of ${pages}`;
      hub.append(page);
    }
    wheel.append(hub);
    wedgeNodes = [];
    wedgeItems = items;
    items.forEach((item, index) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "gamepad-wedge";
      node.setAttribute("role", "option");
      // The wedge prints one word; the full name is what a screen reader gets,
      // for the same reason the hub carries it.
      node.setAttribute("aria-label", item.detail
        ? `${item.label}, ${item.detail}` : item.label);
      node.disabled = item.disabled ?? false;
      // Placed by angle rather than laid out in a grid: the whole point of a
      // radial is that every choice is the same distance from the centre, and
      // that only holds if the position comes from the angle. The offset is a
      // fraction of the RING, not of the wedge, so every wedge sits at the same
      // radius whatever its own size.
      const angle = (index * (2 * Math.PI)) / WEDGES;
      node.style.left = `${50 + RADIUS_PERCENT * Math.sin(angle)}%`;
      node.style.top = `${50 - RADIUS_PERCENT * Math.cos(angle)}%`;
      // Icon first: it is the indicator a player reads, and the word beneath is
      // the confirmation rather than the other way round.
      node.append(buildIcon(item.icon));
      const word = document.createElement("span");
      word.textContent = item.word;
      node.append(word);
      /* POINT, THEN COMMIT - the same two steps on all three devices. The
       * pointer's pointing is crossing the wedge, and its commit is the click
       * that follows. A wedge is never taken by the pointer LEAVING it, for the
       * same reason the pad does not select on release: letting go is how a
       * player abandons a wheel, and a gesture cannot both choose and abandon. */
      node.addEventListener("pointerenter", () => {
        if (cursor === index) return;
        cursor = index;
        paintSelection();
      });
      node.addEventListener("click", (event) => {
        event.preventDefault();
        cursor = index;
        item.take();
      });
      wheel.append(node);
      wedgeNodes.push(node);
    });
    paintSelection();
  }

  /**
   * The cursor, repainted in place.
   *
   * Two attributes and one string, rather than `renderWheel` again: the hub
   * carries the selected item's name IN FULL, which is what makes the one word
   * at the rim safe - the wedge says Nearest and the hub says Fire at nearest
   * target - and that line is the only thing a cursor move changes.
   */
  function paintSelection(): void {
    wedgeNodes.forEach((node, index) => {
      node.setAttribute("aria-selected", String(index === cursor));
    });
    const selected = wedgeItems[cursor];
    if (hubHint) {
      hubHint.textContent = selected
        ? selected.detail ? `${selected.label} - ${selected.detail}` : selected.label
        : "";
    }
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
    const name = target.slice(4);
    return commands().find((command) => commandName(command) === name)?.label
      ?? `Command ${name}`;
  }

  /**
   * Every command a button can be bound to, named by `commandName`.
   *
   * Named that way rather than by `key` because `key` is undefined for two
   * kinds of row and filtering on it dropped both from this list. Center map is
   * the visible one: its only key belongs to the roguelike keyset, so the row
   * had no name, and a player reading the mapping screen found the command
   * missing rather than merely awkward to reach.
   *
   * A player keymap is left out on purpose. Its label carries the macro's own
   * action text, so the name changes when the macro is edited and a binding
   * saved against it would come back pointing at nothing.
   */
  function targetChoices(): readonly { readonly value: string; readonly label: string; readonly group: string }[] {
    const roles = GAMEPAD_ROLES.map((role) => ({
      value: `role:${role}`, label: ROLE_LABEL[role], group: "Controller",
    }));
    const named = commands()
      .filter((command) => !command.id.startsWith("macro:"))
      .map((command) => ({
        value: `cmd:${commandName(command)}`, label: command.label, group: command.category,
      }));
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
    /* An open wheel owns the pointer for the whole viewport, not just for its
     * own circle. Without this the map underneath keeps taking clicks, and a
     * mouse aiming at a wedge and missing walks the character instead. */
    root.classList.toggle("gamepad-modal", open !== undefined);
    if (open === "wheel") renderWheel();
    else {
      // Emptied rather than merely hidden: a wedge left in the tree keeps DOM
      // focus, and this root claims the keyboard for anything focused inside
      // it, so the next keypress would go to a wheel that is not on screen.
      wheel.replaceChildren();
      wedgeNodes = [];
      wedgeItems = [];
      hubHint = undefined;
    }
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
      if (index < 0 || index >= wedgeItems.length) return;
      cursor = index;
      paintSelection();
    },
    overlayConfirm: () => {
      if (open === "legend") return;
      // Point, then press. Selecting on RELEASE instead would make cancelling a
      // wheel impossible without a second gesture, because letting go is how a
      // player abandons one. Read from the RENDERED ring rather than recomputed,
      // so a pad confirms the wedge the player is looking at; a disabled one is
      // left alone rather than closing the wheel on a refusal.
      const item = wedgeItems[cursor];
      if (item && !item.disabled) item.take();
    },
    overlayCancel: () => { cancelRing(); },
    overlayPage: (delta: number) => {
      if (open !== "wheel" || ring.kind === "groups") return;
      const pages = ringPages();
      const page = ((ring.page + delta) % pages + pages) % pages;
      ring = { ...ring, page };
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
    wheelOpen: () => open === "wheel",
    openWheel,
    closeWheel: close,
    dispose: () => {
      if (noticeTimer !== undefined) clearTimeout(noticeTimer);
      releaseCapture?.();
      removeOwner();
      root.remove();
    },
  };
}
