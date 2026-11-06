/**
 * Lab builds only: a way to reach api.github.com as a logged-in GitHub account.
 *
 * GitHub allows 60 anonymous requests an hour per address, and every lab run on
 * one machine shares that allowance, so mod install and update checks in a lab
 * build fail with HTTP 403 as soon as a few runs overlap. A lab build can send a
 * token for the account that runs the lab. Player builds are anonymous on
 * purpose and never read the variable.
 *
 * Four rules keep it narrow:
 *  - only a shell bundled with `NEO_ANGBAND_LAB_BUILD=1` reads the variable;
 *  - the header goes to `https://api.github.com/` and to no other origin, so the
 *    token never reaches a mod's server, a model host, or a redirect target, and
 *    only on the GET lookups the game makes (tags, releases, file trees), so a mod
 *    cannot use it to read or change anything else on the account;
 *  - the token is taken out of the process environment as it is read, so a mod
 *    that asks the host relay for an environment variable cannot get it;
 *  - nothing here logs, stores, or returns the token to the page.
 *
 * In its own module rather than in main.ts because main.ts imports `electron`
 * and cannot be loaded by a test.
 */

/** The environment variable the lab launcher sets, from `gh auth token`, for one run. */
export const LAB_GITHUB_TOKEN_ENV = "NEO_ANGBAND_LAB_GITHUB_TOKEN";

/** GitHub's token alphabet: classic, fine-grained, OAuth and app tokens all fit. */
const TOKEN_SHAPE = /^[A-Za-z0-9_]{20,255}$/u;

let heldToken: string | null = null;

/**
 * Read the token once, remove it from `env`, and keep it for this process. A lab
 * shell only; any other shell leaves the variable alone and holds nothing.
 * Returns whether this process now holds a token.
 */
export function takeLabGithubToken(env: NodeJS.ProcessEnv, lab: boolean): boolean {
  heldToken = null;
  if (!lab) return false;
  const value = env[LAB_GITHUB_TOKEN_ENV];
  delete env[LAB_GITHUB_TOKEN_ENV];
  if (value === undefined || !TOKEN_SHAPE.test(value)) return false;
  heldToken = value;
  return true;
}

/** True for `https://api.github.com/...` exactly: no other host, scheme, port, or user info. */
export function isGithubApiUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === "api.github.com" &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === ""
  );
}

/**
 * The read-only lookups the game makes: a repository's tags, its releases, one release by
 * tag, and one tag's file tree. A mod's code runs in the same page and could ask GitHub for
 * anything else, so the login goes to these and to nothing else.
 */
const LAB_READ_PATH = /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:tags|releases|releases\/tags\/[^/]+|git\/trees\/[^/]+)$/u;

/** True for a GET to one of the read-only lookups above on the exact API host. */
export function isLabGithubReadRequest(url: string, method: string): boolean {
  if (method.toUpperCase() !== "GET" || !isGithubApiUrl(url)) return false;
  return LAB_READ_PATH.test(new URL(url).pathname);
}

/** The `Authorization` value for this request, or null when it gets none. */
export function labGithubAuthorization(url: string, method = "GET"): string | null {
  if (heldToken === null || !isLabGithubReadRequest(url, method)) return null;
  return `Bearer ${heldToken}`;
}

/** Request headers with the lab login added when this request qualifies; the input is not changed. */
export function withLabGithubAuth(
  url: string,
  headers: Readonly<Record<string, string>>,
  method = "GET",
): Record<string, string> {
  const authorization = labGithubAuthorization(url, method);
  return authorization === null ? { ...headers } : { ...headers, Authorization: authorization };
}

/** Whether this process holds a lab token. For the launch log, which says so and never prints the token. */
export function holdsLabGithubToken(): boolean {
  return heldToken !== null;
}
