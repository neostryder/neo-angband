#!/usr/bin/env node
/**
 * The executable: an MCP server on stdio.
 *
 * The ONLY file here that knows about MCP. Everything the tools do lives in
 * tools.ts against a plain `ToolHost`, so the test suite drives the real game
 * through the real tools with no transport at all - which is the difference
 * between testing that a tool works and testing that it is registered.
 *
 * STDIO IS A DATA CHANNEL, NOT A LOG. An MCP stdio server speaks JSON-RPC on
 * stdout, so anything else written there corrupts the stream and the client
 * disconnects with a parse error that names nothing. Diagnostics go to stderr,
 * and there is no console.log in this package.
 *
 * Run it with plain `node dist/server.js` - no loader flags, no wrapper. That is
 * a requirement rather than a preference: an MCP client spawns a command, and it
 * is why the engine's 4612 extensionless import specifiers had to be fixed rather
 * than papered over with a resolve hook.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ENGINE_VERSION, PARITY_BASELINE } from "@neo-angband/core";
import { GameHost } from "./host.js";
import { TOOLS, callTool } from "./tools.js";
import { depthLabel, renderMap, renderStatus } from "./render.js";

const INSTRUCTIONS = `Neo Angband: an exact-parity TypeScript port of Angband ${PARITY_BASELINE}.

You are playing a roguelike. It is unforgiving, and death is PERMANENT - there is
no save-scumming, no undo, and no reload. A character you lose is lost.

The loop that works:
  1. new_game            - roll a character (the seed comes back; keep it)
  2. map / status         - see where you are and what is near
  3. walk / attack / ...  - act, and READ THE MESSAGES that come back
  4. repeat

Practical notes that will otherwise cost you a character:
  - Read the messages after every action. A command can succeed, be refused, or
    cost several game turns, and the messages are the only place that shows up.
  - Rest when hurt, before descending. HP does not regenerate quickly.
  - Items are addressed by HANDLE, from \`inventory\`. Not by inventory letter.
  - Melee is walking into a monster. \`attack\` is the same thing, named clearly,
    and it refuses when there is nothing there rather than moving you.
  - Directions are keypad digits (8 north, 2 south, 4 west, 6 east) or compass
    words. y increases southward.
  - \`commands\` lists the whole vocabulary. Read it rather than guessing.

Everything here goes through the game's public agent API - the same one any
third-party automation uses. There is no privileged path, so if something seems
impossible, it may genuinely be missing from that API, and that is worth saying.`;

/** The one resource: what the game looks like right now. */
const CURRENT_GAME_URI = "neo-angband://game/current";

async function main(): Promise<void> {
  const host = new GameHost();

  /* The LOW-LEVEL Server rather than McpServer, because the tool schemas here are
   * plain JSON Schema and McpServer's registerTool takes a Zod shape. Writing them
   * twice - once as Zod for the SDK and once as JSON Schema for the docs - is two
   * descriptions of one contract, and they would drift. */
  const server = new Server(
    { name: "neo-angband", version: ENGINE_VERSION },
    { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((def) => ({
      name: def.name,
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema as { type: "object" },
      annotations: {
        title: def.title,
        /* `mutates` is the game's own notion; these are the closest honest
         * mapping. Nothing here is destructive in MCP's sense (it does not touch
         * the user's data) and nothing is idempotent - a second `walk east` is a
         * second step. */
        readOnlyHint: !def.mutates,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const result = callTool(
      host,
      request.params.name,
      (request.params.arguments ?? {}) as Record<string, unknown>,
    );
    return {
      content: [{ type: "text" as const, text: result.text }],
      ...(result.isError === true ? { isError: true } : {}),
    };
  });

  /* A resource, not a tool, for the current board: it costs no tool call, a client
   * can attach it to context directly, and it is cacheable. The same text is
   * available through `status` and `map` for a client that only does tools. */
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [
      {
        uri: CURRENT_GAME_URI,
        name: "current-game",
        title: "The game right now",
        description:
          "Status, the map around the character, and the visible monsters - the same text " +
          "the status and map tools return.",
        mimeType: "text/plain",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    if (request.params.uri !== CURRENT_GAME_URI) {
      throw new Error(`unknown resource ${request.params.uri}`);
    }
    const session = host.session();
    let text = "No game is running. Call the new_game tool.";
    if (session !== null) {
      const map = renderMap(session.view);
      text = [
        `seed ${String(session.seed)}, ${depthLabel(session.view.player().depth)}`,
        "",
        ...renderStatus(session.view),
        "",
        ...map.rows,
        "",
        ...map.legend,
      ].join("\n");
    }
    return { contents: [{ uri: request.params.uri, mimeType: "text/plain", text }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[neo-angband-mcp] ready - ${String(TOOLS.length)} tools, engine ${ENGINE_VERSION}, ` +
      `parity baseline ${PARITY_BASELINE}\n`,
  );

  /* Uninstall the controller on the way out. The process is about to end, so it
   * changes nothing today; it is here so that a future in-process host (attaching
   * to a running desktop game) does not leave a controller bound to a live
   * GameState after the client hangs up. */
  const shutdown = (): void => {
    host.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e: unknown) => {
  process.stderr.write(`[neo-angband-mcp] fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
