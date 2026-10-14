/**
 * main.ts's setKeymapResolver call, run rather than read.
 *
 * `main.ts` is a module-scope shell that boots a canvas and a game, so
 * importing it is out (see main-long-press.test.ts's note on the same
 * constraint). This compiles the real `setKeymapResolver(...)` statement out
 * of `main.ts` and drives the captured resolver directly, the same
 * extract-and-run technique main-long-press.test.ts uses for its pointer
 * block - so what fails here is the actual runtime gate, not a text pattern
 * that could stay green after the logic regressed.
 *
 * Before #62/#63's fix this resolver rejected any `key.key.length !== 1`,
 * so a keymap bound to Enter or a plain F-key was accepted by the editor
 * (keymap-edit.ts) yet could never actually fire: the runtime gate silently
 * refused it before `keymapFind` ever ran.
 */

import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearKeymaps,
  decodeActionTokens,
  isBindableTriggerKey,
  keymapAdd,
  keymapFind,
  keymapModeFor,
} from "./keymap-store";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const source = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.ES2023, true);

/** The single `setKeymapResolver(...)` call statement, module scope. */
function resolverStatementSource(): string {
  const statement = source.statements.find(
    (s) =>
      ts.isExpressionStatement(s) &&
      ts.isCallExpression(s.expression) &&
      ts.isIdentifier(s.expression.expression) &&
      s.expression.expression.text === "setKeymapResolver",
  );
  expect(statement, "main.ts no longer calls setKeymapResolver at module scope").toBeDefined();
  return mainSource.slice(statement!.getStart(source), statement!.getEnd());
}

interface UiKey {
  readonly key: string;
  readonly modifiers: { readonly ctrl: boolean; readonly shift: boolean; readonly alt: boolean; readonly meta: boolean };
  readonly repeat: boolean;
}
type UiInput = { readonly key?: UiKey };
type Resolver = (input: UiInput) => readonly { readonly key: UiKey }[] | null;
interface ResolverOptions {
  readonly enabled?: () => boolean;
  readonly onExpanded?: (input: UiInput) => void;
}

/**
 * Compile the real statement and capture what it passes to (a fake)
 * `setKeymapResolver`, wiring the real keymap-store functions in as the free
 * variables the arrow function closes over - `state`/`dead`/`scoresOpen`/
 * `modalDepth`/`pumping`/`logKeypress` are the only ones left to main.ts's
 * shell, so those are stubbed.
 */
function buildResolver(opts: { dead?: boolean; roguelike?: boolean } = {}): {
  readonly resolver: Resolver;
  readonly options: ResolverOptions;
} {
  const emitted = ts.transpileModule(resolverStatementSource(), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
  }).outputText;
  let resolver: Resolver | undefined;
  let options: ResolverOptions | undefined;
  const state = {
    options: { get: (k: string) => (k === "rogue_like_commands" ? (opts.roguelike ?? false) : undefined) },
  };
  new Function(
    "setKeymapResolver",
    "isBindableTriggerKey",
    "keymapFind",
    "keymapModeFor",
    "decodeActionTokens",
    "state",
    "dead",
    "scoresOpen",
    "modalDepth",
    "pumping",
    "logKeypress",
    emitted,
  )(
    (r: Resolver, o: ResolverOptions) => {
      resolver = r;
      options = o;
    },
    isBindableTriggerKey,
    keymapFind,
    keymapModeFor,
    decodeActionTokens,
    state,
    opts.dead ?? false,
    false,
    0,
    false,
    () => undefined,
  );
  expect(resolver, "setKeymapResolver's first argument was not captured").toBeDefined();
  return { resolver: resolver!, options: options ?? {} };
}

function key(k: string): UiInput {
  return { key: { key: k, modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false } };
}

describe("main.ts's keymap resolver accepts a named trigger key (#62, #63)", () => {
  afterEach(() => clearKeymaps());

  it("expands a keymap bound to a plain F-key (#62)", () => {
    keymapAdd(keymapModeFor(false), "F5", "q");
    const { resolver } = buildResolver();
    expect(resolver(key("F5"))).toEqual([
      { key: { key: "q", modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false } },
    ]);
  });

  it("expands a keymap bound to Enter (#63)", () => {
    keymapAdd(keymapModeFor(false), "Enter", "q");
    const { resolver } = buildResolver();
    expect(resolver(key("Enter"))).toEqual([
      { key: { key: "q", modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false } },
    ]);
  });

  it("expands 'R&[Enter]' into R, &, and a literal Enter keypress (#63's rest-until-reason example)", () => {
    keymapAdd(keymapModeFor(false), "X", "R&[Enter]");
    const { resolver } = buildResolver();
    const expansion = resolver(key("X"));
    expect(expansion?.map((e) => e.key.key)).toEqual(["R", "&", "Enter"]);
  });

  it("returns null with no keymap bound, for an F-key or Enter", () => {
    const { resolver } = buildResolver();
    expect(resolver(key("F5"))).toBeNull();
    expect(resolver(key("Enter"))).toBeNull();
  });

  it("still refuses a key held with Ctrl/Alt/Meta even when a keymap exists", () => {
    keymapAdd(keymapModeFor(false), "F5", "q");
    const { resolver } = buildResolver();
    const withCtrl: UiInput = { key: { key: "F5", modifiers: { ctrl: true, shift: false, alt: false, meta: false }, repeat: false } };
    expect(resolver(withCtrl)).toBeNull();
  });

  it("still refuses F13, which is outside the accepted F1-F12 row", () => {
    keymapAdd(keymapModeFor(false), "F13", "q");
    const { resolver } = buildResolver();
    expect(resolver(key("F13"))).toBeNull();
  });

  it("'?' stays a root affordance even if a mod or player binds it", () => {
    keymapAdd(keymapModeFor(false), "?", "q");
    const { resolver } = buildResolver();
    expect(resolver(key("?"))).toBeNull();
  });

  it("no keymap fires once the character is dead", () => {
    keymapAdd(keymapModeFor(false), "F5", "q");
    const { resolver } = buildResolver({ dead: true });
    expect(resolver(key("F5"))).toBeNull();
  });
});
