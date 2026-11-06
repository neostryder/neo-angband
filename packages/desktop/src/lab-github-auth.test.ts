import { describe, expect, it } from "vitest";
import {
  LAB_GITHUB_TOKEN_ENV,
  holdsLabGithubToken,
  isGithubApiUrl,
  labGithubAuthorization,
  takeLabGithubToken,
  withLabGithubAuth,
} from "./lab-github-auth";

const TOKEN = "gho_" + "a".repeat(36);

describe("lab GitHub login", () => {
  it("holds nothing in a player build, and leaves the variable alone", () => {
    const env: NodeJS.ProcessEnv = { [LAB_GITHUB_TOKEN_ENV]: TOKEN };
    expect(takeLabGithubToken(env, false)).toBe(false);
    expect(env[LAB_GITHUB_TOKEN_ENV]).toBe(TOKEN);
    expect(holdsLabGithubToken()).toBe(false);
    expect(labGithubAuthorization("https://api.github.com/repos/a/b/tags")).toBeNull();
  });

  it("takes the token out of the environment in a lab build", () => {
    const env: NodeJS.ProcessEnv = { [LAB_GITHUB_TOKEN_ENV]: TOKEN };
    expect(takeLabGithubToken(env, true)).toBe(true);
    expect(env[LAB_GITHUB_TOKEN_ENV]).toBeUndefined();
    expect(holdsLabGithubToken()).toBe(true);
  });

  it("refuses a value that is not shaped like a token, and still removes it", () => {
    for (const bad of ["", "short", "has space " + "a".repeat(30), "line\nbreak" + "a".repeat(30)]) {
      const env: NodeJS.ProcessEnv = { [LAB_GITHUB_TOKEN_ENV]: bad };
      expect(takeLabGithubToken(env, true)).toBe(false);
      expect(env[LAB_GITHUB_TOKEN_ENV]).toBeUndefined();
    }
    expect(takeLabGithubToken({}, true)).toBe(false);
  });

  it("adds the login to api.github.com over https and nowhere else", () => {
    takeLabGithubToken({ [LAB_GITHUB_TOKEN_ENV]: TOKEN }, true);
    expect(labGithubAuthorization("https://api.github.com/repos/a/b/releases?per_page=20")).toBe(`Bearer ${TOKEN}`);
    for (const url of [
      "http://api.github.com/repos/a/b",
      "https://raw.githubusercontent.com/a/b/refs/tags/v1/manifest.json",
      "https://github.com/a/b/releases/download/v1/x.zip",
      "https://api.github.com.evil.example/repos/a/b",
      "https://evil.example/https://api.github.com/",
      "https://api.github.com:8443/repos/a/b",
      "https://user:pw@api.github.com/repos/a/b",
      "https://example.com/?u=https://api.github.com/",
      "not a url",
    ]) {
      expect(labGithubAuthorization(url), url).toBeNull();
    }
  });

  it("adds the login only to the read-only lookups the game makes, and only on GET", () => {
    takeLabGithubToken({ [LAB_GITHUB_TOKEN_ENV]: TOKEN }, true);
    for (const url of [
      "https://api.github.com/repos/a/b/tags?per_page=100",
      "https://api.github.com/repos/a/b/releases?per_page=50",
      "https://api.github.com/repos/a/b/releases/tags/v1.2.3",
      "https://api.github.com/repos/a/b/git/trees/v1.2.3?recursive=1",
    ]) {
      expect(labGithubAuthorization(url, "GET"), url).toBe(`Bearer ${TOKEN}`);
    }
    for (const url of [
      "https://api.github.com/user",
      "https://api.github.com/repos/a/b/issues",
      "https://api.github.com/repos/a/b/contents/x",
      "https://api.github.com/repos/a/b/git/refs",
      "https://api.github.com/graphql",
    ]) {
      expect(labGithubAuthorization(url, "GET"), url).toBeNull();
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(labGithubAuthorization("https://api.github.com/repos/a/b/tags", method), method).toBeNull();
    }
  });

  it("does not change the headers it is given", () => {
    takeLabGithubToken({ [LAB_GITHUB_TOKEN_ENV]: TOKEN }, true);
    const given = { Accept: "application/vnd.github+json" };
    const sent = withLabGithubAuth("https://api.github.com/repos/a/b/tags", given);
    expect(sent).toEqual({ Accept: "application/vnd.github+json", Authorization: `Bearer ${TOKEN}` });
    expect(given).toEqual({ Accept: "application/vnd.github+json" });
    expect(withLabGithubAuth("https://example.com/", given)).toEqual(given);
  });

  it("drops a held token when a later take finds none", () => {
    takeLabGithubToken({ [LAB_GITHUB_TOKEN_ENV]: TOKEN }, true);
    takeLabGithubToken({}, true);
    expect(holdsLabGithubToken()).toBe(false);
  });

  it("matches only the exact API host", () => {
    expect(isGithubApiUrl("https://api.github.com/")).toBe(true);
    expect(isGithubApiUrl("https://API.GITHUB.COM/x")).toBe(true);
    expect(isGithubApiUrl("https://github.com/")).toBe(false);
  });
});
