/**
 * The code checks: every script in a mod's payload, parsed and traced.
 *
 * The module graph comes first: what each file imports, whether that file is
 * in the mod, and whether the entry reaches it. Then a flow analysis follows
 * the three handles a mod is given (the API 1 context, the API 1 registry host
 * and the API 2 root) from the entry's default export through variables,
 * object fields, function calls, classes and imports, to every member the code
 * uses. A member that needs a capability the manifest lacks is a finding; a
 * place where the trail is lost (a computed member name, a handle passed to
 * code the analysis cannot see) is a could-not-check finding, never silence.
 *
 * The analysis is flow-insensitive and context-insensitive: it asks what a
 * name could ever hold, not what it holds on one line. That can only add
 * values, so it errs toward reporting a capability as used.
 *
 * The same walk finds the patterns that run code the payload does not show
 * (eval, the Function constructor, string timers, remote imports, script
 * elements), network use that skips the host's broker, WebAssembly and signs
 * of obfuscation.
 */

import type { CapabilitySet } from "../capabilities.js";
import { isLocalNetworkHost, networkGrantCovers, networkRequestCapability } from "../capabilities.js";
import { apiRangeVerdict, MOD_API2_VERSION } from "../api2/version.js";
import { API2_POLICY_KINDS, checkApi2Policies } from "../api2/policies.js";
import { IN_PROCESS_ENTRY, MOD_API_1_VERSION, WORKER_PREVIEW_API } from "../manifest-v2.js";
import type { Property } from "acorn";
import type { ModFinding, ModFindingEvidence } from "../mod-findings.js";
import { checkSecretHosts, isSecretName } from "../net-request.js";
import { satisfies } from "../semver.js";
import {
  EVENT_SUBSCRIBE,
  CONTROLLER_NEEDS,
  FACET_METHODS,
  NET_REQUEST,
  SECRET_BIND,
  TITLE_ROW,
  TITLE_ROW_ID,
  anyOf,
  gatedMember,
  memberKey,
  omittedWhenUngranted,
  reachesGated,
  type CapabilityNeed,
  type HandleRoot,
} from "./capability-map.js";
import { childNodes, parseSource, patternNames, resolveNames, type AnyNode, type Binding, type FunctionNode, type Program, type Resolution } from "./js-scope.js";
import { excerpt, finding, isScriptPath, textOf, type CheckSubject } from "./subject.js";

/** Passes of the flow analysis before it stops and says so. */
export const MAX_FLOW_PASSES = 24;
/** Values one name or field may hold before the analysis stops adding to it. */
export const MAX_VALUES_PER_SET = 1024;
/** Distinct strings one name or field tracks; past this it holds "some other string" instead. */
export const MAX_STRINGS_PER_SET = 32;
/** Object and array literals holding only literals and with more entries than this are tracked as one value. */
const DATA_TABLE_ENTRIES = 8;

/* ------------------------------------------------------------------ */
/* Abstract values                                                     */
/* ------------------------------------------------------------------ */

type Value =
  | { readonly k: "handle"; readonly id: string; readonly root: HandleRoot; readonly path: readonly string[] }
  | { readonly k: "obj"; readonly id: string; readonly node: AnyNode | null }
  | { readonly k: "fn"; readonly id: string; readonly node: FunctionNode; readonly module: string }
  | { readonly k: "class"; readonly id: string; readonly node: AnyNode; readonly module: string }
  | { readonly k: "ns"; readonly id: string; readonly module: string }
  | { readonly k: "global"; readonly id: string; readonly path: readonly string[] }
  | { readonly k: "invoke"; readonly id: string; readonly target: Value; readonly method: "call" | "apply" | "bind" }
  | { readonly k: "str"; readonly id: string; readonly value: string }
  /** A string or other value the analysis stopped tracking: never equal to any known string. */
  | { readonly k: "any"; readonly id: string };

type VSet = Set<Value>;
const EMPTY: VSet = new Set();

/** Names that stand for the global object itself. */
const GLOBAL_OBJECT_NAMES = new Set(["window", "self", "globalThis", "top", "parent", "frames"]);

/** Global functions that take a value without keeping it where code could reach it again. */
const SAFE_SINKS = new Set([
  "console.log", "console.info", "console.warn", "console.error", "console.debug",
  "JSON.stringify", "String", "Number", "Boolean", "Array.isArray", "Object.keys", "Object.isFrozen",
  "queueMicrotask", "Reflect.has", "Object.hasOwn", "Object.getPrototypeOf",
]);

/** Global constructors and functions that talk to the network directly. */
const DIRECT_NETWORK = new Map<string, string>([
  ["fetch", "fetch()"],
  ["XMLHttpRequest", "XMLHttpRequest"],
  ["WebSocket", "WebSocket"],
  ["EventSource", "EventSource"],
  ["navigator.sendBeacon", "navigator.sendBeacon()"],
  ["RTCPeerConnection", "RTCPeerConnection"],
  ["WebTransport", "WebTransport"],
]);

const EQUALITY = new Set(["==", "!=", "===", "!=="]);

const TIMERS = new Set(["setTimeout", "setInterval", "setImmediate"]);

/** Global constructors whose instances hold values the analysis follows as a collection. */
const COLLECTIONS = new Set(["Map", "Set", "WeakMap", "WeakSet", "Array", "Object", "WeakRef"]);

/** API 1 plugin methods the host calls with the context as their first argument. */
const API1_CTX_FIRST = ["hooks", "controller", "frontend", "hud", "menu", "screen", "birth", "regions"];

/* ------------------------------------------------------------------ */
/* Modules                                                             */
/* ------------------------------------------------------------------ */

interface ModuleInfo {
  readonly path: string;
  readonly source: string;
  readonly program: Program;
  readonly names: Resolution;
}

interface Edge {
  readonly from: string;
  readonly to: string;
  readonly dynamic: boolean;
}

/** Where a node sits, as finding evidence. */
function where(mod: { path: string; source: string }, node: AnyNode): ModFindingEvidence {
  const start = node.loc?.start.line ?? 1;
  const end = node.loc?.end.line ?? start;
  return { file: mod.path, lines: [start, end], excerpt: excerpt(mod.source.slice(node.start, Math.min(node.end, node.start + 160))) };
}

/** Join `spec` to the folder of `from`; null when it climbs out of the mod. */
function joinPath(from: string, spec: string): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const segment of spec.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(segment);
  }
  return parts.join("/");
}

const REMOTE_SPEC = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu;

type SpecifierVerdict =
  | { readonly kind: "local"; readonly path: string }
  | { readonly kind: "remote" | "bare" | "missing"; readonly why: string };

function judgeSpecifier(from: string, spec: string, files: ReadonlyMap<string, Uint8Array>): SpecifierVerdict {
  if (REMOTE_SPEC.test(spec)) return { kind: "remote", why: `imports ${spec}, which is not one of the mod's own files` };
  if (spec.startsWith("/")) return { kind: "missing", why: `imports ${spec}, an absolute path outside the mod folder` };
  if (!spec.startsWith("./") && !spec.startsWith("../")) {
    return { kind: "bare", why: `imports the package ${JSON.stringify(spec)}, which the game cannot resolve and the checker cannot see` };
  }
  const path = joinPath(from, spec);
  if (path === null) return { kind: "missing", why: `imports ${spec}, which leaves the mod folder` };
  const last = path.split("/").pop() ?? "";
  if (!last.includes(".")) return { kind: "missing", why: `imports ${spec} with no file extension; write the full file name, such as ${spec}.js` };
  if (!files.has(path)) return { kind: "missing", why: `imports ${spec}, and ${path} is not in the mod` };
  return { kind: "local", path };
}

/* ------------------------------------------------------------------ */
/* The analysis                                                        */
/* ------------------------------------------------------------------ */

interface Reach {
  /** The member's key (`ctx:installMod`), or `facet:<method>` for a plugin method. */
  readonly key: string;
  readonly need: CapabilityNeed;
  readonly what: string;
  readonly evidence: ModFindingEvidence;
  readonly guarded?: boolean;
}

/** What the checks are told about the mod beyond its files. */
export interface CodeCheckOptions {
  /** The manifest's grants, or null when the manifest cannot be read. */
  readonly caps: CapabilitySet | null;
  /** Payload paths whose contents could not be read (an archive entry left inflated). */
  readonly unread?: ReadonlySet<string>;
  /** The caller's coverage ledger includes modules reached through imports. */
  readonly parsed?: Set<string>;
}

class Analysis {
  readonly findings: ModFinding[] = [];
  readonly modules = new Map<string, ModuleInfo>();
  readonly edges: Edge[] = [];
  private readonly interned = new Map<string, Value>();
  private readonly bindingVals = new Map<Binding, VSet>();
  private readonly fieldVals = new Map<Value, Map<string, VSet>>();
  private readonly paramVals = new Map<FunctionNode, VSet[]>();
  private readonly functionModules = new Map<FunctionNode, string>();
  private readonly thisVals = new Map<FunctionNode, VSet>();
  private readonly returnVals = new Map<FunctionNode, VSet>();
  private readonly exportVals = new Map<string, Map<string, VSet>>();
  private readonly classInstance = new Map<AnyNode, Value>();
  private readonly classCtor = new Map<AnyNode, FunctionNode>();
  private readonly classSuper = new Map<AnyNode, VSet>();
  private memo = new Map<AnyNode, VSet>();
  private readonly stringCount = new WeakMap<VSet, number>();
  private readonly anyValue: Value = { k: "any", id: "?" };
  /** Every large literal data table, as one value. */
  private readonly dataValue: Value = { k: "obj", id: "o:data", node: null };
  private changed = false;
  private overflow = false;
  /** True on the last pass, once values have settled: the only pass that records findings. */
  private reporting = false;

  private mod!: ModuleInfo;
  private fnStack: FunctionNode[] = [];
  private thisStack: VSet[] = [];
  private classStack: AnyNode[] = [];

  private guards = new Set<string>();

  private guardKeys(node: AnyNode, truthy: boolean): Set<string> {
    if (node.type === "UnaryExpression" && node.operator === "!") return this.guardKeys(node.argument, !truthy);
    if (node.type === "LogicalExpression" && ((node.operator === "&&" && truthy) || (node.operator === "||" && !truthy))) {
      return new Set([...this.guardKeys(node.left, truthy), ...this.guardKeys(node.right, truthy)]);
    }
    if (node.type === "BinaryExpression" && EQUALITY.has(node.operator)) {
      const typeofNode = node.left.type === "UnaryExpression" && node.left.operator === "typeof" ? node.left :
        node.right.type === "UnaryExpression" && node.right.operator === "typeof" ? node.right : null;
      const other = typeofNode === node.left ? node.right : node.left;
      const equal = node.operator === "==" || node.operator === "===";
      if (typeofNode !== null && other.type === "Literal" && typeof other.value === "string" &&
        (other.value === "undefined" ? truthy !== equal : truthy === equal)) return this.guardKeys(typeofNode.argument, true);
    }
    if (!truthy || (node.type !== "Identifier" && node.type !== "MemberExpression")) return new Set();
    return new Set([...this.ev(node)].filter((v) => v.k === "handle").map((v) => memberKey(v.root, v.path)));
  }

  private withGuards<T>(keys: Iterable<string>, visit: () => T): T {
    const previous = this.guards;
    this.guards = new Set([...previous, ...keys]);
    try {
      return visit();
    } finally {
      this.guards = previous;
    }
  }

  /* What the reporting pass collects. */
  readonly reaches: Reach[] = [];
  readonly computed: ModFindingEvidence[] = [];
  readonly globalComputed: ModFindingEvidence[] = [];
  readonly invocations: ModFindingEvidence[] = [];
  readonly escapes: ModFindingEvidence[] = [];
  readonly evals: Array<{ readonly what: string; readonly evidence: ModFindingEvidence }> = [];
  readonly network: Array<{ readonly what: string; readonly evidence: ModFindingEvidence }> = [];
  readonly workers: ModFindingEvidence[] = [];
  readonly scripts: ModFindingEvidence[] = [];
  readonly requests: Array<{ readonly url: AnyNode | null; readonly values: VSet; readonly evidence: ModFindingEvidence; readonly direct: boolean }> = [];
  readonly titleRows: Array<{ readonly id: VSet; readonly evidence: ModFindingEvidence }> = [];
  readonly secretBinds: Array<{ readonly name: VSet; readonly hosts: VSet | null; readonly evidence: ModFindingEvidence }> = [];
  readonly eventSubs: Array<{ readonly names: VSet; readonly evidence: ModFindingEvidence }> = [];
  readonly dynamicImports: Array<{ readonly module: string; readonly node: AnyNode; readonly spec: string | null }> = [];
  readonly remoteScripts: Array<{ readonly evidence: ModFindingEvidence; readonly spec: string | null }> = [];

  constructor(private readonly files: ReadonlyMap<string, Uint8Array>) {}

  /* ---------- values ---------- */

  private intern<V extends Value>(value: V): V {
    const hit = this.interned.get(value.id);
    if (hit !== undefined) return hit as V;
    this.interned.set(value.id, value);
    return value;
  }

  handle(root: HandleRoot, path: readonly string[]): Value {
    return this.intern({ k: "handle", id: `h:${root}:${path.join(".")}`, root, path });
  }

  private obj(node: AnyNode | null, tag: string): Value {
    return this.intern({ k: "obj", id: `o:${this.mod.path}:${tag}:${node?.start ?? ""}`, node });
  }

  private fnValue(node: FunctionNode): Value {
    this.functionModules.set(node, this.mod.path);
    return this.intern({ k: "fn", id: `f:${this.mod.path}:${node.start}`, node, module: this.mod.path });
  }

  private global(path: readonly string[]): Value {
    return this.intern({ k: "global", id: `g:${path.join(".")}`, path });
  }

  private str(value: string): Value {
    return this.intern({ k: "str", id: `s:${value}`, value });
  }

  private ns(module: string): Value {
    return this.intern({ k: "ns", id: `n:${module}`, module });
  }

  /** Add `from` into `into`; true when anything was new. */
  private addAll(into: VSet, from: Iterable<Value>): void {
    for (let v of from) {
      if (into.has(v)) continue;
      if (v.k === "str") {
        const strings = this.stringCount.get(into) ?? 0;
        if (strings >= MAX_STRINGS_PER_SET) {
          v = this.anyValue;
          if (into.has(v)) continue;
        } else this.stringCount.set(into, strings + 1);
      }
      if (into.size >= MAX_VALUES_PER_SET) {
        this.overflow = true;
        return;
      }
      into.add(v);
      this.changed = true;
    }
  }

  private slot<K>(map: Map<K, VSet>, key: K): VSet {
    let set = map.get(key);
    if (set === undefined) {
      set = new Set();
      map.set(key, set);
    }
    return set;
  }

  private fields(owner: Value): Map<string, VSet> {
    let map = this.fieldVals.get(owner);
    if (map === undefined) {
      map = new Map();
      this.fieldVals.set(owner, map);
    }
    return map;
  }

  private exportsOf(module: string): Map<string, VSet> {
    let map = this.exportVals.get(module);
    if (map === undefined) {
      map = new Map();
      this.exportVals.set(module, map);
    }
    return map;
  }

  private params(fn: FunctionNode): VSet[] {
    let list = this.paramVals.get(fn);
    if (list === undefined) {
      list = fn.params.map(() => new Set<Value>());
      this.paramVals.set(fn, list);
    }
    return list;
  }

  /** The default export of `module`, once the analysis has run. */
  defaultExport(module: string): VSet {
    return this.exportVals.get(module)?.get("default") ?? EMPTY;
  }

  fieldsOf(value: Value): ReadonlyMap<string, VSet> {
    return this.fieldVals.get(value) ?? new Map();
  }

  /** Seed parameter `index` of every function in `vals` with `value`. */
  seedParam(vals: VSet, index: number, value: Value): void {
    for (const v of vals) {
      if (v.k !== "fn") continue;
      const list = this.params(v.node);
      const slot = list[index];
      if (slot !== undefined) this.addAll(slot, [value]);
      this.addAll(this.slot(this.fields(this.argumentsValue(v.node, v.module)), "[]"), [value]);
    }
  }

  /* ---------- driving ---------- */

  addModule(path: string, source: string, program: Program): void {
    this.modules.set(path, { path, source, program, names: resolveNames(program) });
  }

  /** Run passes until nothing changes; false when the limit was reached first. */
  run(seed: () => void): boolean {
    for (const list of [this.reaches, this.computed, this.globalComputed, this.invocations, this.escapes, this.evals, this.network,
      this.workers, this.scripts, this.requests, this.titleRows, this.secretBinds, this.eventSubs, this.dynamicImports, this.remoteScripts, this.wasm]) list.length = 0;
    let passes = 0;
    do {
      this.changed = false;
      this.memo = new Map();
      seed();
      for (const mod of this.modules.values()) this.walkModule(mod);
      passes++;
    } while (this.changed && passes < MAX_FLOW_PASSES);
    const settled = !this.changed;
    this.reporting = true;
    this.memo = new Map();
    seed();
    for (const mod of this.modules.values()) this.walkModule(mod);
    this.reporting = false;
    return settled && !this.overflow;
  }

  private walkModule(mod: ModuleInfo): void {
    this.mod = mod;
    this.fnStack = [];
    this.thisStack = [EMPTY];
    this.classStack = [];
    this.guards = new Set();
    for (const statement of mod.program.body) this.stmt(statement);
  }

  private ev_(mod: ModuleInfo, node: AnyNode): ModFindingEvidence {
    return where(mod, node);
  }

  private at(node: AnyNode): ModFindingEvidence {
    return this.ev_(this.mod, node);
  }

  /* ---------- statements ---------- */

  private stmt(node: AnyNode): void {
    switch (node.type) {
      case "ExpressionStatement":
        this.ev(node.expression);
        return;
      case "IfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
        this.ev(node.test);
        if (node.type === "IfStatement") {
          this.withGuards(this.guardKeys(node.test, true), () => this.stmt(node.consequent));
          if (node.alternate) this.withGuards(this.guardKeys(node.test, false), () => this.stmt(node.alternate as AnyNode));
        } else if (node.type === "WhileStatement") this.withGuards(this.guardKeys(node.test, true), () => this.stmt(node.body));
        else this.stmt(node.body);
        return;
      case "VariableDeclaration":
        for (const d of node.declarations) this.bindPattern(d.id, d.init ? this.ev(d.init) : EMPTY);
        return;
      case "FunctionDeclaration": {
        const fn = this.evFunction(node);
        if (node.id) this.bindPattern(node.id, fn);
        return;
      }
      case "ClassDeclaration": {
        const cls = this.evClass(node);
        if (node.id) this.bindPattern(node.id, cls);
        return;
      }
      case "ReturnStatement": {
        const fn = this.fnStack[this.fnStack.length - 1];
        const vals = node.argument ? this.ev(node.argument) : EMPTY;
        if (fn !== undefined) this.addAll(this.slot(this.returnVals, fn), vals);
        return;
      }
      case "ForOfStatement":
      case "ForInStatement": {
        const right = this.ev(node.right);
        const elems = node.type === "ForOfStatement" ? this.elementsOf(right) : EMPTY;
        if (node.left.type === "VariableDeclaration") for (const d of node.left.declarations) this.bindPattern(d.id, elems);
        else this.assignPattern(node.left, elems);
        this.stmt(node.body);
        return;
      }
      case "ImportDeclaration":
        this.linkImport(node);
        return;
      case "ExportNamedDeclaration":
        this.linkExportNamed(node);
        return;
      case "ExportDefaultDeclaration": {
        const decl = node.declaration;
        let vals: VSet;
        if (decl.type === "FunctionDeclaration") {
          vals = this.evFunction(decl);
          if (decl.id) this.bindPattern(decl.id, vals);
        } else if (decl.type === "ClassDeclaration") {
          vals = this.evClass(decl);
          if (decl.id) this.bindPattern(decl.id, vals);
        } else vals = this.ev(decl);
        this.addAll(this.slot(this.exportsOf(this.mod.path), "default"), vals);
        return;
      }
      case "ExportAllDeclaration":
        this.linkExportAll(node);
        return;
      default:
        for (const child of childNodes(node)) {
          if (isStatementLike(child)) this.stmt(child);
          else if (child.type === "VariableDeclarator") this.bindPattern(child.id, child.init ? this.ev(child.init) : EMPTY);
          else this.ev(child);
        }
    }
  }

  /* ---------- imports and exports ---------- */

  private target(spec: string): string | null {
    const verdict = judgeSpecifier(this.mod.path, spec, this.files);
    return verdict.kind === "local" && this.modules.has(verdict.path) ? verdict.path : null;
  }

  private linkImport(node: Extract<AnyNode, { type: "ImportDeclaration" }>): void {
    const target = typeof node.source.value === "string" ? this.target(node.source.value) : null;
    for (const s of node.specifiers) {
      const binding = this.mod.names.decls.get(s.local);
      if (binding === undefined) continue;
      let vals: VSet = EMPTY;
      if (target !== null) {
        if (s.type === "ImportNamespaceSpecifier") vals = new Set([this.ns(target)]);
        else {
          const name = s.type === "ImportDefaultSpecifier" ? "default" : moduleExportName(s.imported);
          vals = this.exportsOf(target).get(name) ?? EMPTY;
        }
      }
      this.addAll(this.slot(this.bindingVals, binding), vals);
    }
  }

  private linkExportNamed(node: Extract<AnyNode, { type: "ExportNamedDeclaration" }>): void {
    const exports = this.exportsOf(this.mod.path);
    if (node.declaration) {
      this.stmt(node.declaration);
      const ids = node.declaration.type === "VariableDeclaration"
        ? node.declaration.declarations.flatMap((d) => patternNames(d.id))
        : node.declaration.id ? [node.declaration.id] : [];
      for (const id of ids) {
        const binding = this.mod.names.decls.get(id);
        if (binding !== undefined) this.addAll(this.slot(exports, id.name), this.bindingVals.get(binding) ?? EMPTY);
      }
      return;
    }
    const target = node.source && typeof node.source.value === "string" ? this.target(node.source.value) : null;
    for (const s of node.specifiers) {
      const exported = moduleExportName(s.exported);
      const local = moduleExportName(s.local);
      let vals: VSet = EMPTY;
      if (node.source) {
        if (target !== null) vals = this.exportsOf(target).get(local) ?? EMPTY;
      } else if (s.local.type === "Identifier") {
        vals = this.identifier(s.local);
      }
      this.addAll(this.slot(exports, exported), vals);
    }
  }

  private linkExportAll(node: Extract<AnyNode, { type: "ExportAllDeclaration" }>): void {
    const target = typeof node.source.value === "string" ? this.target(node.source.value) : null;
    if (target === null) return;
    const exports = this.exportsOf(this.mod.path);
    if (node.exported) {
      this.addAll(this.slot(exports, moduleExportName(node.exported)), [this.ns(target)]);
      return;
    }
    for (const [name, vals] of this.exportsOf(target)) if (name !== "default") this.addAll(this.slot(exports, name), vals);
  }

  /* ---------- patterns ---------- */

  /** Bind a declaration pattern to `vals`. */
  private bindPattern(pattern: AnyNode, vals: VSet): void {
    this.destructure(pattern, vals, (id, v) => {
      const binding = this.mod.names.decls.get(id) ?? this.mod.names.refs.get(id) ?? null;
      if (binding !== null) this.addAll(this.slot(this.bindingVals, binding), v);
    });
  }

  /** Assign to an assignment target. */
  private assignPattern(pattern: AnyNode, vals: VSet): void {
    this.destructure(pattern, vals, (id, v) => {
      const binding = this.mod.names.refs.get(id) ?? null;
      if (binding !== null) this.addAll(this.slot(this.bindingVals, binding), v);
      else this.escapeInto(id, v);
    });
  }

  private destructure(pattern: AnyNode, vals: VSet, bind: (id: Extract<AnyNode, { type: "Identifier" }>, vals: VSet) => void): void {
    switch (pattern.type) {
      case "Identifier":
        bind(pattern, vals);
        return;
      case "AssignmentPattern": {
        const fallback = this.ev(pattern.right);
        this.destructure(pattern.left, union(vals, fallback), bind);
        return;
      }
      case "ObjectPattern":
        for (const p of pattern.properties) {
          if (p.type === "RestElement") {
            this.destructure(p.argument, vals, bind);
            continue;
          }
          const names = p.computed ? this.keyNames(p.key) : [staticKey(p.key)];
          this.destructure(p.value, this.member(vals, names, p), bind);
        }
        return;
      case "ArrayPattern": {
        const elems = this.elementsOf(vals);
        for (const e of pattern.elements) if (e !== null) this.destructure(e.type === "RestElement" ? e.argument : e, elems, bind);
        return;
      }
      case "RestElement":
        this.destructure(pattern.argument, vals, bind);
        return;
      case "MemberExpression":
        this.writeMember(pattern, vals);
        return;
      default:
        this.ev(pattern);
    }
  }

  /* ---------- expressions ---------- */

  ev(node: AnyNode): VSet {
    const hit = this.memo.get(node);
    if (hit !== undefined) return hit;
    this.memo.set(node, EMPTY);
    const out = this.evUncached(node);
    this.memo.set(node, out);
    return out;
  }

  private identifier(node: Extract<AnyNode, { type: "Identifier" }>): VSet {
    const binding = this.mod.names.refs.get(node) ?? this.mod.names.decls.get(node) ?? null;
    if (binding !== null) return this.bindingVals.get(binding) ?? EMPTY;
    if (node.name === "undefined") return EMPTY;
    if (node.name === "arguments") {
      const fn = [...this.fnStack].reverse().find((f) => f.type !== "ArrowFunctionExpression");
      return fn === undefined ? EMPTY : new Set([this.argumentsValue(fn, this.mod.path)]);
    }
    if (GLOBAL_OBJECT_NAMES.has(node.name)) return new Set([this.global([])]);
    if (node.name === "WebAssembly" && this.reporting) this.wasm.push(this.at(node));
    return new Set([this.global([node.name])]);
  }

  readonly wasm: ModFindingEvidence[] = [];

  private evUncached(node: AnyNode): VSet {
    switch (node.type) {
      case "Identifier":
        return this.identifier(node);
      case "Literal":
        return typeof node.value === "string" ? new Set([this.str(node.value)]) : EMPTY;
      case "TemplateLiteral": {
        const parts = node.expressions.map((e) => this.ev(e));
        return this.concat(node.quasis.map((q) => q.value.cooked ?? q.value.raw), parts);
      }
      case "BinaryExpression": {
        const left = this.ev(node.left);
        const right = this.ev(node.right);
        if (node.operator !== "+") return EMPTY;
        return this.concat(["", "", ""], [left, right]);
      }
      case "ObjectExpression":
        if (isDataTable(node)) return new Set([this.dataValue]);
        return this.evObject(node);
      case "ArrayExpression": {
        if (isDataTable(node)) return new Set([this.dataValue]);
        const arr = this.obj(node, "array");
        const elems = this.slot(this.fields(arr), "[]");
        for (const e of node.elements) {
          if (e === null) continue;
          if (e.type === "SpreadElement") this.addAll(elems, this.elementsOf(this.ev(e.argument)));
          else this.addAll(elems, this.ev(e));
        }
        return new Set([arr]);
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return this.evFunction(node);
      case "ClassExpression":
        return this.evClass(node);
      case "ThisExpression":
        return this.thisStack[this.thisStack.length - 1] ?? EMPTY;
      case "Super": {
        const cls = this.classStack[this.classStack.length - 1];
        if (cls === undefined) return EMPTY;
        const out: VSet = new Set();
        for (const sup of this.classSuper.get(cls) ?? EMPTY) {
          if (sup.k === "class") {
            const instance = this.classInstance.get(sup.node);
            if (instance !== undefined) out.add(instance);
          }
        }
        return out;
      }
      case "MemberExpression": {
        const object = this.ev(node.object);
        const names = node.computed ? this.keyNames(node.property) : [staticKey(node.property)];
        return this.withGuards(node.optional ? [...object].filter((v) => v.k === "handle").map((v) => memberKey(v.root, v.path)) : [], () => this.member(object, names, node));
      }
      case "ChainExpression":
        return this.ev(node.expression);
      case "ConditionalExpression":
        this.ev(node.test);
        return union(this.withGuards(this.guardKeys(node.test, true), () => this.ev(node.consequent)), this.withGuards(this.guardKeys(node.test, false), () => this.ev(node.alternate)));
      case "LogicalExpression": {
        const left = this.ev(node.left);
        return union(left, this.withGuards(node.operator === "??" ? [] : this.guardKeys(node.left, node.operator === "&&"), () => this.ev(node.right)));
      }
      case "UnaryExpression": {
        this.ev(node.argument);
        return EMPTY;
      }
      case "SequenceExpression": {
        let last: VSet = EMPTY;
        for (const e of node.expressions) last = this.ev(e);
        return last;
      }
      case "AssignmentExpression": {
        const vals = this.ev(node.right);
        if (node.operator === "=" || node.operator === "||=" || node.operator === "??=" || node.operator === "&&=") {
          this.assignPattern(node.left, vals);
        } else {
          this.ev(node.left);
        }
        return vals;
      }
      case "AwaitExpression":
        return this.ev(node.argument);
      case "YieldExpression":
        if (node.argument) this.ev(node.argument);
        return EMPTY;
      case "CallExpression":
        return this.evCall(node);
      case "NewExpression":
        return this.evNew(node);
      case "ImportExpression":
        return this.evImport(node);
      case "TaggedTemplateExpression":
        this.invoke(this.ev(node.tag), EMPTY, [EMPTY, ...node.quasi.expressions.map((e) => this.ev(e))], -1, node, []);
        this.ev(node.quasi);
        return EMPTY;
      case "SpreadElement":
        return this.ev(node.argument);
      case "ParenthesizedExpression":
        return this.ev(node.expression);
      default:
        for (const child of childNodes(node)) {
          if (isStatementLike(child)) this.stmt(child);
          else this.ev(child);
        }
        return EMPTY;
    }
  }

  /** String values for a template or a `+`, when every part is a known string. */
  private concat(quasis: readonly string[], parts: readonly VSet[]): VSet {
    let results: string[] = [quasis[0] ?? ""];
    for (let i = 0; i < parts.length; i++) {
      const strs = [...(parts[i] ?? EMPTY)].filter((v) => v.k === "str").map((v) => (v as { value: string }).value);
      if (strs.length === 0 || strs.length !== (parts[i] ?? EMPTY).size) return EMPTY;
      const next: string[] = [];
      for (const r of results) for (const s of strs) next.push(r + s + (quasis[i + 1] ?? ""));
      if (next.length > 16) return EMPTY;
      results = next;
    }
    return new Set(results.map((s) => this.str(s)));
  }

  private keyNames(key: AnyNode): string[] | null {
    const vals = this.ev(key);
    if (key.type === "Literal" && typeof key.value === "number") return ["[]"];
    if (vals.size === 0) return null;
    const out: string[] = [];
    for (const v of vals) {
      if (v.k !== "str") return null;
      out.push(v.value);
    }
    return out;
  }

  private evObject(node: Extract<AnyNode, { type: "ObjectExpression" }>): VSet {
    const obj = this.obj(node, "object");
    const fields = this.fields(obj);
    for (const p of node.properties) {
      if (p.type === "SpreadElement") {
        this.spreadInto(obj, this.ev(p.argument));
        continue;
      }
      const names = p.computed ? this.keyNames(p.key) : [staticKey(p.key)];
      const value = this.ev(p.value);
      for (const fn of value) if (fn.k === "fn" && fn.node.type !== "ArrowFunctionExpression") this.addAll(this.slot(this.thisVals, fn.node), [obj]);
      const stored = p.kind === "get" ? this.returnsOf(value) : value;
      for (const name of names ?? ["*"]) this.addAll(this.slot(fields, name), stored);
    }
    return new Set([obj]);
  }

  private returnsOf(vals: VSet): VSet {
    const out: VSet = new Set();
    for (const v of vals) if (v.k === "fn") for (const r of this.returnVals.get(v.node) ?? EMPTY) out.add(r);
    return out;
  }

  /** Copy what `from` holds into the object `obj`, as a spread does. */
  private spreadInto(obj: Value, from: VSet): void {
    const fields = this.fields(obj);
    for (const v of from) {
      if (v.k === "handle") this.addAll(this.slot(fields, "...handle"), [v]);
      else for (const [name, vals] of this.fieldVals.get(v) ?? []) this.addAll(this.slot(fields, name), vals);
    }
  }

  /** The values a collection could hand out: array elements, or every field of an object. */
  private elementsOf(vals: VSet): VSet {
    const out: VSet = new Set();
    for (const v of vals) {
      const fields = this.fieldVals.get(v);
      if (fields === undefined) continue;
      for (const r of fields.get("[]") ?? EMPTY) out.add(r);
      for (const r of fields.get("*") ?? EMPTY) out.add(r);
    }
    return out;
  }

  /** Read members `names` (null: a name the analysis cannot tell) of every value in `object`. */
  private member(object: VSet, names: readonly string[] | null, node: AnyNode): VSet {
    const out: VSet = new Set();
    for (const v of object) {
      if (names !== null && (v.k === "fn" || v.k === "global" || v.k === "handle" || v.k === "invoke" || v.k === "class")) {
        for (const name of names) {
          if (name === "constructor" && (v.k === "fn" || v.k === "class" || v.k === "invoke" || (v.k === "global" && v.path.length > 0))) out.add(this.global(["Function"]));
          if (name === "call" || name === "apply" || name === "bind") out.add(this.intern({ k: "invoke", id: `i:${v.id}:${name}`, target: v, method: name }));
        }
      }
      switch (v.k) {
        case "handle":
          this.deref(v, node);
          if (names === null) {
            if (this.reporting && reachesGated(v.root, v.path)) this.computed.push(this.at(node));
            break;
          }
          for (const name of names) if (name !== "[]") out.add(this.handle(v.root, [...v.path, name]));
          break;
        case "global":
          if (names === null) {
            if (this.reporting) this.globalComputed.push(this.at(node));
            break;
          }
          for (const name of names) if (v.path.length < 3) out.add(this.global([...v.path, name]));
          break;
        case "ns": {
          const exports = this.exportsOf(v.module);
          if (names === null) for (const vals of exports.values()) for (const r of vals) out.add(r);
          else for (const name of names) for (const r of exports.get(name) ?? EMPTY) out.add(r);
          break;
        }
        case "str":
          break;
        default: {
          if (names === null && (v.k === "fn" || v.k === "class" || v.k === "invoke") && this.reporting) this.invocations.push(this.at(node));
          const fields = this.fieldVals.get(v);
          if (fields !== undefined) {
            if (names === null) for (const vals of fields.values()) for (const r of vals) out.add(r);
            else {
              for (const name of names) for (const r of fields.get(name) ?? EMPTY) out.add(r);
              for (const r of fields.get("*") ?? EMPTY) out.add(r);
              for (const h of fields.get("...handle") ?? EMPTY) {
                if (h.k === "handle") for (const name of names) out.add(this.handle(h.root, [...h.path, name]));
              }
            }
          }
          if (v.k === "class" && names !== null) {
            /* Static members, and members a subclass inherits. */
            for (const sup of this.classSuper.get(v.node) ?? EMPTY) for (const r of this.member(new Set([sup]), names, node)) out.add(r);
          }
          if (v.k === "obj" && v.node !== null && names !== null) {
            const cls = [...this.classInstance.entries()].find(([, inst]) => inst === v)?.[0];
            if (cls !== undefined) {
              for (const sup of this.classSuper.get(cls) ?? EMPTY) {
                if (sup.k !== "class") continue;
                const inst = this.classInstance.get(sup.node);
                if (inst !== undefined) for (const r of this.member(new Set([inst]), names, node)) out.add(r);
              }
            }
          }
        }
      }
    }
    return out;
  }

  /** A handle's member is used: record the reach when that member is gated. */
  private deref(handle: Extract<Value, { k: "handle" }>, node: AnyNode): void {
    if (!this.reporting) return;
    const need = gatedMember(handle.root, handle.path);
    if (need !== undefined) this.reaches.push({ key: memberKey(handle.root, handle.path), need, what: describeHandle(handle.root, handle.path), evidence: this.at(node), guarded: this.guards.has(memberKey(handle.root, handle.path)) });
  }

  private writeMember(node: Extract<AnyNode, { type: "MemberExpression" }>, vals: VSet): void {
    const object = this.ev(node.object);
    const names = node.computed ? this.keyNames(node.property) : [staticKey(node.property)];
    if (this.reporting && names?.some((name) => name === "innerHTML" || name === "outerHTML" || name === "srcdoc") &&
      [...vals].some((v) => v.k === "str" && /<script\b/iu.test(v.value))) this.scripts.push(this.at(node));
    for (const v of object) {
      if (v.k === "handle") {
        this.deref(v, node);
        continue;
      }
      if (v.k === "global") {
        this.escapeInto(node, vals);
        continue;
      }
      if (v.k === "str") continue;
      const fields = this.fields(v);
      for (const name of names ?? ["*"]) this.addAll(this.slot(fields, name), vals);
      for (const fn of vals) if (fn.k === "fn" && fn.node.type !== "ArrowFunctionExpression") this.addAll(this.slot(this.thisVals, fn.node), [v]);
    }
  }

  /** A value leaves for somewhere the analysis does not follow. */
  private escapeInto(node: AnyNode, vals: VSet): void {
    if (!this.reporting) return;
    for (const v of vals) {
      if (v.k === "handle" && reachesGated(v.root, v.path)) {
        this.escapes.push(this.at(node));
        return;
      }
    }
  }

  /* ---------- functions and classes ---------- */

  private evFunction(node: FunctionNode): VSet {
    const value = this.fnValue(node);
    const cached = this.memo.get(node);
    if (cached !== undefined && cached !== EMPTY) return cached;
    const result = new Set([value]);
    this.memo.set(node, result);
    const params = this.params(node);
    const previousGuards = this.guards;
    this.guards = new Set();
    this.fnStack.push(node);
    const arrow = node.type === "ArrowFunctionExpression";
    if (!arrow) this.thisStack.push(this.slot(this.thisVals, node));
    node.params.forEach((param, i) => this.bindPattern(param, params[i] ?? EMPTY));
    if (node.body.type === "BlockStatement") for (const s of node.body.body) this.stmt(s);
    else this.addAll(this.slot(this.returnVals, node), this.ev(node.body));
    if (!arrow) this.thisStack.pop();
    this.fnStack.pop();
    this.guards = previousGuards;
    return result;
  }

  private evClass(node: Extract<AnyNode, { type: "ClassDeclaration" | "ClassExpression" }>): VSet {
    const cached = this.memo.get(node);
    if (cached !== undefined && cached !== EMPTY) return cached;
    const cls = this.intern({ k: "class", id: `c:${this.mod.path}:${node.start}`, node, module: this.mod.path });
    const result = new Set<Value>([cls]);
    this.memo.set(node, result);
    let instance = this.classInstance.get(node);
    if (instance === undefined) {
      instance = this.obj(node, "instance");
      this.classInstance.set(node, instance);
    }
    if (node.superClass) this.addAll(this.slot(this.classSuper, node), this.ev(node.superClass));
    this.classStack.push(node);
    for (const element of node.body.body) {
      if (element.type === "StaticBlock") {
        this.thisStack.push(new Set([cls]));
        for (const s of element.body) this.stmt(s);
        this.thisStack.pop();
        continue;
      }
      const isStatic = element.static;
      const owner = isStatic ? cls : instance;
      const names = element.computed ? this.keyNames(element.key) : [staticKey(element.key)];
      if (element.type === "MethodDefinition") {
        const fn = this.evFunction(element.value);
        this.addAll(this.slot(this.thisVals, element.value), [owner]);
        if (element.kind === "constructor") {
          this.classCtor.set(node, element.value);
          continue;
        }
        const stored = element.kind === "get" ? this.returnsOf(fn) : fn;
        for (const name of names ?? ["*"]) this.addAll(this.slot(this.fields(owner), name), stored);
      } else if (element.value) {
        this.thisStack.push(new Set([owner]));
        const vals = this.ev(element.value);
        this.thisStack.pop();
        for (const name of names ?? ["*"]) this.addAll(this.slot(this.fields(owner), name), vals);
      }
    }
    this.classStack.pop();
    return result;
  }

  /** Call every function in `callee` with `thisVals` and `args`; the union of what they return. */
  private callFunctions(callee: VSet, thisVals: VSet, args: readonly VSet[], spreadFrom: number): VSet {
    const out: VSet = new Set();
    for (const v of callee) {
      if (v.k === "fn") {
        this.bindArgs(v.node, thisVals, args, spreadFrom);
        for (const r of this.returnVals.get(v.node) ?? EMPTY) out.add(r);
      } else if (v.k === "class") {
        /* Calling a class without new throws; only subclass constructors reach here, through super(). */
        const ctor = this.classCtor.get(v.node);
        if (ctor !== undefined) this.bindArgs(ctor, thisVals, args, spreadFrom);
      }
    }
    return out;
  }

  private bindArgs(fn: FunctionNode, thisVals: VSet, args: readonly VSet[], spreadFrom: number): void {
    const params = this.params(fn);
    if (fn.type !== "ArrowFunctionExpression") this.addAll(this.slot(this.thisVals, fn), thisVals);
    if (fn.type !== "ArrowFunctionExpression") {
      const module = this.functionModules.get(fn);
      if (module !== undefined) for (const arg of args) this.addAll(this.slot(this.fields(this.argumentsValue(fn, module)), "[]"), arg);
    }
    fn.params.forEach((param, i) => {
      const slot = params[i];
      if (slot === undefined) return;
      if (param.type === "RestElement") {
        const rest = this.obj(param, "rest");
        const elems = this.slot(this.fields(rest), "[]");
        for (let j = i; j < args.length; j++) this.addAll(elems, args[j] ?? EMPTY);
        this.addAll(slot, [rest]);
        return;
      }
      if (i < args.length) this.addAll(slot, args[i] ?? EMPTY);
      else if (spreadFrom >= 0 && spreadFrom < args.length) this.addAll(slot, args[spreadFrom] ?? EMPTY);
    });
  }

  private evArgs(nodes: readonly AnyNode[]): { readonly args: VSet[]; readonly spreadFrom: number } {
    const args: VSet[] = [];
    let spreadFrom = -1;
    for (const a of nodes) {
      if (a.type === "SpreadElement") {
        if (spreadFrom < 0) spreadFrom = args.length;
        args.push(this.elementsOf(this.ev(a.argument)));
      } else args.push(this.ev(a));
    }
    return { args, spreadFrom };
  }

  private evNew(node: Extract<AnyNode, { type: "NewExpression" }>): VSet {
    const callee = this.ev(node.callee);
    const { args, spreadFrom } = this.evArgs(node.arguments);
    const out: VSet = new Set();
    for (const v of callee) {
      if (v.k === "class") {
        const instance = this.classInstance.get(v.node);
        if (instance === undefined) continue;
        out.add(instance);
        let cls: AnyNode | undefined = v.node;
        /* A class with no constructor passes its arguments to its parent's. */
        const seen = new Set<AnyNode>();
        while (cls !== undefined && !seen.has(cls)) {
          seen.add(cls);
          const ctor = this.classCtor.get(cls);
          if (ctor !== undefined) {
            this.bindArgs(ctor, new Set([instance]), args, spreadFrom);
            break;
          }
          const sup: Value | undefined = [...(this.classSuper.get(cls) ?? EMPTY)].find((s) => s.k === "class");
          cls = sup?.k === "class" ? sup.node : undefined;
        }
      } else if (v.k === "fn") {
        const instance = this.obj(node, "new");
        out.add(instance);
        this.bindArgs(v.node, new Set([instance]), args, spreadFrom);
      } else if (v.k === "global") {
        this.globalCall(v.path, node, node.arguments, args, true);
        if (v.path.length === 1 && COLLECTIONS.has(v.path[0] as string)) out.add(this.obj(node, "new"));
      }
    }
    if (callee.size === 0) this.argEscapes(node, args);
    return out;
  }

  private evImport(node: Extract<AnyNode, { type: "ImportExpression" }>): VSet {
    const vals = this.ev(node.source);
    const specs = [...vals].filter((v) => v.k === "str").map((v) => (v as { value: string }).value);
    if (this.reporting) {
      if (specs.length === 0 || specs.length !== vals.size) this.dynamicImports.push({ module: this.mod.path, node, spec: null });
      else for (const spec of specs) this.dynamicImports.push({ module: this.mod.path, node, spec });
    }
    const out: VSet = new Set();
    for (const spec of specs) {
      const target = this.target(spec);
      if (target !== null) out.add(this.ns(target));
    }
    return out;
  }

  private evCall(node: Extract<AnyNode, { type: "CallExpression" }>): VSet {
    const calleeNode = node.callee;
    let callee: VSet;
    let thisVals: VSet = EMPTY;
    let methodName: string | null = null;
    let receiver: VSet = EMPTY;
    if (calleeNode.type === "Super") {
      const cls = this.classStack[this.classStack.length - 1];
      callee = cls === undefined ? EMPTY : this.classSuper.get(cls) ?? EMPTY;
      thisVals = this.thisStack[this.thisStack.length - 1] ?? EMPTY;
    } else if (calleeNode.type === "MemberExpression") {
      receiver = this.ev(calleeNode.object);
      const names = calleeNode.computed ? this.keyNames(calleeNode.property) : [staticKey(calleeNode.property)];
      methodName = names !== null && names.length === 1 ? (names[0] as string) : null;
      callee = this.withGuards(calleeNode.optional ? [...receiver].filter((v) => v.k === "handle").map((v) => memberKey(v.root, v.path)) : [], () => this.member(receiver, names, calleeNode));
      thisVals = receiver;
    } else {
      callee = this.ev(calleeNode);
    }
    const { args, spreadFrom } = this.evArgs(node.arguments);
    const out = this.withGuards(node.optional ? [...callee].filter((v) => v.k === "handle").map((v) => memberKey(v.root, v.path)) : [], () => this.invoke(callee, thisVals, args, spreadFrom, node, node.arguments));

    if (methodName !== null) for (const r of this.builtinMethod(methodName, receiver, args, node)) out.add(r);

    const known = [...callee].some((v) => v.k === "fn" || v.k === "class" || v.k === "handle");
    const unknown = callee.size === 0 || [...callee].some((v) => v.k === "obj" || v.k === "ns" || v.k === "str");
    const safeGlobal = [...callee].every((v) => v.k !== "global" || SAFE_SINKS.has(v.path.join(".")) || isSafeGlobalCall(v.path));
    const handledBuiltin = methodName !== null && BUILTIN_METHODS.has(methodName) && receiver.size > 0;
    if (!handledBuiltin && ((unknown && !known) || !safeGlobal)) this.argEscapes(node, args);
    return out;
  }

  private argumentsValue(fn: FunctionNode, module: string): Value {
    return this.intern({ k: "obj", id: `a:${module}:${fn.start}`, node: null });
  }

  private invoke(callee: VSet, thisVals: VSet, args: readonly VSet[], spreadFrom: number, node: AnyNode, argNodes: readonly AnyNode[]): VSet {
    const out = this.callFunctions(callee, thisVals, args, spreadFrom);
    for (const v of callee) {
      if (v.k === "handle" && node.type === "CallExpression") this.handleCall(v, node, args);
      else if (v.k === "global") for (const r of this.globalCall(v.path, node, argNodes, args, false)) out.add(r);
      else if (v.k === "invoke") {
        const forwarded = v.method === "apply" ? [this.elementsOf(args[1] ?? EMPTY)] : args.slice(1);
        const returned = this.invoke(new Set([v.target]), args[0] ?? EMPTY, forwarded, v.method === "apply" ? 0 : -1, node, argNodes.slice(1));
        if (v.method === "bind") out.add(v.target);
        else for (const r of returned) out.add(r);
      }
    }
    return out;
  }

  private argEscapes(node: AnyNode, args: readonly VSet[]): void {
    for (const a of args) this.escapeInto(node, a);
  }

  /** Calls the analysis models on ordinary values: Function.prototype.call, promises, arrays and maps. */
  private builtinMethod(name: string, receiver: VSet, args: readonly VSet[], node: AnyNode): VSet {
    const fns: VSet = new Set([...receiver].filter((v) => v.k === "fn"));
    const objs = [...receiver].filter((v) => v.k === "obj");
    switch (name) {
      case "call":
        return this.callFunctions(fns, args[0] ?? EMPTY, args.slice(1), -1);
      case "apply":
        return this.callFunctions(fns, args[0] ?? EMPTY, [this.elementsOf(args[1] ?? EMPTY)], 0);
      case "bind":
        if (fns.size > 0 && args.length > 1) this.callFunctions(fns, args[0] ?? EMPTY, args.slice(1), -1);
        else if (fns.size > 0) this.callFunctions(fns, args[0] ?? EMPTY, [], -1);
        return fns;
      case "then":
      case "catch":
      case "finally": {
        const out: VSet = new Set();
        for (const cb of args) for (const r of this.callFunctions(cb, EMPTY, [receiver], -1)) out.add(r);
        return out;
      }
      case "push":
      case "unshift":
      case "add":
        for (const o of objs) for (const a of args) this.addAll(this.slot(this.fields(o), "[]"), a);
        return EMPTY;
      case "set":
        for (const o of objs) this.addAll(this.slot(this.fields(o), "[]"), args[1] ?? EMPTY);
        return objs.length > 0 ? new Set(objs) : EMPTY;
      case "get":
      case "pop":
      case "shift":
      case "at":
      case "values":
      case "slice":
      case "concat":
      case "flat":
      case "reverse":
      case "sort":
        return objs.length > 0 ? this.elementsOrSelf(name, objs) : EMPTY;
      case "forEach":
      case "map":
      case "filter":
      case "find":
      case "findLast":
      case "some":
      case "every":
      case "flatMap":
      case "reduce": {
        const elems = this.elementsOf(new Set(objs));
        const out: VSet = new Set();
        for (const cb of args.slice(0, 1)) {
          const cbArgs = name === "reduce" ? [args[1] ?? EMPTY, elems] : [elems];
          const returned = this.callFunctions(cb, EMPTY, cbArgs, -1);
          if (name === "map" || name === "flatMap" || name === "reduce") for (const r of returned) out.add(r);
        }
        if (name === "find" || name === "findLast") return elems;
        if (name === "filter") return new Set(objs);
        if (name === "map" || name === "flatMap") {
          const arr = this.obj(node, "mapped");
          this.addAll(this.slot(this.fields(arr), "[]"), out);
          return new Set([arr]);
        }
        return out;
      }
      default:
        return EMPTY;
    }
  }

  private elementsOrSelf(name: string, objs: readonly Value[]): VSet {
    if (["slice", "concat", "flat", "reverse", "sort"].includes(name)) return new Set(objs);
    return this.elementsOf(new Set(objs));
  }

  /** A call on one of the mod's handles. */
  private handleCall(handle: Extract<Value, { k: "handle" }>, node: Extract<AnyNode, { type: "CallExpression" }>, args: readonly VSet[]): void {
    if (!this.reporting) return;
    const need = gatedMember(handle.root, handle.path);
    if (need !== undefined) this.reaches.push({ key: memberKey(handle.root, handle.path), need, what: `${describeHandle(handle.root, handle.path)}()`, evidence: this.at(node), guarded: this.guards.has(memberKey(handle.root, handle.path)) });
    const key = memberKey(handle.root, handle.path);
    if (EVENT_SUBSCRIBE.has(key)) this.eventSubs.push({ names: args[0] ?? EMPTY, evidence: this.at(node) });
    if (NET_REQUEST.has(key)) {
      const arg = node.arguments[0];
      const urlNode = arg?.type === "ObjectExpression"
        ? arg.properties.find((p): p is Property => p.type === "Property" && !p.computed && staticKey(p.key) === "url")?.value ?? null
        : null;
      const urlVals = this.member(args[0] ?? EMPTY, ["url"], node);
      this.requests.push({ url: urlNode, values: urlVals, evidence: this.at(node), direct: false });
    }
    if (TITLE_ROW.has(key)) this.titleRows.push({ id: this.member(args[0] ?? EMPTY, ["id"], node), evidence: this.at(node) });
    const secret = SECRET_BIND.get(key);
    if (secret !== undefined) {
      const raw = args[secret.index];
      const holder = raw === undefined ? null : secret.field === undefined ? raw : this.member(raw, [secret.field], node);
      this.secretBinds.push({ name: args[0] ?? EMPTY, hosts: holder === null ? null : this.elementsOf(holder), evidence: this.at(node) });
    }
  }

  /** A call or `new` on a global: the dangerous ones are recorded; a few pass values through. */
  private globalCall(path: readonly string[], node: AnyNode, argNodes: readonly AnyNode[], args: readonly VSet[], isNew: boolean): VSet {
    const name = path.join(".");
    if (this.reporting) {
      if (name === "eval") this.evals.push({ what: "eval()", evidence: this.at(node) });
      else if (name === "Function") this.evals.push({ what: isNew ? "new Function()" : "Function()", evidence: this.at(node) });
      else if (TIMERS.has(name) && looksLikeString(argNodes[0], args[0])) this.evals.push({ what: `${name}() with a string`, evidence: this.at(node) });
      else if (name === "importScripts") this.remoteScripts.push({ evidence: this.at(node), spec: firstString(args[0]) });
      else if (name === "Worker" || name === "SharedWorker" || name === "navigator.serviceWorker.register") this.workers.push(this.at(node));
      else if ((name === "document.createElement" && firstString(args[0])?.toLowerCase() === "script") ||
        (name === "document.createElementNS" && firstString(args[1])?.toLowerCase().split(":").pop() === "script")) this.scripts.push(this.at(node));
      else if ((name === "document.write" || name === "document.writeln" || name.endsWith(".insertAdjacentHTML")) && args.some((a) => [...a].some((v) => v.k === "str" && /<script\b/iu.test(v.value)))) this.scripts.push(this.at(node));
      const direct = DIRECT_NETWORK.get(name);
      if (direct !== undefined) {
        this.network.push({ what: direct, evidence: this.at(node) });
        if (name === "fetch" || name === "WebSocket" || name === "EventSource") {
          this.requests.push({ url: argNodes[0] ?? null, values: args[0] ?? EMPTY, evidence: this.at(node), direct: true });
        }
      }
    }
    switch (name) {
      case "Reflect.apply":
      case "Reflect.construct":
        return this.invoke(args[0] ?? EMPTY, name === "Reflect.apply" ? args[1] ?? EMPTY : EMPTY,
          [this.elementsOf(args[name === "Reflect.apply" ? 2 : 1] ?? EMPTY)], 0, node, []);
      case "Object.freeze":
      case "Object.seal":
      case "Promise.resolve":
        return args[0] ?? EMPTY;
      case "Object.assign": {
        const target = args[0] ?? EMPTY;
        for (const t of target) if (t.k === "obj") for (const src of args.slice(1)) this.spreadInto(t, src);
        return target;
      }
      case "Object.defineProperty": {
        const target = args[0] ?? EMPTY;
        const keyNode = argNodes[1];
        const names = keyNode === undefined ? null : this.keyNames(keyNode);
        const desc = args[2] ?? EMPTY;
        const vals = union(this.member(desc, ["value"], node), this.returnsOf(this.member(desc, ["get"], node)));
        for (const t of target) {
          if (t.k === "handle" || t.k === "global" || t.k === "str") continue;
          for (const n of names ?? ["*"]) this.addAll(this.slot(this.fields(t), n), vals);
        }
        return target;
      }
      default:
        return EMPTY;
    }
  }
}

const BUILTIN_METHODS = new Set([
  "call", "apply", "bind", "then", "catch", "finally", "push", "unshift", "add", "set", "get", "pop", "shift", "at",
  "values", "slice", "concat", "flat", "reverse", "sort", "forEach", "map", "filter", "find", "findLast", "some",
  "every", "flatMap", "reduce",
]);

/** Globals whose arguments are not kept: their results are plain data. */
function isSafeGlobalCall(path: readonly string[]): boolean {
  const name = path.join(".");
  if (DIRECT_NETWORK.has(name) || TIMERS.has(name)) return true;
  return ["Object.freeze", "Object.seal", "Object.assign", "Object.defineProperty", "Promise.resolve", "Math", "Date", "parseInt", "parseFloat", "isNaN", "Symbol"].some(
    (safe) => name === safe || name.startsWith(`${safe}.`),
  );
}

/** True for a literal made only of literals, and big enough that tracking its entries one by one costs more than it tells. */
function isDataTable(node: AnyNode): boolean {
  let entries = 0;
  const pure = (n: AnyNode): boolean => {
    switch (n.type) {
      case "Literal":
        return true;
      case "TemplateLiteral":
        return n.expressions.length === 0;
      case "UnaryExpression":
        return n.operator === "-" && n.argument.type === "Literal";
      case "ArrayExpression":
        entries += n.elements.length;
        return n.elements.every((e) => e !== null && e.type !== "SpreadElement" && pure(e));
      case "ObjectExpression":
        entries += n.properties.length;
        return n.properties.every((p) => p.type === "Property" && !p.computed && p.kind === "init" && !p.method && pure(p.value));
      default:
        return false;
    }
  };
  return pure(node) && entries > DATA_TABLE_ENTRIES;
}

function union(a: VSet, b: VSet): VSet {
  if (b.size === 0) return a;
  if (a.size === 0) return b;
  return new Set([...a, ...b]);
}

function staticKey(key: AnyNode): string {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal") return typeof key.value === "number" ? "[]" : String(key.value);
  if (key.type === "PrivateIdentifier") return `#${key.name}`;
  return "*";
}

function policyLiteral(node: AnyNode): unknown {
  if (node.type === "Literal" && !(node.value instanceof RegExp) && typeof node.value !== "bigint") return node.value;
  if (node.type === "ArrayExpression") return node.elements.map((element) => element ? policyLiteral(element) : undefined);
  if (node.type === "ObjectExpression") {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (property.type !== "Property" || property.computed || property.kind !== "init" || property.method) return undefined;
      const child = policyLiteral(property.value);
      if (child === undefined) return undefined;
      Object.defineProperty(value, staticKey(property.key), { value: child, enumerable: true, configurable: true });
    }
    return value;
  }
  return undefined;
}

function moduleExportName(node: AnyNode): string {
  return node.type === "Identifier" ? node.name : node.type === "Literal" ? String(node.value) : "*";
}

const STATEMENT_TYPES = new Set([
  "BlockStatement", "StaticBlock", "EmptyStatement", "DebuggerStatement", "WithStatement", "ReturnStatement",
  "LabeledStatement", "BreakStatement", "ContinueStatement", "IfStatement", "SwitchStatement", "SwitchCase",
  "ThrowStatement", "TryStatement", "CatchClause", "WhileStatement", "DoWhileStatement", "ForStatement",
  "ForInStatement", "ForOfStatement", "FunctionDeclaration", "VariableDeclaration", "ClassDeclaration",
  "ExpressionStatement", "ImportDeclaration", "ExportNamedDeclaration", "ExportDefaultDeclaration",
  "ExportAllDeclaration",
]);

function isStatementLike(node: AnyNode): boolean {
  return STATEMENT_TYPES.has(node.type);
}

function firstString(vals: VSet | undefined): string | null {
  for (const v of vals ?? EMPTY) if (v.k === "str") return v.value;
  return null;
}

function looksLikeString(node: AnyNode | undefined, vals: VSet | undefined): boolean {
  if (node?.type === "Literal" && typeof node.value === "string") return true;
  if (node?.type === "TemplateLiteral") return true;
  if (node?.type === "BinaryExpression" && node.operator === "+") return true;
  return [...(vals ?? EMPTY)].some((v) => v.k === "str");
}

function describeHandle(root: HandleRoot, path: readonly string[]): string {
  const base = root === "ctx" ? "ctx" : root === "host" ? "host" : "mod";
  return [base, ...path].join(".");
}

/* ------------------------------------------------------------------ */
/* Literal scans                                                       */
/* ------------------------------------------------------------------ */

const TOKEN_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/u, "an API secret key"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/u, "a GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/u, "a GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/u, "an AWS access key"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/u, "a Slack token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/u, "a Google API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/u, "a private key"],
  [/^Bearer\s+[A-Za-z0-9._~+/-]{16,}=*$/u, "a bearer token"],
];

const CREDENTIAL_QUERY = /[?&](?:api[_-]?key|access[_-]?token|token|secret|password|passwd|auth|key)=([^&#\s{]+)/iu;

interface LiteralScan {
  readonly credentials: ModFindingEvidence[];
  readonly secretTemplates: Array<{ readonly name: string; readonly evidence: ModFindingEvidence }>;
  readonly obfuscation: ModFindingEvidence[];
  readonly obfuscatedNames: number;
}

function scanLiterals(mod: ModuleInfo): LiteralScan {
  const credentials: ModFindingEvidence[] = [];
  const secretTemplates: Array<{ name: string; evidence: ModFindingEvidence }> = [];
  const obfuscation: ModFindingEvidence[] = [];
  const hexNames = new Set<string>();
  const strings: Array<{ text: string; raw: string; node: AnyNode }> = [];
  const visit = (node: AnyNode): void => {
    if (node.type === "Literal" && typeof node.value === "string") strings.push({ text: node.value, raw: node.raw ?? "", node });
    else if (node.type === "TemplateElement") strings.push({ text: node.value.cooked ?? node.value.raw, raw: node.value.raw, node });
    else if (node.type === "Identifier" && /^_0x[0-9a-f]{4,}$/iu.test(node.name)) hexNames.add(node.name);
    else if (node.type === "CallExpression" && node.callee.type === "MemberExpression" && !node.callee.computed &&
      staticKey(node.callee.property) === "fromCharCode" && node.arguments.length >= 8) {
      obfuscation.push({ ...where(mod, node), excerpt: `String.fromCharCode with ${node.arguments.length} codes` });
    }
    for (const child of childNodes(node)) visit(child);
  };
  for (const s of mod.program.body) visit(s);
  for (const { text, raw, node } of strings) {
    for (const [pattern, what] of TOKEN_PATTERNS) {
      if (pattern.test(text)) {
        credentials.push({ ...where(mod, node), excerpt: `${what} (${text.length} characters)` });
        break;
      }
    }
    for (const match of text.matchAll(/\{secret:([^}]*)\}/gu)) secretTemplates.push({ name: match[1] ?? "", evidence: where(mod, node) });
    const escapes = (raw.match(/\\(?:x[0-9a-f]{2}|u[0-9a-f]{4}|u\{[0-9a-f]+\})/giu) ?? []).length;
    if (raw.length >= 40 && escapes * 4 >= raw.length * 0.6) {
      obfuscation.push({ ...where(mod, node), excerpt: `a string written almost entirely in escape codes (${escapes} escapes)` });
    }
  }
  return { credentials, secretTemplates, obfuscation, obfuscatedNames: hexNames.size };
}

/** True when the source reads as minified: long lines with little whitespace. */
function looksMinified(source: string): boolean {
  if (source.length < 4000) return false;
  const lines = source.split("\n");
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return longest > 2000 && source.length / lines.length > 300;
}

/* ------------------------------------------------------------------ */
/* The entry point                                                     */
/* ------------------------------------------------------------------ */

const limitEvidence = (list: readonly ModFindingEvidence[], max = 5): ModFindingEvidence[] => list.slice(0, max);

function dedupeEvidence(list: readonly ModFindingEvidence[]): ModFindingEvidence[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const key = `${e.file}:${e.lines?.[0]}:${e.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Run the code checks on `subject`'s scripts. */
export function checkCode(subject: CheckSubject, options: CodeCheckOptions): ModFinding[] {
  const out: ModFinding[] = [];
  const unread = options.unread ?? new Set<string>();
  const caps = options.caps;
  const grants = caps?.networkGrants() ?? [];
  const analysis = new Analysis(subject.files);

  for (const path of subject.paths) {
    if (/\.wasm$/iu.test(path)) {
      out.push(finding("webassembly", `${path} is a WebAssembly module.`, { evidence: [{ file: path }] }));
    }
  }

  const scripts = subject.paths.filter(isScriptPath);
  const queued = new Set(scripts);
  const addSpecifier = (from: string, spec: string): void => {
    const verdict = judgeSpecifier(from, spec, subject.files);
    if (verdict.kind === "local" && !queued.has(verdict.path)) {
      queued.add(verdict.path);
      scripts.push(verdict.path);
    }
  };
  const declaredEntry = subject.manifest?.runtime === "data" ? undefined : subject.manifest?.entry;
  if (declaredEntry !== undefined && subject.files.has(declaredEntry) && !queued.has(declaredEntry)) {
    queued.add(declaredEntry);
    scripts.push(declaredEntry);
  }
  const readScript = (path: string): void => {
    if (unread.has(path)) {
      out.push(finding("unparsed-module", `${path} sits in an archive that could not be inflated, so it was not examined.`, { evidence: [{ file: path }] }));
      return;
    }
    const source = textOf(subject.files.get(path) ?? new Uint8Array());
    const parsed = parseSource(source);
    if (!parsed.ok) {
      out.push(finding("unparsed-module", `${path} does not parse: ${parsed.message}.`, {
        evidence: [{ file: path, lines: [parsed.line, parsed.line] }],
      }));
      return;
    }
    analysis.addModule(path, source, parsed.program);
    options.parsed?.add(path);
    const discover = (node: AnyNode): void => {
      const spec = node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ImportExpression" ? node.source : null;
      if (spec?.type === "Literal" && typeof spec.value === "string") addSpecifier(path, spec.value);
      else if (spec?.type === "TemplateLiteral" && spec.expressions.length === 0) addSpecifier(path, spec.quasis[0]?.value.cooked ?? "");
      for (const child of childNodes(node)) discover(child);
    };
    discover(parsed.program);
    if (looksMinified(source)) {
      out.push(finding("minified-code", `${path} is minified.`, { evidence: [{ file: path }] }));
    }
  };
  let scanned = 0;
  const readScripts = (): void => {
    while (scanned < scripts.length) readScript(scripts[scanned++] as string);
  };
  readScripts();

  /* The module graph. */
  const missing: ModFindingEvidence[] = [];
  const bare: ModFindingEvidence[] = [];
  const remote: ModFindingEvidence[] = [];
  const staticEdges = new Map<string, string[]>();
  const buildEdges = (mod: ModuleInfo): void => {
    if (staticEdges.has(mod.path)) return;
    const list: string[] = [];
    staticEdges.set(mod.path, list);
    for (const statement of mod.program.body) {
      const source = statement.type === "ImportDeclaration" || statement.type === "ExportAllDeclaration" ||
        (statement.type === "ExportNamedDeclaration" && statement.source) ? statement.source : null;
      if (source === null || source === undefined || typeof source.value !== "string") continue;
      const verdict = judgeSpecifier(mod.path, source.value, subject.files);
      const evidence = where(mod, statement);
      if (verdict.kind === "local") list.push(verdict.path);
      else if (verdict.kind === "remote") remote.push({ ...evidence, excerpt: verdict.why });
      else if (verdict.kind === "bare") bare.push({ ...evidence, excerpt: verdict.why });
      else missing.push({ ...evidence, excerpt: verdict.why });
    }
  };
  const buildGraph = (): void => {
    for (const mod of analysis.modules.values()) buildEdges(mod);
  };
  buildGraph();

  /* Seeds come from the entry's default export. */
  const runtime = subject.manifest?.runtime ?? "data";
  const entryName = runtime === "data" ? null : subject.manifest?.entry ?? IN_PROCESS_ENTRY;
  const entry = entryName === null ? null : [...analysis.modules.keys()].find((p) => p.toLowerCase() === entryName.toLowerCase()) ?? null;
  const api = subject.manifest?.api;
  const admits = (version: string): boolean => {
    if (api === undefined) return false;
    try {
      return satisfies(version, api);
    } catch {
      return false;
    }
  };
  const shape: { mode: "api1" | "api2" | null; facets: Array<{ name: string; evidence: ModFindingEvidence }>; apiProblem: string | null; noObject: boolean } = {
    mode: null, facets: [], apiProblem: null, noObject: false,
  };
  const seed = (): void => {
    if (entry === null) return;
    for (const v of analysis.defaultExport(entry)) {
      if (v.k !== "obj") continue;
      const fields = analysis.fieldsOf(v);
      const api2 = fields.has("start") || [...(fields.get("api") ?? EMPTY)].some((a) => a.k === "str");
      const mode = api2 ? "api2" : "api1";
      if (mode === "api1") {
        analysis.seedParam(fields.get("register") ?? EMPTY, 0, analysis.handle("host", []));
        analysis.seedParam(fields.get("register") ?? EMPTY, 1, analysis.handle("ctx", []));
        analysis.seedParam(fields.get("migrateBag") ?? EMPTY, 2, analysis.handle("ctx", []));
        for (const name of API1_CTX_FIRST) analysis.seedParam(fields.get(name) ?? EMPTY, 0, analysis.handle("ctx", []));
      } else {
        analysis.seedParam(fields.get("start") ?? EMPTY, 0, analysis.handle("api2", []));
      }
    }
  };
  let settled: boolean;
  for (;;) {
    settled = analysis.run(seed);
    for (const imp of analysis.dynamicImports) if (imp.spec !== null) addSpecifier(imp.module, imp.spec);
    if (scanned === scripts.length) break;
    readScripts();
    buildGraph();
  }
  if (!settled) {
    out.push(finding("analysis-limit", `The flow analysis did not settle within ${MAX_FLOW_PASSES} passes or ${MAX_VALUES_PER_SET} values per name, so some uses of the mod API may be unchecked.`, {
      evidence: entry === null ? [] : [{ file: entry }],
    }));
  }

  /* The default export's shape: API version and facet methods. */
  if (entry !== null) {
    const objects = [...analysis.defaultExport(entry)].filter((v): v is Extract<Value, { k: "obj" }> => v.k === "obj" && v.node?.type === "ObjectExpression");
    const mod = analysis.modules.get(entry) as ModuleInfo;
    if (objects.length === 0) {
      out.push(finding("plugin-shape", `${entry} has no default export the checker can read as a plugin object, so the code that receives the mod API was not traced.`, {
        evidence: [{ file: entry }],
        suggestedFix: "Default-export an object literal, such as `export default { api: 1, register(host, ctx) { ... } }`.",
      }));
    }
    for (const v of objects) {
      const node = v.node as Extract<AnyNode, { type: "ObjectExpression" }>;
      const props = node.properties.filter((p): p is Property => p.type === "Property" && !p.computed);
      const apiProp = props.find((p) => staticKey(p.key) === "api");
      const apiValue = apiProp?.value;
      const literal = apiValue?.type === "Literal" ? apiValue.value : undefined;
      const fields = analysis.fieldsOf(v);
      const isApi2 = fields.has("start") || typeof literal === "string";
      shape.mode = isApi2 ? "api2" : "api1";
      if (isApi2) for (const factory of fields.get("policies") ?? EMPTY) {
        if (factory.k !== "fn") continue;
        const checkReturn = (returned: AnyNode): void => {
          if (returned.type !== "ObjectExpression") return;
          const data = policyLiteral(returned);
          const problem = data === undefined ? null : checkApi2Policies(data);
          if (problem) out.push(finding("plugin-shape", `${entry} declares policies the host refuses: ${problem}.`, { evidence: [where(mod, returned)] }));
          for (const property of returned.properties) {
            if (property.type !== "Property" || property.computed) continue;
            const kind = API2_POLICY_KINDS.find((candidate) => candidate.name === staticKey(property.key));
            if (!kind || caps === null) continue;
            const need = anyOf(kind.capability);
            if (!need.covered(caps)) analysis.reaches.push({ key: `policy:${kind.name}`, need, what: `the ${kind.name} policy`, evidence: where(mod, property) });
          }
        };
        const visit = (part: AnyNode): void => {
          if (part.type === "ReturnStatement" && part.argument) checkReturn(part.argument);
          if (part.type === "FunctionExpression" || part.type === "ArrowFunctionExpression" || part.type === "FunctionDeclaration") return;
          for (const child of childNodes(part)) visit(child);
        };
        if (factory.node.body.type === "BlockStatement") visit(factory.node.body);
        else checkReturn(factory.node.body);
      }
      if (apiProp === undefined) {
        if (runtime === "in-process" && !isApi2) {
          out.push(finding("api-mismatch", `${entry} does not declare an integer api in its default export, so the game will not load it.`, {
            evidence: [where(mod, node)],
            suggestedFix: "Add `api: 1` to the plugin object.",
          }));
        }
      } else if (literal === undefined) {
        out.push(finding("plugin-shape", `${entry} computes its api value, so the checker cannot compare it with the manifest.`, { evidence: [where(mod, apiProp)] }));
      } else if (typeof literal === "number") {
        const fits = literal === 1 ? runtime === "in-process" && admits(MOD_API_1_VERSION) : literal === 2 ? runtime === "worker" && admits(WORKER_PREVIEW_API) : false;
        if (!fits) {
          out.push(finding("api-mismatch", `${entry} declares api ${literal}, and the manifest declares a ${runtime} mod with api "${api ?? "none"}".`, {
            evidence: [where(mod, apiProp)],
          }));
        }
      } else if (typeof literal === "string") {
        const verdict = apiRangeVerdict(literal);
        if (!verdict.ok || !admits(MOD_API2_VERSION)) {
          out.push(finding("api-mismatch", !verdict.ok ? `${entry} ${verdict.why}.` : `${entry} is written for API ${literal}, and the manifest's api "${api ?? "none"}" does not admit ${MOD_API2_VERSION}.`, {
            evidence: [where(mod, apiProp)],
          }));
        }
      }
      if (isApi2 && caps !== null) {
        for (const p of props) {
          if (staticKey(p.key) !== "controller") continue;
          for (const need of CONTROLLER_NEEDS) {
            if (!need.covered(caps)) analysis.reaches.push({ key: "facet:controller", need, what: "the controller() member", evidence: where(mod, p) });
          }
        }
      }
      if (!isApi2 && caps !== null) {
        for (const p of props) {
          const need = FACET_METHODS.get(staticKey(p.key));
          if (need === undefined || need.covered(caps)) continue;
          analysis.reaches.push({ key: `facet:${staticKey(p.key)}`, need, what: `the ${staticKey(p.key)}() method`, evidence: where(mod, p) });
        }
      }
    }
  }

  /* Imports. */
  const dynamicLocal: Array<{ from: string; to: string }> = [];
  for (const imp of analysis.dynamicImports) {
    const mod = analysis.modules.get(imp.module) as ModuleInfo;
    const evidence = where(mod, imp.node);
    if (imp.spec === null) {
      out.push(finding("computed-import", `${imp.module} imports a module whose name is computed at run time.`, { evidence: [evidence] }));
      continue;
    }
    const verdict = judgeSpecifier(imp.module, imp.spec, subject.files);
    if (verdict.kind === "local") dynamicLocal.push({ from: imp.module, to: verdict.path });
    else if (verdict.kind === "remote") remote.push({ ...evidence, excerpt: verdict.why });
    else if (verdict.kind === "bare") bare.push({ ...evidence, excerpt: verdict.why });
    else missing.push({ ...evidence, excerpt: verdict.why });
  }
  for (const s of analysis.remoteScripts) {
    remote.push({ ...s.evidence, excerpt: s.spec === null ? "importScripts() with a computed URL" : `importScripts(${JSON.stringify(s.spec)})` });
  }
  for (const e of dedupeEvidence(missing)) out.push(finding("missing-module", `${e.file} ${e.excerpt ?? "imports a file that is not there"}.`, { evidence: [e] }));
  for (const e of dedupeEvidence(bare)) out.push(finding("unresolved-import", `${e.file} ${e.excerpt ?? "imports a package"}.`, { evidence: [e], suggestedFix: "Bundle the package into the mod with neo-angband-mod-build." }));
  for (const e of dedupeEvidence(remote)) out.push(finding("remote-import", `${e.file} loads code from outside the mod: ${e.excerpt ?? "a remote import"}.`, { evidence: [e] }));

  /* Cycles, over static imports. */
  const cycles = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const dfs = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const next of staticEdges.get(node) ?? []) {
      if (state.get(next) === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join(" ");
        if (!cycles.has(key)) {
          cycles.add(key);
          out.push(finding("import-cycle", `${[...cycle, next].join(" imports ")}.`, { evidence: cycle.map((file) => ({ file })) }));
        }
      } else if (state.get(next) === undefined) dfs(next);
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const path of staticEdges.keys()) if (state.get(path) === undefined) dfs(path);

  /* Reachability from the entry. */
  if (entry !== null) {
    const reached = new Set<string>([entry]);
    const queue = [entry];
    while (queue.length > 0) {
      const at = queue.shift() as string;
      const next = [...(staticEdges.get(at) ?? []), ...dynamicLocal.filter((d) => d.from === at).map((d) => d.to)];
      for (const n of next) if (!reached.has(n)) {
        reached.add(n);
        queue.push(n);
      }
    }
    const loose = [...analysis.modules.keys()].filter((p) => !reached.has(p));
    if (loose.length > 0) {
      out.push(finding("unreachable-code", `${loose.length === 1 ? `${loose[0]} is` : `${loose.length} scripts are`} not imported by ${entry} or anything it imports.`, {
        evidence: loose.slice(0, 5).map((file) => ({ file })),
      }));
    }
  }

  /* Capabilities. */
  if (caps !== null) {
    const byNeed = new Map<string, Reach[]>();
    const guarded = new Map<string, Reach[]>();
    for (const reach of analysis.reaches) {
      if (reach.need.covered(caps)) continue;
      /* The game leaves this member out without its capability, and the code
       * checks for it first: the use is dead code rather than a failure. */
      const into = omittedWhenUngranted(reach.key) && reach.guarded === true ? guarded : byNeed;
      const list = into.get(reach.need.label) ?? [];
      list.push(reach);
      into.set(reach.need.label, list);
    }
    for (const [label, list] of guarded) {
      const uses = [...new Set(list.map((r) => r.what.replace(/\(\)$/u, "")))];
      out.push(finding("capability-feature-test", `The code checks for ${uses.join(", ")} before using it, and the game provides that only to a mod that requests ${label}, so that code never runs.`, {
        evidence: limitEvidence(dedupeEvidence(list.map((r) => r.evidence))),
      }));
    }
    for (const [label, list] of byNeed) {
      const uses = [...new Set(list.map((r) => r.what))];
      out.push(finding("undeclared-capability", `The code uses ${uses.slice(0, 3).join(", ")}${uses.length > 3 ? ` and ${uses.length - 3} more` : ""}, which needs ${label}, and the manifest does not request it.`, {
        evidence: limitEvidence(dedupeEvidence(list.map((r) => r.evidence))),
        suggestedFix: `Add ${label} to the manifest's capabilities, or remove the code that needs it.`,
      }));
    }
    for (const sub of analysis.eventSubs) {
      const names = [...sub.names].filter((v) => v.k === "str").map((v) => (v as { value: string }).value);
      if (names.length === 0 || names.length !== sub.names.size) {
        analysis.computed.push(sub.evidence);
        continue;
      }
      for (const name of names) {
        let covered = false;
        try {
          covered = caps.has(`event:${name}`);
        } catch {
          covered = false;
        }
        if (!covered) {
          out.push(finding("undeclared-capability", `The code subscribes to the ${name} event, which needs "event:${name}", and the manifest does not request it.`, {
            evidence: [sub.evidence],
            suggestedFix: `Add "event:${name}" to the manifest's capabilities.`,
          }));
        }
      }
    }
  }
  const computed = dedupeEvidence(analysis.computed);
  const globalComputed = dedupeEvidence(analysis.globalComputed);
  if (globalComputed.length > 0) {
    out.push(finding("computed-global-access", `${globalComputed.length} places read global properties by unknown names, so their callable identities were not checked.`, {
      evidence: limitEvidence(globalComputed),
    }));
  }
  const invocations = dedupeEvidence(analysis.invocations);
  if (invocations.length > 0) {
    out.push(finding("untracked-invocation", "The code reads unknown properties of functions, so their invocation flows were not checked.", {
      evidence: limitEvidence(invocations),
    }));
  }
  if (computed.length > 0) {
    out.push(finding("computed-context-access", `${computed.length} place${computed.length === 1 ? "" : "s"} reach the mod API by a computed name, so the capabilities they need were not checked.`, {
      evidence: limitEvidence(computed),
    }));
  }
  const escapes = dedupeEvidence(analysis.escapes);
  if (escapes.length > 0) {
    out.push(finding("context-escapes", `${escapes.length} place${escapes.length === 1 ? "" : "s"} hand the mod API to code the checker cannot follow, so the calls made through it were not checked.`, {
      evidence: limitEvidence(escapes),
    }));
  }

  /* Code that runs code. */
  const evals = analysis.evals.filter((e, i, all) => all.findIndex((o) => o.what === e.what && o.evidence.file === e.evidence.file && o.evidence.lines?.[0] === e.evidence.lines?.[0]) === i);
  if (evals.length > 0) {
    const kinds = [...new Set(evals.map((e) => e.what))];
    out.push(finding("dynamic-eval", `The code runs strings as code: ${kinds.join(", ")}.`, {
      evidence: limitEvidence(evals.map((e) => e.evidence)),
      suggestedFix: "Write the code out in the module instead of building it as a string.",
    }));
  }
  if (analysis.scripts.length > 0) {
    out.push(finding("script-injection", "The code creates script elements or writes script markup into the page.", { evidence: limitEvidence(dedupeEvidence(analysis.scripts)) }));
  }
  if (analysis.workers.length > 0) {
    out.push(finding("nested-worker", "The code starts a worker of its own.", { evidence: limitEvidence(dedupeEvidence(analysis.workers)) }));
  }
  if (analysis.network.length > 0) {
    const kinds = [...new Set(analysis.network.map((n) => n.what))];
    out.push(finding("direct-network", `The code uses ${kinds.join(", ")} directly, outside the host's broker.`, {
      evidence: limitEvidence(dedupeEvidence(analysis.network.map((n) => n.evidence))),
      suggestedFix: "Send requests with ctx.net.request (API 1) or mod.net.request (API 2) and declare each host.",
    }));
  }
  if (analysis.wasm.length > 0) {
    out.push(finding("webassembly", "The code uses the WebAssembly API.", { evidence: limitEvidence(dedupeEvidence(analysis.wasm)) }));
  }

  /* Network destinations. */
  const insecure: ModFindingEvidence[] = [];
  const inUrl: ModFindingEvidence[] = [];
  const unreadable: ModFindingEvidence[] = [];
  const undeclared = new Map<string, ModFindingEvidence[]>();
  for (const request of analysis.requests) {
    const urls = [...request.values].filter((v) => v.k === "str").map((v) => (v as { value: string }).value);
    const prefix = request.url === null ? null : staticPrefix(request.url);
    const candidates = urls.length > 0 && urls.length === request.values.size ? urls : prefix !== null ? [prefix] : [];
    if (candidates.length === 0) {
      if (!request.direct) unreadable.push(request.evidence);
      continue;
    }
    for (const url of candidates) {
      const cap = networkRequestCapability(url.replace(/^ws(s?):/iu, "http$1:"));
      if (cap === null) {
        if (!request.direct) unreadable.push({ ...request.evidence, excerpt: `${url} is not an absolute http or https URL` });
        continue;
      }
      if (/^(?:http|ws):/iu.test(url) && !isLocalNetworkHost(new URL(url.replace(/^ws:/iu, "http:")).hostname)) insecure.push({ ...request.evidence, excerpt: url });
      if (CREDENTIAL_QUERY.test(url)) inUrl.push(request.evidence);
      if (!request.direct) {
        let covered = false;
        try {
          covered = networkGrantCovers(grants, cap);
        } catch {
          covered = false;
        }
        if (!covered) {
          const list = undeclared.get(cap) ?? [];
          list.push(request.evidence);
          undeclared.set(cap, list);
        }
      }
    }
  }
  for (const [cap, list] of undeclared) {
    out.push(finding("undeclared-network-host", `The code sends requests that need "${cap}", and the manifest does not request it.`, {
      evidence: limitEvidence(dedupeEvidence(list)),
      suggestedFix: `Add "${cap}" to the manifest's capabilities.`,
    }));
  }
  if (unreadable.length > 0) {
    out.push(finding("network-destination", `${unreadable.length} request${unreadable.length === 1 ? "" : "s"} use a URL the checker cannot read, so the host was not compared with the manifest.`, {
      evidence: limitEvidence(dedupeEvidence(unreadable)),
    }));
  }
  if (insecure.length > 0) {
    out.push(finding("insecure-transport", "The code sends requests over plain http to a host outside this computer.", { evidence: limitEvidence(dedupeEvidence(insecure)) }));
  }
  if (inUrl.length > 0) {
    out.push(finding("credential-in-url", "A request URL carries a key or token in its query string.", { evidence: limitEvidence(dedupeEvidence(inUrl)) }));
  }

  /* Title rows: the host refuses an id outside the format, and says so only as a result. */
  for (const row of analysis.titleRows) {
    for (const value of row.id) {
      if (value.k === "str" && !TITLE_ROW_ID.test(value.value)) {
        out.push(finding("title-row-id", `${JSON.stringify(value.value)} cannot be a title row id; use lower-case letters, digits and hyphens, start with a letter, and keep it to 64 characters.`, { evidence: [row.evidence] }));
      }
    }
  }

  /* Secrets. */
  for (const bind of analysis.secretBinds) {
    const names = [...bind.name].filter((v) => v.k === "str").map((v) => (v as { value: string }).value);
    for (const name of names) {
      if (!isSecretName(name)) out.push(finding("secret-host", `${JSON.stringify(name)} cannot name a secret; use lower-case words joined by hyphens.`, { evidence: [bind.evidence] }));
    }
    const hosts = bind.hosts === null ? [] : [...bind.hosts].filter((v) => v.k === "str").map((v) => (v as { value: string }).value);
    if (bind.hosts === null || hosts.length === 0 || hosts.length !== bind.hosts.size) {
      out.push(finding("network-destination", "A secret is bound to hosts the checker cannot read, so they were not compared with the manifest.", { evidence: [bind.evidence] }));
      continue;
    }
    const verdict = checkSecretHosts(hosts, grants);
    if (!verdict.ok) out.push(finding("secret-host", verdict.problem, { evidence: [bind.evidence] }));
  }

  /* Literal scans: credentials, secret templates, obfuscation. */
  const credentials: ModFindingEvidence[] = [];
  for (const mod of analysis.modules.values()) {
    const scan = scanLiterals(mod);
    credentials.push(...scan.credentials);
    for (const t of scan.secretTemplates) {
      if (!isSecretName(t.name)) out.push(finding("secret-host", `"{secret:${t.name}}" does not name a secret; use lower-case words joined by hyphens.`, { evidence: [t.evidence] }));
    }
    const signs = [...scan.obfuscation];
    if (scan.obfuscatedNames >= 5) signs.unshift({ file: mod.path, excerpt: `${scan.obfuscatedNames} names in the _0x1234 style obfuscators produce` });
    if (signs.length > 0) {
      out.push(finding("obfuscation", `${mod.path} shows signs of obfuscation.`, { evidence: limitEvidence(signs) }));
    }
  }
  if (credentials.length > 0) {
    out.push(finding("credential-in-code", "The code contains what looks like a key or token.", {
      evidence: limitEvidence(credentials),
      suggestedFix: "Remove the key, revoke it, and have the player supply it through the host's secret store.",
    }));
  }
  return out;
}

/** The text a URL expression starts with, when its start is fixed. */
function staticPrefix(node: AnyNode): string | null {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") {
    const head = node.quasis[0]?.value.cooked ?? "";
    return head.length > 0 ? head : null;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") return staticPrefix(node.left);
  return null;
}
