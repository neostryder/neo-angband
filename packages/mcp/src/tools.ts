/**
 * The tools, and the reason each one exists.
 *
 * Deliberately SDK-free. A tool here is a name, a JSON Schema and a function from
 * arguments to text; `server.ts` is the only file that knows about MCP. That split
 * is not tidiness - it is what lets the test suite drive every tool against a real
 * game without a transport, which is the only way to find out whether a tool
 * actually works rather than whether it is registered.
 *
 * WHAT THE SET IS FOR. An agent needs to answer four questions, over and over:
 * where am I, what is near me, what can I do, and what happened when I did it.
 * The tools map onto those and nothing else:
 *
 *   new_game / status          - where am I
 *   look / map / inventory     - what is near me
 *   commands                   - what can I do (the vocabulary, not a guess)
 *   act / walk / attack / ...  - do it, and get back what happened
 *
 * `act` is the general form and every other verb is sugar over it. Both are
 * offered because a model that has to compose `{"code":"walk","args":{"dir":6}}`
 * spends its attention on the envelope; `walk east` is the same command with the
 * ceremony removed. The sugar is thin on purpose - it builds a command through
 * core's own act facade and changes nothing else.
 *
 * ERRORS ARE ANSWERS. A refused command returns text saying why, never a thrown
 * transport error: an agent that gets a protocol failure has no way to recover,
 * while one told "there is no monster to the east" can try something else. The
 * only exceptions are argument shapes the schema should have caught, which are
 * bugs in the client.
 */

import { message, type GameSession } from "./session.js";
import {
  DIRECTION_KEYPAD,
  depthLabel,
  directionTo,
  distance,
  renderCell,
  renderItem,
  renderMap,
  renderStatus,
} from "./render.js";
import type { AgentCommand, AgentView, ItemView } from "@neo-angband/core";

/** A JSON Schema object, loose enough not to re-type the whole spec here. */
export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  name: string;
  /** One line for a tool list. */
  title: string;
  /** What it does, when to use it, and what it returns. Read by a model. */
  description: string;
  inputSchema: JsonSchema;
  /** True when the tool changes the game. Surfaced as an MCP annotation. */
  mutates: boolean;
}

/** What a tool call produced: text for the client, plus whether it failed. */
export interface ToolResult {
  text: string;
  isError?: boolean;
}

/** What a tool handler is given. The host owns the session so tools can replace it. */
export interface ToolHost {
  /** The live game, or null before `new_game`. */
  session(): GameSession | null;
  /** Start a fresh game, replacing any current one. */
  newGame(opts: { seed?: number; depth?: number; raceName?: string; className?: string }): GameSession;
}

type Args = Record<string, unknown>;
type Handler = (host: ToolHost, args: Args) => ToolResult;

const DIR_NAMES = Object.keys(DIRECTION_KEYPAD);

const DIR_SCHEMA: JsonSchema = {
  oneOf: [
    { type: "integer", minimum: 1, maximum: 9, description: "keypad digit (8 = north)" },
    { type: "string", enum: DIR_NAMES },
  ],
  description: "A direction, as a keypad digit 1-9 or a compass word.",
};

/* ------------------------------------------------------------------ *
 * Argument reading. A schema is a promise the CLIENT makes; these are the
 * checks that hold when it does not, and they report rather than throw.
 * ------------------------------------------------------------------ */

function readDirection(args: Args, key = "direction"): number {
  const raw = args[key];
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 9) return raw;
  if (typeof raw === "string") {
    const dir = DIRECTION_KEYPAD[raw.toLowerCase()];
    if (dir !== undefined) return dir;
  }
  throw new ArgError(
    `${key} must be a keypad digit 1-9 or one of: ${DIR_NAMES.join(", ")} (got ${JSON.stringify(raw)})`,
  );
}

function readInt(args: Args, key: string): number {
  const raw = args[key];
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  throw new ArgError(`${key} must be an integer (got ${JSON.stringify(raw)})`);
}

function optionalInt(args: Args, key: string): number | undefined {
  return args[key] === undefined ? undefined : readInt(args, key);
}

class ArgError extends Error {}

/** The session, or a refusal that says how to get one. */
function live(host: ToolHost): GameSession {
  const session = host.session();
  if (session === null) {
    throw new ArgError("no game is running - call new_game first");
  }
  return session;
}

/* ------------------------------------------------------------------ *
 * Reporting. Every mutating tool returns the SAME shape - what happened, then
 * where you now are - because an agent that has to call `status` after every
 * `walk` spends half its calls on bookkeeping.
 * ------------------------------------------------------------------ */

function reportAfter(session: GameSession, command: AgentCommand): string {
  const result = session.perform(command);
  const lines: string[] = [];
  lines.push(
    `${describeCommand(command)} - ${String(result.turnsElapsed)} game turn(s) passed.`,
  );
  if (result.messages.length > 0) {
    lines.push("", "Messages:");
    for (const m of result.messages) lines.push(`  ${m}`);
  } else {
    lines.push("", "Messages: (none)");
  }
  if (result.died) {
    lines.push(
      "",
      "*** You have died. ***",
      "This character is gone: Neo Angband has no save-scumming and death is terminal.",
      "Call new_game to start another.",
    );
    return lines.join("\n");
  }
  lines.push("", ...renderStatus(session.view));
  const threats = nearbyThreats(session.view);
  if (threats.length > 0) lines.push("", "Visible monsters:", ...threats.map((t) => `  ${t}`));
  return lines.join("\n");
}

function describeCommand(command: AgentCommand): string {
  const args = command.args === undefined ? "" : ` ${JSON.stringify(command.args)}`;
  return `${command.code}${args}`;
}

function nearbyThreats(view: AgentView): string[] {
  const player = view.player();
  return view
    .monsters()
    .filter((m) => m.visible)
    .map((m) => ({ m, d: distance(player.grid, m.grid) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 12)
    .map(({ m, d }) => {
      const dir = d === 1 ? directionTo(player.grid, m.grid) : null;
      return (
        `${m.race} (id ${String(m.id)}) ${String(m.hp)}/${String(m.maxHp)} hp, ${String(d)} away` +
        (dir === null ? "" : `, ADJACENT to the ${dirWord(dir)} (dir ${String(dir)})`) +
        (m.asleep ? ", asleep" : "")
      );
    });
}

function dirWord(dir: number): string {
  for (const [name, value] of Object.entries(DIRECTION_KEYPAD)) {
    if (value === dir) return name;
  }
  return String(dir);
}

/* ------------------------------------------------------------------ *
 * The tools.
 * ------------------------------------------------------------------ */

interface Entry {
  def: ToolDef;
  run: Handler;
}

const ENTRIES: Entry[] = [
  {
    def: {
      name: "new_game",
      title: "Start a new character",
      description:
        "Roll a new character and generate its first level. Replaces any game in progress " +
        "(that character is lost - there is no save-scumming). Returns the seed used, which " +
        "makes the whole game reproducible, plus the opening status and map.",
      mutates: true,
      inputSchema: {
        type: "object",
        properties: {
          seed: {
            type: "integer",
            description:
              "RNG seed. Omit for a random one, which is reported back. The engine is a " +
              "function of its seed, so the same seed and the same commands replay exactly.",
          },
          depth: {
            type: "integer",
            minimum: 0,
            maximum: 127,
            description: "Starting depth: 0 is the town, 1 is 50 ft. Default 1.",
          },
          race: { type: "string", description: 'Race name, e.g. "Half-Troll". Default Human.' },
          class: { type: "string", description: 'Class name, e.g. "Mage". Default Warrior.' },
        },
      },
    },
    run: (host, args) => {
      const session = host.newGame({
        ...(args["seed"] === undefined ? {} : { seed: readInt(args, "seed") }),
        ...(args["depth"] === undefined ? {} : { depth: readInt(args, "depth") }),
        ...(typeof args["race"] === "string" ? { raceName: args["race"] } : {}),
        ...(typeof args["class"] === "string" ? { className: args["class"] } : {}),
      });
      const map = renderMap(session.view);
      return {
        text: [
          `New game. seed ${String(session.seed)} - pass this to new_game to replay it exactly.`,
          `agent API ${session.apiVersion}; this character is flagged non-reproducible ` +
            `because an agent is driving it (${String(session.nondeterministic)}).`,
          "",
          ...renderStatus(session.view),
          "",
          ...map.rows,
          "",
          ...(map.legend.length > 0 ? map.legend : ["(nothing of note in view)"]),
        ].join("\n"),
      };
    },
  },
  {
    def: {
      name: "status",
      title: "Character status",
      description:
        "The character's vital statistics, position, depth and afflictions, plus every " +
        "visible monster with its distance. Call this when you need to know where you stand " +
        "without taking a turn. Takes no game time.",
      mutates: false,
      inputSchema: { type: "object", properties: {} },
    },
    run: (host) => {
      const session = live(host);
      const threats = nearbyThreats(session.view);
      return {
        text: [
          ...renderStatus(session.view),
          `seed ${String(session.seed)}`,
          "",
          ...(threats.length > 0
            ? ["Visible monsters:", ...threats.map((t) => `  ${t}`)]
            : ["No monsters in view."]),
        ].join("\n"),
      };
    },
  },
  {
    def: {
      name: "map",
      title: "Draw the map",
      description:
        "An ASCII map around the character, with a legend naming every monster and item on " +
        "it. Glyphs: @ you, . floor, # wall, + closed door, ' open door, < up stairs, " +
        "> down stairs, ^ trap, % vein, * vein with treasure, ~ lava, : rubble, 1-8 shop " +
        "entrances, a space for a square you have never seen. Digits and letters elsewhere " +
        "are legend labels. Takes no game time.",
      mutates: false,
      inputSchema: {
        type: "object",
        properties: {
          radius_x: { type: "integer", minimum: 1, maximum: 99, description: "Half-width. Default 20." },
          radius_y: { type: "integer", minimum: 1, maximum: 99, description: "Half-height. Default 10." },
          full: { type: "boolean", description: "Draw the whole level instead of a window." },
        },
      },
    },
    run: (host, args) => {
      const session = live(host);
      const map = renderMap(session.view, {
        ...(args["radius_x"] === undefined ? {} : { radiusX: readInt(args, "radius_x") }),
        ...(args["radius_y"] === undefined ? {} : { radiusY: readInt(args, "radius_y") }),
        ...(args["full"] === true ? { full: true } : {}),
      });
      const bounds = session.view.mapBounds();
      return {
        text: [
          `${depthLabel(session.view.player().depth)}, level is ${String(bounds.width)}x${String(bounds.height)}; ` +
            `showing ${String(map.window.x0)},${String(map.window.y0)} to ${String(map.window.x1)},${String(map.window.y1)} ` +
            `(${String(map.unknownCells)} unexplored squares in view)`,
          "",
          ...map.rows,
          "",
          ...(map.legend.length > 0 ? map.legend : ["(nothing of note in view)"]),
        ].join("\n"),
      };
    },
  },
  {
    def: {
      name: "look",
      title: "Examine one square",
      description:
        "What is on a single square: its terrain, whether you can see or only remember it, " +
        "any monster, any objects. Use it to check a square before stepping onto it. Takes " +
        "no game time.",
      mutates: false,
      inputSchema: {
        type: "object",
        properties: {
          x: { type: "integer" },
          y: { type: "integer" },
        },
        required: ["x", "y"],
      },
    },
    run: (host, args) => {
      const session = live(host);
      const x = readInt(args, "x");
      const y = readInt(args, "y");
      const cell = session.view.cell(x, y);
      if (cell === null) {
        const b = session.view.mapBounds();
        return {
          text: `${String(x)},${String(y)} is off the level (0..${String(b.width - 1)} by 0..${String(b.height - 1)}).`,
          isError: true,
        };
      }
      const lines = [renderCell(cell)];
      const items = session.view.floorItems(x, y);
      if (items.length > 0) {
        lines.push("Objects here:");
        items.forEach((item, i) => lines.push(`  ${renderItem(item, i)}`));
      }
      const monster = session.view.monsters().find((m) => m.id === cell.monster);
      if (monster !== undefined) {
        lines.push(
          `Monster: ${monster.race} (id ${String(monster.id)}), ${String(monster.hp)}/${String(monster.maxHp)} hp, ` +
            `speed ${String(monster.speed)}, level ${String(monster.level)}` +
            (monster.raceFlags.length > 0 ? `, flags ${monster.raceFlags.join(" ")}` : ""),
        );
      }
      return { text: lines.join("\n") };
    },
  },
  {
    def: {
      name: "inventory",
      title: "Inventory and equipment",
      description:
        "Everything you carry and wear. Each line carries the HANDLE that item tools take - " +
        "handles are stable while the item exists, unlike inventory letters, so use the " +
        "handle. Also lists objects on your own square. Takes no game time.",
      mutates: false,
      inputSchema: { type: "object", properties: {} },
    },
    run: (host) => {
      const session = live(host);
      const view = session.view;
      const player = view.player();
      const lines: string[] = ["Carried:"];
      const pack = view.inventory();
      if (pack.length === 0) lines.push("  (nothing)");
      pack.forEach((item, i) => lines.push(`  ${renderItem(item, i)}`));

      lines.push("", "Worn:");
      const worn = view.equipment().filter((e): e is ItemView => e !== null);
      if (worn.length === 0) lines.push("  (nothing)");
      worn.forEach((item, i) => lines.push(`  ${renderItem(item, i)}`));

      const floor = view.floorItems(player.grid.x, player.grid.y);
      if (floor.length > 0) {
        lines.push("", "On your square (pickup takes it):");
        floor.forEach((item, i) => lines.push(`  ${renderItem(item, i)}`));
      }
      lines.push("", `Gold: ${String(player.gold)}`);
      return { text: lines.join("\n") };
    },
  },
  {
    def: {
      name: "spells",
      title: "Spellbooks and spells",
      description:
        "The spells your class can cast, with their book, level, cost and failure rate, and " +
        "the spell index `cast` takes. Empty for a Warrior. Takes no game time.",
      mutates: false,
      inputSchema: { type: "object", properties: {} },
    },
    run: (host) => {
      const session = live(host);
      const books = session.view.spellbooks();
      if (books.length === 0) {
        return { text: "This class casts no spells." };
      }
      const lines: string[] = [];
      for (const book of books) {
        lines.push(`${book.name}:`);
        for (const spell of book.spells) {
          /* `chance` is the LIVE failure percent - base fail adjusted for level,
           * stat, low mana, fear and stun - and it is absent when the derived stat
           * indices are not available. Reported when present and labelled as base
           * when not, rather than presenting one number as the other. */
          const fail =
            spell.chance === undefined
              ? `${String(spell.fail)}% base fail`
              : `${String(spell.chance)}% fail`;
          lines.push(
            `  index ${String(spell.sidx)}: ${spell.name} - level ${String(spell.level)}, ` +
              `${String(spell.mana)} mana, ${fail}` +
              (spell.learned ? "" : " (NOT YET LEARNED)") +
              (spell.forgotten ? " (FORGOTTEN)" : ""),
          );
        }
      }
      return { text: lines.join("\n") };
    },
  },
  {
    def: {
      name: "shop",
      title: "What the shop is selling",
      description:
        "The stock of the store you are standing in, with the index `buy` takes and the " +
        "price. Only meaningful in town, on a shop entrance. Takes no game time.",
      mutates: false,
      inputSchema: { type: "object", properties: {} },
    },
    run: (host) => {
      const session = live(host);
      const stores = session.view.stores();
      if (stores.length === 0) {
        return { text: "No stores here - stores exist in the town (depth 0)." };
      }
      const lines: string[] = [];
      for (const store of stores) {
        lines.push(
          `${store.featName}${store.isHome ? " (your home - nothing is for sale)" : ""}, ` +
            `keeper ${store.owner.name} (purse ${String(store.owner.purse)}):`,
        );
        if (store.stock.length === 0) lines.push("  (empty)");
        for (const item of store.stock) {
          /* The item's OWN index, not the loop counter: `buy` takes the store's
           * stock index, and the two would diverge the moment a view filtered. */
          lines.push(
            `  index ${String(item.index)}: ${item.label}` +
              (item.price === undefined ? "" : ` - ${String(item.price)} gold`),
          );
        }
      }
      return { text: lines.join("\n") };
    },
  },
  {
    def: {
      name: "commands",
      title: "The command vocabulary",
      description:
        "Every verb `act` accepts, with its arguments. Read this instead of guessing: `act` " +
        "passes a command code straight to the engine's registry, so a code that is not " +
        "listed here is refused rather than approximated.",
      mutates: false,
      inputSchema: { type: "object", properties: {} },
    },
    run: () => ({ text: COMMAND_REFERENCE }),
  },
  {
    def: {
      name: "act",
      title: "Issue any command",
      description:
        "The general form: send a raw engine command. Use it for anything the named verbs " +
        "below do not cover. `commands` lists the vocabulary. Returns the messages the " +
        "engine emitted and your new status - which is the only way to learn what happened, " +
        "because a command can succeed, be refused in-game, or cost several turns.",
      mutates: true,
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: 'Command code, e.g. "walk", "rest", "quaff".' },
          args: { type: "object", description: "Command arguments, e.g. {\"dir\": 6}." },
        },
        required: ["code"],
      },
    },
    run: (host, args) => {
      const session = live(host);
      const code = args["code"];
      if (typeof code !== "string" || code === "") {
        throw new ArgError("code must be a non-empty string; call `commands` for the vocabulary");
      }
      const raw = args["args"];
      if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) {
        throw new ArgError("args must be an object");
      }
      /* The loop accepts an unknown code in silence - zero turns, no message -
       * which reads exactly like a command that was tried and refused. Asked of the
       * LIVE registry, so a code a mod registered still works. */
      if (!session.knowsCommand(code)) {
        throw new ArgError(
          `the engine has no command "${code}". Call \`commands\` for the vocabulary; ` +
            `a mod can add codes, and this checks the live registry rather than a fixed list.`,
        );
      }
      return {
        text: reportAfter(
          session,
          session.act_.raw(code, raw as Record<string, unknown> | undefined),
        ),
      };
    },
  },
  {
    def: {
      name: "walk",
      title: "Walk one step",
      description:
        "Step one square. Walking into an adjacent monster attacks it, which is how melee " +
        "works upstream - `attack` is the same command with a clearer name. Walking into a " +
        "closed door opens it.",
      mutates: true,
      inputSchema: {
        type: "object",
        properties: { direction: DIR_SCHEMA },
        required: ["direction"],
      },
    },
    run: (host, args) => {
      const session = live(host);
      return { text: reportAfter(session, session.act_.move(readDirection(args))) };
    },
  },
  {
    def: {
      name: "attack",
      title: "Melee an adjacent monster",
      description:
        "Attack the monster on an adjacent square. Refused, with a reason, when there is no " +
        "monster there - so it is safe to try. (Mechanically the same walk-into as `walk`.)",
      mutates: true,
      inputSchema: {
        type: "object",
        properties: { direction: DIR_SCHEMA },
        required: ["direction"],
      },
    },
    run: (host, args) => {
      const session = live(host);
      const dir = readDirection(args);
      const player = session.view.player();
      /* Checked HERE rather than let through, because walking into empty floor
       * looks identical in the result and an agent would read a move as a hit. */
      const target = stepTarget(player.grid, dir);
      const cell = session.view.cell(target.x, target.y);
      if (cell === null || cell.monster === 0) {
        return {
          text:
            `No monster to the ${dirWord(dir)} (${String(target.x)},${String(target.y)}). ` +
            `Use walk to move there, or status to list what is in view.`,
          isError: true,
        };
      }
      return { text: reportAfter(session, session.act_.melee(dir)) };
    },
  },
  {
    def: {
      name: "rest",
      title: "Rest",
      description:
        "Rest to recover hit points and mana. Rest stops on its own when something happens, " +
        "so this can cost many game turns; the returned turn count says how many.",
      mutates: true,
      inputSchema: { type: "object", properties: {} },
    },
    run: (host) => {
      const session = live(host);
      return { text: reportAfter(session, session.act_.rest()) };
    },
  },
  {
    def: {
      name: "stairs",
      title: "Take a staircase",
      description:
        'Descend (">") or ascend ("<"). You must be standing ON the staircase - the map draws ' +
        "them as < and >. Going down generates a new level.",
      mutates: true,
      inputSchema: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["down", "up"] },
        },
        required: ["direction"],
      },
    },
    run: (host, args) => {
      const session = live(host);
      const dir = args["direction"];
      if (dir !== "down" && dir !== "up") throw new ArgError('direction must be "down" or "up"');
      return {
        text: reportAfter(session, dir === "down" ? session.act_.descend() : session.act_.ascend()),
      };
    },
  },
  {
    def: {
      name: "tunnel",
      title: "Dig",
      description: "Tunnel into an adjacent wall, vein or rubble square. Usually takes many attempts.",
      mutates: true,
      inputSchema: {
        type: "object",
        properties: { direction: DIR_SCHEMA },
        required: ["direction"],
      },
    },
    run: (host, args) => {
      const session = live(host);
      return { text: reportAfter(session, session.act_.tunnel(readDirection(args))) };
    },
  },
  {
    def: {
      name: "use_item",
      title: "Use a carried item",
      description:
        "Quaff, read, eat, wear, take off, drop, destroy, aim a wand, zap a rod, use a staff, " +
        "activate an artifact, fire from a launcher, or throw. Takes the item's HANDLE from " +
        "`inventory`, not its inventory letter.",
      mutates: true,
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "quaff", "read", "eat", "wear", "takeoff", "drop", "destroy",
              "aim_wand", "zap_rod", "use_staff", "activate", "fire", "throw",
            ],
          },
          handle: { type: "integer", description: "The item handle from `inventory`." },
          count: { type: "integer", minimum: 1, description: "How many, for drop. Default all." },
        },
        required: ["action", "handle"],
      },
    },
    run: (host, args) => {
      const session = live(host);
      const handle = readInt(args, "handle");
      const count = optionalInt(args, "count");
      const act = session.act_;
      const action = String(args["action"]);
      const build: Record<string, () => AgentCommand> = {
        quaff: () => act.quaff(handle),
        read: () => act.read(handle),
        eat: () => act.eat(handle),
        wear: () => act.wear(handle),
        takeoff: () => act.takeoff(handle),
        drop: () => (count === undefined ? act.drop(handle) : act.drop(handle, count)),
        destroy: () => act.destroy(handle),
        aim_wand: () => act.aimWand(handle),
        zap_rod: () => act.zapRod(handle),
        use_staff: () => act.useStaff(handle),
        activate: () => act.activate(handle),
        fire: () => act.fire(handle),
        throw: () => act.throw(handle),
      };
      const make = build[action];
      if (make === undefined) {
        throw new ArgError(`unknown action "${action}"; one of: ${Object.keys(build).join(", ")}`);
      }
      return { text: reportAfter(session, make()) };
    },
  },
  {
    def: {
      name: "pickup",
      title: "Pick up",
      description: "Pick up objects on your own square. `inventory` lists what is there.",
      mutates: true,
      inputSchema: { type: "object", properties: {} },
    },
    run: (host) => {
      const session = live(host);
      return { text: reportAfter(session, session.act_.pickup()) };
    },
  },
  {
    def: {
      name: "cast",
      title: "Cast a spell",
      description: "Cast by spell index - `spells` lists them. Aims at the current target if the spell needs one.",
      mutates: true,
      inputSchema: {
        type: "object",
        properties: { spell: { type: "integer", description: "Spell index from `spells`." } },
        required: ["spell"],
      },
    },
    run: (host, args) => {
      const session = live(host);
      return { text: reportAfter(session, session.act_.cast(readInt(args, "spell"))) };
    },
  },
  {
    def: {
      name: "target",
      title: "Set the target",
      description:
        "Target a monster by id (from `status` or `map`) or a location. Aimed effects use it. " +
        "Takes no game time; reports whether the target took, which it will not for a monster " +
        "you cannot see.",
      mutates: true,
      inputSchema: {
        type: "object",
        properties: {
          monster_id: { type: "integer" },
          x: { type: "integer" },
          y: { type: "integer" },
        },
      },
    },
    run: (host, args) => {
      const session = live(host);
      if (args["monster_id"] !== undefined) {
        const id = readInt(args, "monster_id");
        const ok = session.act_.setTargetMonster(id);
        return {
          text: ok
            ? `Targeting monster ${String(id)}.`
            : `Could not target monster ${String(id)} - it must exist and be visible.`,
          ...(ok ? {} : { isError: true }),
        };
      }
      if (args["x"] !== undefined && args["y"] !== undefined) {
        const x = readInt(args, "x");
        const y = readInt(args, "y");
        session.act_.setTargetLocation(x, y);
        return { text: `Targeting ${String(x)},${String(y)}.` };
      }
      throw new ArgError("pass either monster_id, or both x and y");
    },
  },
  {
    def: {
      name: "shop_action",
      title: "Buy, sell, or leave",
      description:
        "Buy by stock index (`shop` lists them), sell by item handle (`inventory` lists them), " +
        "or leave the store.",
      mutates: true,
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["buy", "sell", "exit"] },
          index: { type: "integer", description: "Stock index, for buy." },
          handle: { type: "integer", description: "Item handle, for sell." },
          count: { type: "integer", minimum: 1 },
        },
        required: ["action"],
      },
    },
    run: (host, args) => {
      const session = live(host);
      const act = session.act_;
      const count = optionalInt(args, "count");
      switch (args["action"]) {
        case "buy": {
          const index = readInt(args, "index");
          return {
            text: reportAfter(session, count === undefined ? act.shopBuy(index) : act.shopBuy(index, count)),
          };
        }
        case "sell": {
          const handle = readInt(args, "handle");
          return {
            text: reportAfter(session, count === undefined ? act.shopSell(handle) : act.shopSell(handle, count)),
          };
        }
        case "exit":
          return { text: reportAfter(session, act.shopExit()) };
        default:
          throw new ArgError('action must be "buy", "sell" or "exit"');
      }
    },
  },
];

/** One step from `grid` in keypad direction `dir`. */
export function stepTarget(
  grid: { x: number; y: number },
  dir: number,
): { x: number; y: number } {
  const dx = dir === 1 || dir === 4 || dir === 7 ? -1 : dir === 3 || dir === 6 || dir === 9 ? 1 : 0;
  const dy = dir >= 7 ? -1 : dir <= 3 ? 1 : 0;
  return { x: grid.x + dx, y: grid.y + dy };
}

/**
 * The vocabulary, in prose, for the `commands` tool.
 *
 * Written out rather than derived from the command registry, because the registry
 * knows a code's NAME and not what an agent has to pass with it - and a list of 43
 * bare codes is exactly the guess-and-be-refused loop this tool exists to prevent.
 * The named tools cover everything here; `act` is for anything a mod added.
 */
const COMMAND_REFERENCE = `Commands, and the tool that is easier than \`act\` for each.

Movement and terrain
  walk {dir}          -> tool: walk. Into a monster it attacks; into a door it opens.
  hold                -> act {"code":"hold"}. Stand still for a turn.
  rest                -> tool: rest.
  stairs down / up    -> tool: stairs. You must be standing on the staircase.
  tunnel {dir}        -> tool: tunnel.
  open / close {dir}  -> act {"code":"open","args":{"dir":6}}.
  disarm {dir}        -> act {"code":"disarm","args":{"dir":6}}.

Items - all take a HANDLE from \`inventory\`, never an inventory letter
  quaff, read, eat, wear, takeoff, drop, destroy   -> tool: use_item
  aim_wand, zap_rod, use_staff, activate           -> tool: use_item
  fire, throw                                      -> tool: use_item
  pickup                                           -> tool: pickup

Magic and targeting
  cast {spell index}  -> tool: cast. \`spells\` lists the indices.
  target              -> tool: target (by monster id, or by x/y).

Stores (town only, standing on a shop entrance)
  buy / sell / exit   -> tool: shop_action

Directions are keypad digits, with y increasing southward:
  7 8 9      northwest north northeast
  4 5 6      west      stay  east
  1 2 3      southwest south southeast
Every direction argument also accepts the compass word.

A command the engine's registry does not know is refused with a message; it is not
approximated. Mods can add codes, and \`act\` is how you reach them.`;

/** Every tool, in a stable order. */
export const TOOLS: readonly ToolDef[] = ENTRIES.map((e) => e.def);

/**
 * Run a tool by name. An unknown name, a bad argument or an engine refusal all
 * come back as an error RESULT rather than a thrown transport failure - see the
 * file header.
 */
export function callTool(host: ToolHost, name: string, args: Args = {}): ToolResult {
  const entry = ENTRIES.find((e) => e.def.name === name);
  if (entry === undefined) {
    return {
      text: `Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(", ")}`,
      isError: true,
    };
  }
  try {
    return entry.run(host, args);
  } catch (e) {
    return { text: message(e), isError: true };
  }
}
