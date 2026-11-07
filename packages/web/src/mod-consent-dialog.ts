import { matchCapability, MOD_PERMISSION_TEXT } from "@rpgm-tools/neo-angband-mod-sdk";
import { describeCapability } from "./capability-describe";
import { consentBinding } from "./mod-consent-binding";
import { playerHeld } from "./mod-tier";
import { suspendModPanels } from "./panel-runtime";
import type { CatalogMod, ConsentRecord } from "./mod-store";

function displayName(name: string): string {
  return [...name.normalize("NFKC").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")].slice(0, 120).join("") || MOD_PERMISSION_TEXT.unnamed;
}

function paragraph(text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = text;
  return element;
}

async function confirm(title: string, name: string, content: readonly HTMLElement[], primary: string): Promise<boolean> {
  if (typeof document === "undefined" || typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function") return false;
  const restore = suspendModPanels();
  // In-process mods can click page DOM consent; Worker mods cannot.
  let dialog: HTMLDialogElement | undefined;
  try {
    dialog = document.createElement("dialog");
    const panel = dialog;
    dialog.className = "neo-consent";
    // The game's own look: a black panel, light grey text, and the yellow of its cursor. The values are
    // literals, not page variables, so nothing on the page can restyle this dialog.
    dialog.style.cssText = "font:15px/1.5 'Cascadia Mono',Consolas,ui-monospace,monospace;color:#c0c0c0;background:#000000;color-scheme:dark;accent-color:#ffff00;border:1px solid #606060;border-radius:0;padding:20px 24px;width:min(42rem,calc(100vw - 48px));max-height:85vh;overflow:auto";
    const look = document.createElement("style");
    look.textContent = ".neo-consent::backdrop{background:rgba(0,0,0,.72)}" +
      ".neo-consent h2{margin:0 0 4px;font:inherit;font-weight:700;color:#ffffff}" +
      ".neo-consent h3{margin:0 0 12px;font:inherit;color:#ffff00}" +
      ".neo-consent p{margin:0 0 12px}" +
      ".neo-consent button{font:inherit;color:#c0c0c0;background:#000000;border:1px solid #606060;border-radius:0;padding:4px 14px;cursor:pointer}" +
      ".neo-consent button:hover{color:#ffffff;border-color:#c0c0c0}" +
      ".neo-consent button:focus-visible,.neo-consent input:focus-visible{outline:2px solid #ffff00;outline-offset:2px}";
    dialog.append(look);
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", title + ": " + displayName(name));
    const heading = document.createElement("h2");
    heading.textContent = title;
    const modName = document.createElement("h3");
    modName.textContent = displayName(name);
    dialog.append(heading, modName, ...content);
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = primary;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = MOD_PERMISSION_TEXT.cancel;
    cancel.style.marginLeft = "12px";
    dialog.append(accept, cancel);
    document.body.append(dialog);
    return await new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (allowed: boolean): void => {
        if (done) return;
        done = true;
        try { if (panel.open) panel.close(); }
        finally { resolve(allowed); }
      };
      accept.addEventListener("click", () => finish(true));
      cancel.addEventListener("click", () => finish(false));
      panel.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
      panel.addEventListener("close", () => finish(false));
      panel.addEventListener("keydown", (event) => event.stopPropagation());
      try { panel.showModal(); cancel.focus(); }
      catch { finish(false); }
    });
  } finally {
    try { dialog?.remove(); } finally { restore(); }
  }
}

export async function drawModPermissionConsent(
  asks: readonly { readonly mod: CatalogMod; readonly caps: readonly string[] }[],
  current?: (id: string) => ConsentRecord,
): Promise<Map<string, ConsentRecord> | null> {
  if (typeof document === "undefined") return null;
  const decisions = new Map<string, ConsentRecord>();
  for (const { mod, caps: requested } of asks) {
    const caps = [...new Set(requested)];
    if (caps.length === 0) continue;
    if (caps.length > 256) return null;
    const binding = consentBinding(mod.id);
    if (binding === null) return null;
    const prior = current?.(mod.id);
    const controls = new Map<string, HTMLInputElement>();
    const content: HTMLElement[] = [paragraph(mod.tier?.developerInProcess ? MOD_PERMISSION_TEXT.inProcess : MOD_PERMISSION_TEXT.isolatedNotice)];
    for (const capability of caps) {
      const detail = describeCapability(capability);
      const label = document.createElement("label");
      label.style.cssText = "display:flex;align-items:start;gap:12px;margin:10px 0";
      const input = document.createElement("input");
      input.type = "checkbox";
      const entry = matchCapability(capability)?.entry;
      const defaultGrant = entry !== undefined && !entry.powerful &&
        !/^(input|network|command|keymap):/.test(capability) && capability !== "ui:title";
      input.checked = prior?.granted.includes(capability) ? true : prior?.refused.includes(capability) ? false : defaultGrant;
      const text = document.createElement("span");
      text.textContent = detail.text;
      if (detail.elevated) text.style.cssText = "font-weight:700;color:#ffffff";
      label.append(input, text);
      controls.set(capability, input);
      content.push(label);
    }
    content.push(paragraph(MOD_PERMISSION_TEXT.bindingNotice));
    if (!(await confirm(MOD_PERMISSION_TEXT.permissionsTitle, mod.name, content, MOD_PERMISSION_TEXT.apply))) return null;
    if (consentBinding(mod.id) !== binding) return null;
    const granted = [...controls].filter(([, input]) => input.checked).map(([capability]) => capability);
    const refused = caps.filter((capability) => !granted.includes(capability));
    const held = playerHeld(caps, { granted, refused }).held;
    decisions.set(mod.id, { granted: held, refused: [...refused, ...granted.filter((capability) => !held.includes(capability))],
      ...(binding !== undefined ? { binding } : {}) });
  }
  return decisions;
}

export async function drawModControllerConsent(id: string, name: string): Promise<boolean> {
  const binding = consentBinding(id);
  if (!binding || typeof document === "undefined") return false;
  const allowed = await confirm(MOD_PERMISSION_TEXT.controlTitle, name, [paragraph(MOD_PERMISSION_TEXT.controller), paragraph(MOD_PERMISSION_TEXT.controllerMarking)], MOD_PERMISSION_TEXT.start);
  return allowed && binding === consentBinding(id);
}
