/**
 * @neo-angband/mcp - a Model Context Protocol server for Neo Angband.
 *
 * The library half. `server.ts` is the executable (`neo-angband-mcp`); everything
 * it needs is here, so a host that wants the game exposed over some other
 * transport can take `GameHost` and the tool table and skip the stdio wiring.
 *
 * The whole thing rides core's FROZEN agent API and reaches nothing else, which
 * is the property worth protecting: an AI control surface with a privileged path
 * into the engine would stop being a test of whether the modding API is honest.
 */

export { GameHost } from "./host.js";
export { GameSession, SessionError, isAwaitingInput } from "./session.js";
export type { ActResult, NewGameOptions } from "./session.js";
export { TOOLS, callTool, stepTarget } from "./tools.js";
export type { JsonSchema, ToolDef, ToolHost, ToolResult } from "./tools.js";
export {
  DIRECTION_KEYPAD,
  depthLabel,
  directionTo,
  distance,
  renderCell,
  renderItem,
  renderMap,
  renderStatus,
} from "./render.js";
export type { RenderOptions, RenderedMap } from "./render.js";
