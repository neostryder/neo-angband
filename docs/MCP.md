# The MCP server

`packages/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server that lets an AI client **play Neo Angband**: roll a character, read the
map, fight, descend, and die permanently.

It is not a debug hatch. Every read goes through core's frozen agent view and
every write through its act facade, so the server has exactly the reach a
third-party agent mod has — no privileged path and no test hook. That is the
property worth protecting: an AI control surface with a private door into the
engine would stop being a test of whether the modding API is honest.

## Running it

```bash
pnpm build
```

```bash
node packages/mcp/dist/server.js
```

Plain `node`, no flags — an MCP client spawns a command, so there is nothing to
wrap. Point a client at it:

```json
{
  "mcpServers": {
    "neo-angband": {
      "command": "node",
      "args": ["C:/Repositories/neo-angband/packages/mcp/dist/server.js"]
    }
  }
}
```

Diagnostics go to **stderr**. stdout is the JSON-RPC channel and there is no
`console.log` anywhere in the package; one stray line there corrupts the stream
and the client disconnects with a parse error that names nothing.

## The tools

Nineteen, in four groups. Read-only tools take no game time.

| Tool | Mutates | What it is for |
| --- | --- | --- |
| `new_game` | yes | Roll a character. Reports the seed, which makes the game replayable |
| `status` | no | Vitals, position, depth, afflictions, every visible monster with its distance |
| `map` | no | ASCII map around the character, with a legend naming each monster and item |
| `look` | no | One square: terrain, visibility, monster, objects |
| `inventory` | no | Carried, worn and underfoot, each with the **handle** the item tools take |
| `spells` | no | Spellbooks, with the index `cast` takes |
| `shop` | no | Store stock, with the index `shop_action` takes |
| `commands` | no | The whole command vocabulary, in prose |
| `act` | yes | Any raw engine command. The general form; everything below is sugar |
| `walk` `attack` `rest` `stairs` `tunnel` | yes | Movement and melee |
| `use_item` `pickup` | yes | Items, by handle |
| `cast` `target` | yes | Magic and targeting |
| `shop_action` | yes | Buy, sell, leave |

Plus one resource, `neo-angband://game/current`, which is the status and map as
attachable text — no tool call, and cacheable.

Every mutating tool returns the same shape: **what happened** (the engine's own
messages, and how many game turns passed) then **where you now are**. An agent
that had to call `status` after every `walk` would spend half its calls on
bookkeeping.

### Sugar, and why both forms exist

`act {"code":"walk","args":{"dir":6}}` and `walk east` are the same command. A
model composing the envelope spends attention on the envelope; the named verbs
remove the ceremony and nothing else. `act` stays because a mod can register new
command codes, and the sugar cannot know about them.

`attack` is the one place the sugar does more than rename. Upstream melee **is**
walking into a monster, so an agent that meant to attack and hit empty floor gets
a move it did not ask for and a result that reads the same either way. `attack`
checks the square first and refuses.

## Errors are answers

A refused command comes back as text saying why, never as a thrown transport
error. An agent handed a protocol failure cannot recover; one told *"There is a
wall in the way!"* can try something else.

Two places where **the engine accepts nonsense quietly** and this server does
not, both found by driving it rather than by reading it:

- **An unknown race or class name.** `startGame` does not reject one — asking for
  a `Balrog` produced a Human, with no error anywhere. The session compares what
  was asked against what was born and refuses.
- **An unknown command code.** The loop accepted `ascend_to_heaven` cleanly, cost
  zero turns and emitted no message — indistinguishable, to an agent, from a
  command that was tried and refused. `act` asks the live registry first, so a
  code a mod added still works.

## The gap this exercise found, and where it was actually fixed

Measured on a fresh `startGame` boot, with no host seams wired: of 12740 cells,
`known` was true for **0** and `inView` for **0** — including the player's own
square. An agent driving the frozen facade could read its own statistics and see
monsters, and had **no map at all**.

The first diagnosis was that `runGameLoop` never refreshes the derived view. That
was wrong in an instructive way. Core calls `state.updateFov` from about
twenty-five sites — the level-entry flood, the after-action refresh in
`player-turn.ts`, every light and terrain effect — and every one of them is `?.`,
because `updateFov` is a **host seam**. What was missing was not a call. It was a
**default**: core supplied none, so a host that installed nothing got silence from
all twenty-five, and this host installed nothing.

`wireGame` now installs one (`packages/core/src/session/game.ts`), so `startGame`,
`loadGame` and every acting path maintain the view with no host cooperation. Same
seed, measured again: **19 known, 59 in view, the player's own square known**. This
package holds no refresh code at all now, and `packages/core/src/session/game.test.ts`
fails if a bare `startGame` ever comes back blank.

Three things came out with it, none of which a code reading would have offered:

- **`no_light` was disabled for every seam-less host.** `noLight` opened with `if
  (state.updateFov === undefined) return false`, described in its own comment as "a
  seam guard, not a rule of the game" — it existed because SEEN was clear
  everywhere, which would have made casting and reading permanently impossible. The
  premise is gone, so the guard is, and spell and scroll rules are upstream's for
  everyone.
- **A live crash on arena entry.** `wizLightLevel` refreshed the view immediately,
  where upstream's `wiz_light` only sets `PU_UPDATE_VIEW` for the next
  `update_stuff`. On the arena path that ran while `state.chunk` was already the new
  6×6 level and the player's grid was still the old one: `square out of bounds:
  75,31`. The web build has always installed a seam, so it was reachable there
  through `EF_SINGLE_COMBAT`; nothing had driven it.
- **Both hosts read the wrong field for the UNLIGHT view radius**, passing
  `chunk.depth` where `cave-view.c:778` reads `p->lev`. There is now one
  `viewerStateOf` in core and both use it.

Nothing in the repository could have caught the original. The Borg's tests run
against a hand-built fake `AgentView` — `packages/borg/src/harness.ts` says so in
its own header — so the live perceive path had never been driven by anything but
the web shell, which refreshes for its own drawing reasons.

## What it does not do

Stated rather than left to be discovered:

- **No save or load.** The save format is real and core owns it, but a tool that
  wrote savefiles would be the first thing in this package to touch the
  filesystem, and the save-scum policy makes "load an earlier state" a decision.
  A character that dies is gone.
- **No attaching to a running game.** The server owns its own headless game. The
  in-process host that would let an agent and a human share one session is the
  obvious next step and it is not built.
- **One game at a time.** `new_game` replaces the current one.

## Determinism is declared, not hidden

An AI on the other end of a socket is not a seeded RNG, so the controller
installs with `nondeterministic: true`, which trips core's one-way save ratchet.
A character an agent touched is flagged for as long as it exists, and there is no
option here to turn that off — the same rule the mod system applies to gameplay
mods.

The seed is still reported, and a seed plus a command list replays exactly: the
engine is a function of its seed (decision 22), and
`packages/mcp/src/mcp.test.ts` pins that two hosts at one seed produce identical
maps.

## Layout

| File | What it holds |
| --- | --- |
| `session.ts` | One live game. Arms a command, runs the real loop, drains messages |
| `host.ts` | Owns the session and the content pack; `new_game` replaces the session |
| `render.ts` | The ASCII map, the status block, item and cell lines |
| `tools.ts` | The tool table: name, JSON Schema, handler. **No MCP imports** |
| `server.ts` | The only file that knows about MCP |
| `mcp.test.ts` | 25 tests, every one against a real booted game |

The split at `tools.ts` is what lets the tests drive every tool through a real
game with no transport — the difference between testing that a tool works and
testing that it is registered.
