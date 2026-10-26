/**
 * The fixed checks' rule table: what each rule is called, how bad a finding
 * from it is, and why it exists. Plain data with no imports beyond types, so
 * the game's installer can read a rule's title without pulling in the
 * JavaScript parser the code checks use.
 *
 * The same table feeds `neo-angband-mod-check --list` and the "Fixed checks"
 * part of docs/modding/REQUIREMENTS.md, and a test fails when a check reports
 * a rule id that is not listed here.
 */

import type { ModFindingKind, ModFindingSeverity } from "../mod-findings.js";

/** The version of the fixed-check library. A gate verdict records it. */
export const CHECKS_VERSION = "1.0.0";

/** The tool name a ModFindingReport from these checks carries. */
export const CHECKS_TOOL = "neo-angband-mod-checks";

/** Where a rule's findings come from. */
export type CheckArea = "archive" | "payload" | "manifest" | "code" | "composition";

export interface CheckRule {
  /** `checks/<name>`. Stable: a gate record and an author's suppression name it. */
  readonly id: string;
  readonly severity: ModFindingSeverity;
  readonly kind: ModFindingKind;
  /** "found", or "could-not-check" for a rule that reports what the checker could not see. */
  readonly outcome: "found" | "could-not-check";
  readonly area: CheckArea;
  /** True when the game also runs it as it installs a mod. */
  readonly install: boolean;
  /** One line in the imperative, as an author reads it in a checklist. */
  readonly title: string;
  /** Why the rule exists, in one or two sentences. */
  readonly reason: string;
}

type RuleSpec = Omit<CheckRule, "id" | "outcome" | "install"> & {
  readonly outcome?: CheckRule["outcome"];
  readonly install?: boolean;
};

const rule = (name: string, spec: RuleSpec): CheckRule => ({
  id: `checks/${name}`,
  outcome: spec.outcome ?? "found",
  install: spec.install ?? false,
  ...spec,
});

/** Every fixed check, grouped by area in the order the library runs them. */
export const CHECK_RULES: readonly CheckRule[] = [
  rule("archive-unreadable", {
    severity: "block", kind: "packaging", area: "archive",
    title: "Ship archives the game can open",
    reason: "A .zip whose directory cannot be read installs nothing, and nothing inside it can be checked.",
  }),
  rule("archive-path", {
    severity: "block", kind: "safety", area: "archive",
    title: "Keep every archive entry inside the mod folder",
    reason: "An entry named with `..`, a leading slash, a drive letter or a backslash can write outside the folder it is unpacked into.",
  }),
  rule("archive-duplicate", {
    severity: "block", kind: "safety", area: "archive",
    title: "Give each archive entry its own name",
    reason: "Two entries with one name, or names that differ only in case, unpack to one file, and which copy wins depends on the tool that unpacks them.",
  }),
  rule("archive-size", {
    severity: "block", kind: "packaging", area: "archive",
    title: "Stay within the archive limits",
    reason: "All archives in one mod share limits of 64 MB of archive bytes, 4,096 entries and 128 MB expanded, with 64 MB for one file, so a payload over any limit cannot be installed.",
  }),
  rule("archive-bomb", {
    severity: "block", kind: "safety", area: "archive",
    title: "Make archive headers match what the entries hold",
    reason: "An entry that inflates far past its compressed size, past the size its header states, or into bytes another entry also claims is how an archive bomb fills a disk.",
  }),
  rule("archive-entry-type", {
    severity: "block", kind: "safety", area: "archive",
    title: "Use plain stored or deflated files in archives",
    reason: "Symbolic links, encrypted entries and other compression methods either point outside the mod or cannot be read and checked.",
  }),
  rule("archive-unmeasured", {
    severity: "warning", kind: "packaging", area: "archive", outcome: "could-not-check",
    title: "Let the checker inflate archive entries",
    reason: "Without a deflate decoder the checker trusts each entry's stated size, so an entry that lies about it goes unmeasured.",
  }),

  rule("payload-path", {
    severity: "block", kind: "safety", area: "payload", install: true,
    title: "Use relative paths inside the mod folder",
    reason: "A payload path that is absolute, uses a backslash, climbs out with `..`, or holds a character a file system refuses cannot be stored safely on every platform.",
  }),
  rule("payload-collision", {
    severity: "block", kind: "packaging", area: "payload", install: true,
    title: "Name files so they differ by more than case",
    reason: "Windows and macOS treat `Plugin.js` and `plugin.js` as one file, so one of the two is lost when the mod is copied to a mods folder.",
  }),
  rule("payload-size", {
    severity: "block", kind: "packaging", area: "payload", install: true,
    title: "Stay within the payload limits",
    reason: "The game stores at most 4,096 files, 64 MB for one file and 128 MB in all for a mod.",
  }),
  rule("payload-incomplete", {
    severity: "block", kind: "functionality", area: "payload", install: true,
    title: "Ship every file the manifest names",
    reason: "A file listed in `payload.files` or `text.locales` that is not there leaves the mod without it, and the default locale has to be one of the listed locales.",
  }),
  rule("entry-module", {
    severity: "block", kind: "functionality", area: "payload", install: true,
    title: "Make the runtime match the code the mod ships",
    reason: "A mod that runs code needs its entry module in the payload, and a data mod must not ship scripts the game would never run.",
  }),
  rule("listing-files", {
    severity: "warning", kind: "content", area: "payload",
    title: "Ship the screenshots and changelog the listing names",
    reason: "The mod page shows these files, and a missing one leaves a gap where a player expects a picture or the release notes.",
  }),

  rule("budget-ceiling", {
    severity: "block", kind: "functionality", area: "manifest", install: true,
    title: "Ask for at most 500 ms per turn",
    reason: "`budget.msPerTurn` must be a number above 0 and at most 500; the game switches off a mod that keeps running past its budget.",
  }),
  rule("budget-default", {
    severity: "note", kind: "functionality", area: "manifest",
    title: "Declare a time budget for a mod that runs code",
    reason: "Without `budget.msPerTurn` a mod gets 50 ms per game turn, and an author who knows the mod needs more should say so.",
  }),
  rule("api-range", {
    severity: "block", kind: "functionality", area: "manifest", install: true,
    title: "Declare an API range this game can run",
    reason: "The game loads a mod only when its `api` range admits an API version the game implements for the mod's runtime.",
  }),
  rule("dependency-order", {
    severity: "block", kind: "functionality", area: "manifest", install: true,
    title: "Keep load order consistent with dependencies",
    reason: "A mod loads after its required dependencies, so naming one in `loadBefore`, naming a mod in both `loadAfter` and `loadBefore`, or naming itself makes an order that cannot exist.",
  }),
  rule("capability-tier", {
    severity: "block", kind: "functionality", area: "manifest",
    title: "Request only capabilities your runtime can hold",
    reason: "Some capabilities exist only for code running in the game's own page, so a Worker mod that asks for one can never be granted it.",
  }),
  rule("first-party-capability", {
    severity: "block", kind: "safety", area: "manifest",
    title: "Leave management capabilities to the game's own mods",
    reason: "Mod management is granted only to the first-party mods the game's build names. Any in-process mod may request hidden-state access under the player's consent; autoplayer decisions still use only what the player knows.",
  }),

  rule("unparsed-module", {
    severity: "serious", kind: "functionality", area: "code", outcome: "could-not-check",
    title: "Ship modules the checker can parse",
    reason: "Every imported payload file is checked as a JavaScript module, regardless of its extension. A module that does not parse cannot be examined, and the game will most likely fail to load it too.",
  }),
  rule("missing-module", {
    severity: "block", kind: "functionality", area: "code",
    title: "Import only files the mod ships, by their full name",
    reason: "A relative import of a missing file, an extensionless path or a path outside the mod folder fails when the game loads the mod.",
  }),
  rule("unresolved-import", {
    severity: "serious", kind: "functionality", area: "code", outcome: "could-not-check",
    title: "Bundle package imports into the mod",
    reason: "The game has no import map, so a bare package name does not load, and the checker cannot see the code it would bring in.",
  }),
  rule("import-cycle", {
    severity: "serious", kind: "functionality", area: "code",
    title: "Avoid import cycles between the mod's files",
    reason: "A mod loaded from a picked folder or from storage turns each file into a blob URL, and two files that import each other cannot both get one.",
  }),
  rule("computed-import", {
    severity: "warning", kind: "safety", area: "code", outcome: "could-not-check",
    title: "Import modules by a fixed name",
    reason: "A dynamic `import()` of a computed specifier can load anything, and the checker cannot tell what.",
  }),
  rule("remote-import", {
    severity: "block", kind: "safety", area: "code",
    title: "Load code only from the mod's own files",
    reason: "An import from a URL, `data:` or `blob:` address, or through `importScripts` runs code that was never part of the reviewed payload.",
  }),
  rule("title-row-id", {
    severity: "warning", kind: "functionality", area: "code",
    title: "Give each title row an id the game accepts",
    reason: "The game refuses a title row whose id is not lower-case letters, digits and hyphens starting with a letter, up to 64 characters, and the refusal comes back as a result, so the row never appears and nothing is logged.",
  }),
  rule("unreachable-code", {
    severity: "note", kind: "functionality", area: "code",
    title: "Ship only scripts the entry module uses",
    reason: "A script no import reaches is either dead weight or loaded some way the checker cannot follow.",
  }),
  rule("undeclared-capability", {
    severity: "block", kind: "functionality", area: "code",
    title: "Declare every capability the code uses",
    reason: "A host call that needs a capability the manifest does not request can never be granted, so that part of the mod never works.",
  }),
  rule("capability-feature-test", {
    severity: "note", kind: "functionality", area: "code",
    title: "Request the capabilities the code checks for",
    reason: "The game leaves members such as ctx.installMod out unless the manifest requests their capability, so a guard controlling that use can keep it from running without the request. An unrelated test does not guard a call.",
  }),
  rule("computed-context-access", {
    severity: "warning", kind: "functionality", area: "code", outcome: "could-not-check",
    title: "Reach the mod API by fixed property names",
    reason: "Reading `ctx[name]` or `host[name]` hides which host call is made, so the checker cannot match it to a capability.",
  }),
  rule("computed-global-access", {
    severity: "warning", kind: "safety", area: "code", outcome: "could-not-check",
    title: "Reach global functions by fixed property names",
    reason: "A computed global property can select a function such as eval, so the checker reports unknown names rather than passing the call.",
  }),
  rule("untracked-invocation", {
    severity: "warning", kind: "safety", area: "code", outcome: "could-not-check",
    title: "Invoke functions through forms the checker can follow",
    reason: "An unknown function property loses its callable identity, so the checker cannot tell whether it invokes generated code.",
  }),
  rule("context-escapes", {
    severity: "warning", kind: "functionality", area: "code", outcome: "could-not-check",
    title: "Keep the mod API in code the checker can follow",
    reason: "Passing `ctx` or the registry host to code outside the mod's own functions, or storing it where the checker cannot track it, hides the calls made through it.",
  }),
  rule("plugin-shape", {
    severity: "warning", kind: "functionality", area: "code", outcome: "could-not-check",
    title: "Default-export the plugin as an object",
    reason: "The checker finds the methods the game calls through the entry module's default export, and without them it cannot tell which code receives the mod API.",
  }),
  rule("analysis-limit", {
    severity: "warning", kind: "functionality", area: "code", outcome: "could-not-check",
    title: "Keep the code within what the checker can trace",
    reason: "The checker stops tracing after a fixed number of passes, and anything it did not reach is unchecked.",
  }),
  rule("api-mismatch", {
    severity: "block", kind: "functionality", area: "code",
    title: "Declare the same API in the code and the manifest",
    reason: "The game reads the API from the manifest and the plugin states it again in its `api` field, and a mod whose two answers disagree is refused when it loads.",
  }),
  rule("dynamic-eval", {
    severity: "block", kind: "safety", area: "code",
    title: "Do not run strings as code",
    reason: "`eval`, function constructors and string timers run code that is built at run time, including through call, apply, bind, Reflect and tagged templates, which no review of the shipped files can see.",
  }),
  rule("script-injection", {
    severity: "block", kind: "safety", area: "code",
    title: "Do not add script elements to the page",
    reason: "A script element, including one created through a DOM namespace or script markup sink, can run code outside the mod's own modules, past every check on them.",
  }),
  rule("nested-worker", {
    severity: "serious", kind: "safety", area: "code",
    title: "Do not start workers of your own",
    reason: "A worker the mod starts runs outside the host's broker, so its network and storage use are not limited by the mod's capabilities.",
  }),
  rule("direct-network", {
    severity: "serious", kind: "safety", area: "code",
    title: "Send network requests through the mod API",
    reason: "`fetch`, `XMLHttpRequest`, WebSocket and the like skip the host broker, so neither the declared hosts nor the redirect limit applies to them.",
  }),
  rule("undeclared-network-host", {
    severity: "block", kind: "functionality", area: "code",
    title: "Declare every host the mod sends requests to",
    reason: "The host refuses a request to any host the manifest's `network:` capabilities do not cover.",
  }),
  rule("network-destination", {
    severity: "warning", kind: "safety", area: "code", outcome: "could-not-check",
    title: "Use request URLs the checker can read",
    reason: "A URL built at run time cannot be compared with the declared hosts until the request is made.",
  }),
  rule("insecure-transport", {
    severity: "warning", kind: "safety", area: "code",
    title: "Use https for hosts outside this computer",
    reason: "A plain http request to a remote host can be read and changed by anyone on the network path.",
  }),
  rule("credential-in-code", {
    severity: "serious", kind: "safety", area: "code",
    title: "Keep keys and tokens out of the code",
    reason: "A key written into a script is readable by everyone who installs the mod; keep it in the host's secret store and refer to it as `{secret:name}`.",
  }),
  rule("credential-in-url", {
    severity: "warning", kind: "safety", area: "code",
    title: "Send credentials in headers, not URLs",
    reason: "A key or token in a query string ends up in server logs and redirect chains.",
  }),
  rule("secret-host", {
    severity: "block", kind: "functionality", area: "code",
    title: "Bind secrets only to hosts the manifest declares",
    reason: "The host refuses to keep a secret for a host the mod cannot reach, and a `{secret:...}` template must name a secret in lower-case words joined by hyphens.",
  }),
  rule("webassembly", {
    severity: "serious", kind: "safety", area: "code",
    title: "Ship JavaScript rather than WebAssembly",
    reason: "Compiled WebAssembly cannot be read as source, so a review of the mod cannot say what it does.",
  }),
  rule("obfuscation", {
    severity: "serious", kind: "safety", area: "code",
    title: "Ship readable code",
    reason: "Obfuscator-style names, strings written almost entirely in escape codes and text assembled from character codes hide what a script does from anyone reviewing it.",
  }),
  rule("minified-code", {
    severity: "warning", kind: "safety", area: "code",
    title: "Ship unminified code",
    reason: "Minified scripts are hard to review line by line; `neo-angband-mod-build` writes readable output.",
  }),

  rule("composition-unchecked", {
    severity: "note", kind: "content", area: "composition", outcome: "could-not-check",
    title: "Check records against the base game",
    reason: "A record, patch or removal means something only next to the game's own data and the mod's dependencies, so when the checker cannot find those it skips this part and says so.",
  }),
  rule("composition-refused", {
    severity: "block", kind: "content", area: "composition",
    title: "Make every patch, replacement and removal apply",
    reason: "The loader refuses an operation whose target is missing or not the mod's to change, including a removal that would leave a reference dangling.",
  }),
  rule("dangling-reference", {
    severity: "serious", kind: "content", area: "composition",
    title: "Name only records that exist after composition",
    reason: "A record that names a monster, item or chart the composed game does not have can fail when that part of the game is reached.",
  }),
  rule("history-chart", {
    severity: "block", kind: "content", area: "composition",
    title: "Keep every history chart complete",
    reason: "Character creation rolls 1 to 100 on each chart and follows `next` to another chart, so a chart with no phrase at 100 or a link to a missing chart breaks it.",
  }),
  rule("record-check", {
    severity: "warning", kind: "content", area: "composition",
    title: "Write records the game's blueprints recognise",
    reason: "The loader reports a record whose fields do not match what the game's own data uses, and the mod loads anyway.",
  }),
];

const BY_ID: ReadonlyMap<string, CheckRule> = new Map(CHECK_RULES.map((r) => [r.id, r]));

/** The rule with this id. Throws for an id the table does not list. */
export function checkRule(id: string): CheckRule {
  const found = BY_ID.get(id);
  if (found === undefined) throw new Error(`no fixed check is called ${id}`);
  return found;
}

/** The rules the game runs while installing a mod. */
export const INSTALL_CHECK_RULES: readonly CheckRule[] = CHECK_RULES.filter((r) => r.install);

/** The fixed checks as Markdown, for the generated REQUIREMENTS.md. */
export function checksMarkdown(): string {
  const install = CHECK_RULES.filter((r) => r.install);
  const rows = (list: typeof CHECK_RULES): string =>
    list.map((r) => {
      const tags = [r.severity, r.kind, ...(r.outcome === "could-not-check" ? ["could not check"] : []), ...(r.install ? ["run at install"] : [])];
      return `### ${r.title}\n\n\`${r.id}\` - ${tags.join(", ")}\n\n${r.reason}\n`;
    }).join("\n");
  return [
    "## Fixed checks",
    "",
    "`neo-angband-mod-check` also runs the checks below over the mod's archives, payload, manifest, code and records. They live in `packages/mod-sdk/src/checks/`. A `block` finding fails the check; `serious`, `warning` and `note` findings are reported and do not. A finding marked \"could not check\" covers a part of the mod the checker could not see, which is not the same as a part it found clean.",
    "",
    `The game runs the ${String(install.length)} checks marked "run at install" when it installs a mod, and refuses the mod if one of them finds a \`block\` problem.`,
    "",
    rows(CHECK_RULES),
  ].join("\n");
}
