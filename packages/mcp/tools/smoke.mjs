#!/usr/bin/env node
/**
 * Spawn the MCP server and speak the protocol to it.
 *
 * WHY THIS EXISTS ALONGSIDE 25 UNIT TESTS. Those drive the tool handlers directly,
 * with no transport - which is what makes them fast and what makes them blind to
 * the transport. A break in the stdio wiring (a stray write to stdout, a schema the
 * SDK rejects, a handler registered under the wrong name) leaves every test green
 * and gives a real client one symptom: it disconnects, with a parse error that
 * names nothing.
 *
 * So this does the four things a client does on connect - initialize, list the
 * tools, call one, list the resources - against the built server, over a real pipe,
 * and fails loudly. Stdlib only: no test framework, no MCP client library, because
 * a smoke test that shares a library with the thing it tests can agree with it and
 * both be wrong.
 *
 *   node packages/mcp/tools/smoke.mjs
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "server.js");
if (!existsSync(entry)) {
  console.error(`[smoke] no built server at ${entry} - run \`pnpm build\` first`);
  process.exit(1);
}

const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (d) => {
  stdout += d;
});
child.stderr.on("data", (d) => {
  stderr += d;
});

const failures = [];
function check(label, ok, detail = "") {
  if (ok) console.log(`[smoke] ok   ${label}`);
  else {
    console.error(`[smoke] FAIL ${label}${detail === "" ? "" : ` - ${detail}`}`);
    failures.push(label);
  }
}

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

/** Resolve when a response with this id arrives, or reject after `ms`. */
function waitFor(id, ms = 20000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error(`timed out waiting for response ${String(id)}`));
    }, ms);
    const poll = setInterval(() => {
      for (const line of stdout.split("\n")) {
        if (line.trim() === "") continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          clearInterval(poll);
          clearTimeout(deadline);
          reject(new Error(`stdout is not JSON-RPC - something wrote to it: ${line.slice(0, 120)}`));
          return;
        }
        if (parsed.id === id) {
          clearInterval(poll);
          clearTimeout(deadline);
          resolve(parsed);
          return;
        }
      }
    }, 50);
  });
}

try {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "neo-angband-smoke", version: "0" },
    },
  });
  const init = await waitFor(1);
  check("initialize", init.result?.serverInfo?.name === "neo-angband", JSON.stringify(init.error ?? init.result?.serverInfo));
  check(
    "instructions are sent (a client with none has to guess how to play)",
    typeof init.result?.instructions === "string" && init.result.instructions.length > 200,
  );

  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = await waitFor(2);
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  check("tools/list returns the whole table", names.length >= 15, `got ${String(names.length)}`);
  for (const required of ["new_game", "map", "status", "walk", "act", "commands"]) {
    check(`tools/list includes ${required}`, names.includes(required));
  }
  const status = (tools.result?.tools ?? []).find((t) => t.name === "status");
  check("read-only tools are annotated as such", status?.annotations?.readOnlyHint === true);

  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "new_game", arguments: { seed: 20260731, depth: 1 } },
  });
  const called = await waitFor(3);
  const text = called.result?.content?.[0]?.text ?? "";
  check("tools/call new_game boots a real game", text.includes("seed 20260731"), text.slice(0, 160));
  check("and the map is not blank (the derived-view regression)", /[#.<>@]/u.test(text), text.slice(0, 160));

  send({ jsonrpc: "2.0", id: 4, method: "resources/list" });
  const resources = await waitFor(4);
  check(
    "resources/list offers the current game",
    (resources.result?.resources ?? []).some((r) => r.uri === "neo-angband://game/current"),
  );

  send({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "walk", arguments: { direction: "east" } },
  });
  const walked = await waitFor(5);
  check(
    "a command reports the engine's own messages",
    (walked.result?.content?.[0]?.text ?? "").includes("game turn(s) passed"),
  );

  check("nothing but JSON-RPC reached stdout", !stdout.includes("[neo-angband-mcp]"));
  check("the ready line went to stderr", stderr.includes("[neo-angband-mcp] ready"));
} catch (error) {
  console.error(`[smoke] FAIL ${error instanceof Error ? error.message : String(error)}`);
  failures.push("protocol exchange");
} finally {
  child.kill();
}

if (failures.length > 0) {
  console.error(`[smoke] ${String(failures.length)} failure(s)`);
  if (stderr !== "") console.error(`[smoke] server stderr:\n${stderr}`);
  process.exit(1);
}
console.log("[smoke] the MCP server speaks the protocol");
