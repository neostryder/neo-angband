/**
 * Parsing and name resolution for the code checks. Acorn parses each module;
 * the resolver then ties every identifier that is read or written to the
 * declaration it names, or marks it global when no enclosing scope declares it.
 */

import { parse, type AnyNode, type Identifier, type Pattern, type Program } from "acorn";

export type { AnyNode, Program };

/** A function node: declaration, expression or arrow. */
export type FunctionNode = Extract<AnyNode, { type: "FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression" }>;

export type ParseResult =
  | { readonly ok: true; readonly program: Program; readonly sourceType: "module" | "script" }
  | { readonly ok: false; readonly message: string; readonly line: number };

/** Parse `source` as a module, falling back to a classic script (a Worker entry may be one). */
export function parseSource(source: string): ParseResult {
  const options = { ecmaVersion: "latest", locations: true, allowHashBang: true } as const;
  try {
    return { ok: true, program: parse(source, { ...options, sourceType: "module" }), sourceType: "module" };
  } catch (moduleError) {
    try {
      return { ok: true, program: parse(source, { ...options, sourceType: "script" }), sourceType: "script" };
    } catch {
      const e = moduleError as { message?: string; loc?: { line?: number } };
      return { ok: false, message: e.message ?? String(moduleError), line: e.loc?.line ?? 1 };
    }
  }
}

const SKIP_KEYS = new Set(["type", "start", "end", "loc", "range", "raw", "regex", "bigint", "sourceType"]);

/** The child nodes of `node`, in source order. */
export function childNodes(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

export const isNode = (value: unknown): value is AnyNode =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";

export type BindingKind = "var" | "let" | "const" | "function" | "class" | "param" | "import" | "catch";

/** One declared name. */
export interface Binding {
  readonly name: string;
  readonly kind: BindingKind;
  readonly node: Identifier;
  /** The declarator's initializer, for a `const` with one. */
  readonly init?: AnyNode;
}

class Scope {
  readonly names = new Map<string, Binding>();
  constructor(readonly parent: Scope | null, readonly fn: boolean) {}
  lookup(name: string): Binding | null {
    return this.names.get(name) ?? this.parent?.lookup(name) ?? null;
  }
  functionScope(): Scope {
    return this.fn || this.parent === null ? this : this.parent.functionScope();
  }
}

/** Every resolved name in one module. */
export interface Resolution {
  /** Identifier nodes that read or write a name, mapped to the declaration, or null for a global. */
  readonly refs: Map<Identifier, Binding | null>;
  /** Identifier nodes that declare a name. */
  readonly decls: Map<Identifier, Binding>;
}

/** The identifiers a pattern declares. */
export function patternNames(pattern: Pattern | AnyNode): Identifier[] {
  switch (pattern.type) {
    case "Identifier":
      return [pattern];
    case "ObjectPattern":
      return pattern.properties.flatMap((p) => (p.type === "RestElement" ? patternNames(p.argument) : patternNames(p.value)));
    case "ArrayPattern":
      return pattern.elements.flatMap((e) => (e === null ? [] : patternNames(e)));
    case "AssignmentPattern":
      return patternNames(pattern.left);
    case "RestElement":
      return patternNames(pattern.argument);
    default:
      return [];
  }
}

/** Resolve every identifier in `program`. */
export function resolveNames(program: Program): Resolution {
  const refs = new Map<Identifier, Binding | null>();
  const decls = new Map<Identifier, Binding>();
  const pending: Array<[Identifier, Scope]> = [];

  const declare = (scope: Scope, id: Identifier, kind: BindingKind, init?: AnyNode): void => {
    const target = kind === "var" ? scope.functionScope() : scope;
    const existing = target.names.get(id.name);
    const binding: Binding = existing ?? { name: id.name, kind, node: id, ...(init !== undefined ? { init } : {}) };
    if (existing === undefined) target.names.set(id.name, binding);
    decls.set(id, binding);
  };

  /** Visit the expressions inside a pattern: defaults, computed keys and member targets. */
  const visitPattern = (pattern: AnyNode, scope: Scope, declaring: boolean): void => {
    switch (pattern.type) {
      case "Identifier":
        if (!declaring) pending.push([pattern, scope]);
        return;
      case "ObjectPattern":
        for (const p of pattern.properties) {
          if (p.type === "RestElement") visitPattern(p.argument, scope, declaring);
          else {
            if (p.computed) visit(p.key, scope);
            visitPattern(p.value, scope, declaring);
          }
        }
        return;
      case "ArrayPattern":
        for (const e of pattern.elements) if (e !== null) visitPattern(e, scope, declaring);
        return;
      case "AssignmentPattern":
        visitPattern(pattern.left, scope, declaring);
        visit(pattern.right, scope);
        return;
      case "RestElement":
        visitPattern(pattern.argument, scope, declaring);
        return;
      default:
        visit(pattern, scope);
    }
  };

  const visitFunction = (fn: FunctionNode, outer: Scope): void => {
    let scope = outer;
    if (fn.type === "FunctionExpression" && fn.id) {
      scope = new Scope(outer, false);
      declare(scope, fn.id, "function");
    }
    const inner = new Scope(scope, true);
    for (const param of fn.params) {
      for (const id of patternNames(param)) declare(inner, id, "param");
      visitPattern(param, inner, true);
    }
    if (fn.body.type === "BlockStatement") for (const s of fn.body.body) visit(s, inner);
    else visit(fn.body, inner);
  };

  const visitClass = (cls: Extract<AnyNode, { type: "ClassDeclaration" | "ClassExpression" }>, outer: Scope): void => {
    if (cls.type === "ClassDeclaration" && cls.id) declare(outer, cls.id, "class");
    const scope = new Scope(outer, false);
    if (cls.type === "ClassExpression" && cls.id) declare(scope, cls.id, "class");
    if (cls.superClass) visit(cls.superClass, scope);
    for (const element of cls.body.body) {
      if (element.type === "StaticBlock") {
        const block = new Scope(scope, true);
        for (const s of element.body) visit(s, block);
        continue;
      }
      if (element.computed) visit(element.key, scope);
      if (element.value) visit(element.value, scope);
    }
  };

  const visit = (node: AnyNode, scope: Scope): void => {
    switch (node.type) {
      case "Identifier":
        pending.push([node, scope]);
        return;
      case "FunctionDeclaration":
        if (node.id) declare(scope, node.id, "function");
        visitFunction(node, scope);
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        visitFunction(node, scope);
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        visitClass(node, scope);
        return;
      case "VariableDeclaration": {
        const kind = node.kind === "var" ? "var" : node.kind === "const" ? "const" : "let";
        for (const d of node.declarations) {
          for (const id of patternNames(d.id)) declare(scope, id, kind, d.id.type === "Identifier" && d.init ? d.init : undefined);
          visitPattern(d.id, scope, true);
          if (d.init) visit(d.init, scope);
        }
        return;
      }
      case "BlockStatement":
      case "StaticBlock": {
        const block = new Scope(scope, false);
        for (const s of node.body) visit(s, block);
        return;
      }
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const head = new Scope(scope, false);
        if (node.type === "ForStatement") {
          if (node.init) visit(node.init, head);
          if (node.test) visit(node.test, head);
          if (node.update) visit(node.update, head);
        } else {
          if (node.left.type === "VariableDeclaration") visit(node.left, head);
          else visitPattern(node.left, head, false);
          visit(node.right, head);
        }
        visit(node.body, head);
        return;
      }
      case "SwitchStatement": {
        visit(node.discriminant, scope);
        const block = new Scope(scope, false);
        for (const c of node.cases) {
          if (c.test) visit(c.test, block);
          for (const s of c.consequent) visit(s, block);
        }
        return;
      }
      case "CatchClause": {
        const block = new Scope(scope, false);
        if (node.param) {
          for (const id of patternNames(node.param)) declare(block, id, "catch");
          visitPattern(node.param, block, true);
        }
        visit(node.body, block);
        return;
      }
      case "ImportDeclaration":
        for (const s of node.specifiers) declare(scope, s.local, "import");
        return;
      case "ExportNamedDeclaration":
        if (node.declaration) visit(node.declaration, scope);
        else if (!node.source) for (const s of node.specifiers) if (s.local.type === "Identifier") pending.push([s.local, scope]);
        return;
      case "ExportDefaultDeclaration":
        visit(node.declaration, scope);
        return;
      case "ExportAllDeclaration":
        return;
      case "MemberExpression":
        visit(node.object, scope);
        if (node.computed) visit(node.property, scope);
        return;
      case "Property":
        if (node.computed) visit(node.key, scope);
        visit(node.value, scope);
        return;
      case "AssignmentExpression":
        visitPattern(node.left, scope, false);
        visit(node.right, scope);
        return;
      case "LabeledStatement":
        visit(node.body, scope);
        return;
      case "BreakStatement":
      case "ContinueStatement":
      case "MetaProperty":
        return;
      default:
        for (const child of childNodes(node)) visit(child, scope);
    }
  };

  const top = new Scope(null, true);
  for (const s of program.body) visit(s, top);
  for (const [id, scope] of pending) refs.set(id, scope.lookup(id.name));
  return { refs, decls };
}
