/**
 * The one front-end slot.
 *
 * Front ends are deliberately selected before they are invoked: a lower-loaded
 * plugin must not mount a screen or retain game data when a later plugin wins.
 * The default glyph consumer remains the fallback when no selected plugin
 * supplies a sink, and after a selected sink faults.
 */

import type { ModPlugin, ModPluginContext } from "./mod-plugin";
import { snapshotWorldFrame, type WorldFrameSink } from "./world-view";

export interface FrontendPlugin {
  readonly id: string;
  readonly plugin: Pick<ModPlugin, "frontend">;
}

export interface InstalledFrontend {
  readonly id: string;
  readonly sink: WorldFrameSink;
}

/** The last plugin in load order that declares frontend is the only candidate. */
export function selectedFrontendPlugin(
  plugins: readonly FrontendPlugin[],
): FrontendPlugin | undefined {
  for (let i = plugins.length - 1; i >= 0; i--) {
    const plugin = plugins[i]!;
    if (plugin.plugin.frontend !== undefined) return plugin;
  }
  return undefined;
}

/** Invoke the selected candidate and contain an installation failure to that mod. */
export function installFrontend(
  plugins: readonly FrontendPlugin[],
  contextFor: (id: string) => ModPluginContext,
  reportFault: (id: string, message: string, error: unknown) => void,
): InstalledFrontend | null {
  const selected = selectedFrontendPlugin(plugins);
  if (!selected) return null;
  try {
    const sink = selected.plugin.frontend!.call(selected.plugin, contextFor(selected.id));
    if (sink === undefined) return null;
    if (typeof sink !== "object" || sink === null || typeof sink.present !== "function") {
      reportFault(selected.id, "frontend() did not return a WorldFrameSink; the glyph front end stays active", sink);
      return null;
    }
    /* The SDK owns the public frame type; world-view's live frame is
     * structurally identical and this adapter keeps the runtime boundary local. */
    return { id: selected.id, sink: { present: (frame) => sink.present(frame) } };
  } catch (error) {
    reportFault(selected.id, "frontend() failed, so the glyph front end stays active", error);
    return null;
  }
}

/**
 * Route the live map producer to the selected frontend, or exactly the old
 * glyph consumer.  A plugin receives an immutable, structurally owned snapshot
 * and cannot make a bad front end strand the player on a blank map.
 */
export function frontendWorldFrameSink(
  fallback: WorldFrameSink,
  frontend: InstalledFrontend | null,
  reportFault: (id: string, message: string, error: unknown) => void,
): WorldFrameSink {
  if (!frontend) return fallback;
  let active = true;
  return {
    present(frame) {
      if (!active) {
        fallback.present(frame);
        return;
      }
      try {
        frontend.sink.present(snapshotWorldFrame(frame));
      } catch (error) {
        active = false;
        reportFault(frontend.id, "frontend display failed; the glyph front end has resumed", error);
        fallback.present(frame);
      }
    },
  };
}
