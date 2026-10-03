/*
 * FROZEN EXCERPT of packages/web/src/mod-source.ts as released, for the frozen
 * mod-curated.ts beside it, which imports parseRepoRef from here. These are lines
 * 41 to 101 of the file at v1.21.1, byte for byte: `RepoRef`, `RepoRefResult` and
 * `parseRepoRef`, which import nothing. The rest of that file is left out because
 * the registry parser does not use it. Do not edit it to match a newer parser.
 */


/** A repository, and optionally the one tag the player asked for. */
export interface RepoRef {
  /** `owner/repo` on GitHub. */
  readonly repo: string;
  /** A tag the player named explicitly; absent means "whatever is newest". */
  readonly tag?: string;
}

/** Why an input is not a repository reference, or the reference it is. */
export type RepoRefResult = { readonly ok: true; readonly ref: RepoRef } | {
  readonly ok: false;
  readonly problem: string;
};

const OWNER_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

/**
 * What a player can type into "install from a repository".
 *
 * Accepts the three things anyone actually has to hand: `owner/repo`, the URL of
 * the repository page, and the URL of a tag's tree (which pins that tag). A
 * `github.com/owner/repo/tree/<ref>` is read as a TAG, not a branch, because a
 * branch is a moving target and installing one would mean an installed mod whose
 * bytes change under it - see the tag discussion in mod-registry.ts.
 */
export function parseRepoRef(input: string): RepoRefResult {
  const text = input.trim().replace(/\/+$/u, "");
  if (text === "") return { ok: false, problem: "Nothing typed." };

  let rest = text;
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/iu.exec(text);
  if (url) rest = url[1] as string;
  else if (/^https?:\/\//iu.test(text)) {
    return {
      ok: false,
      problem: "Only github.com repositories can be installed from a URL.",
    };
  }

  const parts = rest.split("/");
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/iu, "");
  if (owner === "" || repo === "") {
    return { ok: false, problem: `Not a repository: "${input.trim()}"` };
  }
  const slug = `${owner}/${repo}`;
  if (!OWNER_REPO.test(slug)) {
    return { ok: false, problem: `Not a repository name: "${slug}"` };
  }

  /* .../tree/<ref> and .../releases/tag/<ref> both name one version. */
  const pinned =
    parts[2] === "tree" || (parts[2] === "releases" && parts[3] === "tag")
      ? parts[parts[2] === "tree" ? 3 : 4]
      : undefined;
  if (pinned !== undefined && pinned !== "") {
    return { ok: true, ref: { repo: slug, tag: decodeURIComponent(pinned) } };
  }
  return { ok: true, ref: { repo: slug } };
}
