/**
 * A register of mod AUTHORS, and what it is careful not to claim.
 *
 * WHY AUTHORS AND NOT MODS. The redesign this sits inside exists to stop the build
 * knowing anything about any mod: a mod's name, version, description and engine
 * range are facts about the mod and are read from the mod. An author is not a fact
 * about a mod. It is a fact about a PERSON, it changes at the speed people change
 * rather than the speed software ships, and there are far fewer of them. So a
 * register of authors can live in the game's repository without reintroducing the
 * problem - and a test asserts an entry carries no mod-shaped field, the same
 * ratchet mods/registry.json has.
 *
 * Keyed by repository OWNER, because that is the part of a mod reference that is
 * actually somebody's: `neostryder/neo-angband-mod-qol` can only be published by
 * whoever holds `neostryder`. GitHub enforces that, which is what makes the key
 * meaningful rather than a name anyone can type.
 *
 * WHAT A LISTING MEANS, EXACTLY: a person maintaining this file recognised that
 * account and its work. That is all. It is not a code review, not a security audit,
 * not a promise the next release is safe, and it must never be presented as one -
 * an author's future commits are not reviewed by anybody, and a badge that implies
 * they are would be worse than no badge, because it would buy trust it has not
 * earned. The wording in `standingNote` is part of the feature for that reason.
 *
 * WHAT AN ABSENCE MEANS: nothing at all. Most good mods will be by people who never
 * asked to be listed. An unlisted author is UNVOUCHED, not suspected, and the UI
 * says so in those terms - the alternative teaches players that unlisted means
 * dangerous, which would make this file a gate on who gets to write mods. It is not
 * one. Nothing here changes what can be installed; the third-party consent in
 * mod-consent.ts is the only gate, and it applies to listed and unlisted alike.
 */

import type { RegistryEnv } from "./mod-curated";

/**
 * The part of an author's declared name that goes BESIDE a mod's name.
 *
 * Measured against the real manifests: the first-party mods declare
 * `neostryder (RPGM Tools)`, which beside a name produces
 * `neo-linoleum (neostryder (RPGM Tools))` - nested brackets, and twenty-two columns
 * of a row that has warnings to fit at the end of it. So the organisation in
 * parentheses is dropped here and the handle is kept.
 *
 * This is not truncation and it does not invent anything: `neostryder` is the
 * author's own word for themselves, and the FULL string is still printed in the
 * detail pane, where there is room for all of it. What is never done is cutting a
 * name mid-word, which would attribute a mod to an account that does not exist.
 */
export function shortAuthor(author: string): string {
  const paren = author.indexOf(" (");
  const head = paren > 0 ? author.slice(0, paren) : author;
  return head.trim();
}

/**
 * A mod as it is NAMED on screen: `Neo Linoleum (neostryder)`.
 *
 * WHOSE MOD IT IS BELONGS NEXT TO WHAT IT IS CALLED. A list of a dozen mods from
 * half a dozen strangers, with the author only in a detail pane, makes "who wrote
 * this" something a player has to go and ask about one row at a time - and it is the
 * single most useful fact about a third-party mod.
 *
 * FROM THE MANIFEST, NEVER FROM THE REGISTER BELOW, even though it lives in the same
 * file. The register is a standing a person here looked at; this is the author's own
 * claim about themselves. They are different things and neither may be able to be
 * read as the other - which is also why the register's standing is a sentence in the
 * detail pane and not a word on the row (see `standingNote`, and browseRow's note).
 *
 * WHEN IT STILL DOES NOT FIT, THE AUTHOR IS DROPPED WHOLE - never truncated. `Bug
 * Fixes (neost...` attributes a mod to somebody who does not exist, which is worse
 * than not saying. Only after that does the name itself elide, because on a row the
 * badges past it are the warnings (rowLabel says why the name is what gives way).
 */
export function displayName(
  name: string,
  author: string | null | undefined,
  room = Number.POSITIVE_INFINITY,
): string {
  const who =
    author !== null && author !== undefined && author !== "" ? shortAuthor(author) : "";
  const full = who === "" ? name : `${name} (${who})`;
  if (full.length <= room) return full;
  if (name.length <= room) return name;
  return `${name.slice(0, Math.max(1, room - 3))}...`;
}

/** Where the register lives: the game's own repository, at the default branch. */
export const DEFAULT_AUTHORS_URL =
  "https://raw.githubusercontent.com/neostryder/neo-angband/master/mods/authors.json";

/**
 * How an author's claim to their account was checked.
 *
 * A closed set rather than free text, so a row cannot be given a standing that
 * sounds official and means nothing. Every value here is something a person can
 * actually verify from outside; "we trust them" is deliberately not among them.
 */
export type AuthorCheck =
  /** The owner published the mods this project itself ships and curates. */
  | "maintainer"
  /** They asked to be listed and answered from the account, in the open. */
  | "declared";

export interface RegisteredAuthor {
  /** The GitHub owner. Compared case-insensitively; GitHub names are not case-sensitive. */
  readonly owner: string;
  /** The name they would like shown. Falls back to the owner. */
  readonly name: string;
  readonly check: AuthorCheck;
  /** Free text from the author about themselves, or null. Never trusted as markup. */
  readonly about: string | null;
}

export interface AuthorRegister {
  readonly url: string;
  readonly authors: readonly RegisteredAuthor[];
  /** One line per entry that could not be read, rather than a silent drop. */
  readonly problems: readonly string[];
}

export type AuthorRegisterResult =
  | { readonly ok: true; readonly register: AuthorRegister }
  | { readonly ok: false; readonly problem: string };

const SCHEMA = 1;

function isCheck(v: unknown): v is AuthorCheck {
  return v === "maintainer" || v === "declared";
}

/**
 * Parse a register document. Pure, and never throws.
 *
 * Same shape of leniency as parseRegistry, for the same reason: a bad entry costs
 * that entry and is reported, a bad document costs the whole file. A register that
 * fails to load must be survivable, because it decides nothing - the worst outcome
 * of losing it is that every author shows as unvouched, which is the honest default.
 */
export function parseAuthors(body: string, url: string): AuthorRegisterResult {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch (e) {
    return {
      ok: false,
      problem: `${url} is not valid JSON (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { ok: false, problem: `${url} is not an author register` };
  }
  const d = doc as Record<string, unknown>;

  const schema = d["schema"];
  if (typeof schema !== "number" || !Number.isInteger(schema)) {
    return { ok: false, problem: `${url}: no schema version, so it cannot be read safely` };
  }
  if (schema > SCHEMA) {
    return {
      ok: false,
      problem:
        `${url} is a newer kind of author register (schema ${String(schema)}) than ` +
        `this build understands. Updating the game should fix it.`,
    };
  }

  const list = d["authors"];
  if (!Array.isArray(list)) {
    return { ok: false, problem: `${url}: its "authors" is not a list` };
  }

  const authors: RegisteredAuthor[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of list.entries()) {
    const at = `${url} entry ${String(i + 1)}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      problems.push(`${at}: not an object`);
      continue;
    }
    const e = raw as Record<string, unknown>;
    const owner = e["owner"];
    if (typeof owner !== "string" || owner === "") {
      problems.push(`${at}: names no owner`);
      continue;
    }
    /* A GitHub owner, and nothing that could be a path or a URL. An entry that
     * carried `neostryder/thing` would silently never match an owner, so it is
     * refused where it can be seen rather than being quietly inert. */
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(owner)) {
      problems.push(`${at}: "${owner}" is not a GitHub account name`);
      continue;
    }
    const check = e["check"];
    if (!isCheck(check)) {
      /* Refused rather than defaulted. Defaulting would invent a standing nobody
       * granted, and the whole value of the closed set is that every value in it
       * was chosen deliberately. */
      problems.push(`${at}: "check" must be "maintainer" or "declared"`);
      continue;
    }
    const key = owner.toLowerCase();
    if (seen.has(key)) {
      problems.push(`${at}: ${owner} is listed more than once`);
      continue;
    }
    seen.add(key);
    authors.push({
      owner,
      name: typeof e["name"] === "string" && e["name"] !== "" ? e["name"] : owner,
      check,
      about: typeof e["about"] === "string" && e["about"] !== "" ? e["about"] : null,
    });
  }

  return { ok: true, register: { url, authors, problems } };
}

/**
 * Fetch and parse the register. Never throws.
 *
 * A failure here is deliberately cheap: it decides nothing, so the caller carries on
 * with `null` and every author shows as unvouched - which is the honest default and
 * not an error state. Losing this file must never be able to block an install, or a
 * register outage would become a mod outage.
 */
export async function fetchAuthors(
  url: string,
  env: RegistryEnv,
): Promise<AuthorRegisterResult> {
  let res: Awaited<ReturnType<RegistryEnv["fetch"]>>;
  try {
    res = await env.fetch(url);
  } catch (e) {
    return {
      ok: false,
      problem: `Could not reach ${url} (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      problem:
        res.status === 404
          ? `${url}: there is no author register there (HTTP 404)`
          : `${url}: refused (HTTP ${String(res.status)})`,
    };
  }
  return parseAuthors(await res.text(), url);
}

/** The owner half of `owner/repo`, lower-cased. Empty for anything unparseable. */
export function ownerOf(repo: string): string {
  const cut = repo.indexOf("/");
  return cut <= 0 ? "" : repo.slice(0, cut).toLowerCase();
}

/** The register entry for a repository's owner, or null. */
export function authorFor(
  register: AuthorRegister | null,
  repo: string,
): RegisteredAuthor | null {
  if (!register) return null;
  const owner = ownerOf(repo);
  if (owner === "") return null;
  return register.authors.find((a) => a.owner.toLowerCase() === owner) ?? null;
}

/**
 * The one line a row shows about an author's standing.
 *
 * The wording is the feature. Each of these says who said what, and none of them
 * says the code is safe - because nobody checked the code, and a player who reads
 * "verified" as "checked" has been misled by this function rather than by the mod.
 */
export function standingNote(author: RegisteredAuthor | null, repo: string): string {
  if (!author) {
    /* Deliberately not a warning, and deliberately not empty. Silence would leave
     * the listed authors looking like the only real ones; a warning would make this
     * register a gate on who may write mods, which it must never become. */
    return `By ${ownerOf(repo) || "an unknown author"}, who is not in the author register.`;
  }
  /* The owner is appended only when the display name does not already contain it.
   * Otherwise the first entry in the shipped register renders as
   * "neostryder (RPGM Tools) (neostryder)" - the owner twice, once in a parenthesis
   * the author wrote and once in one this function added. */
  const lower = author.name.toLowerCase();
  const who = lower.includes(author.owner.toLowerCase())
    ? author.name
    : `${author.name} (${author.owner})`;
  return author.check === "maintainer"
    ? `By ${who}, who maintains Neo Angband. Still third-party code: nothing here reviews it.`
    : `By ${who}, listed in the author register. That records the account, not a review of its code.`;
}
