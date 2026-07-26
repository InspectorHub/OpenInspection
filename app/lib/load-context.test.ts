import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RouterContextProvider } from "react-router";
import { getCloudflareEnv, createLoadContext, type LoadContext } from "./load-context";

describe("getCloudflareEnv", () => {
  it("returns the env the worker put on the load context", () => {
    expect(getCloudflareEnv(createLoadContext({ APP_MODE: "saas" })).APP_MODE).toBe("saas");
  });

  it("returns an empty env when the context was never seeded", () => {
    // The context key carries a default, so a provider nobody seeded reads as
    // an empty env. Unit tests build bare contexts deliberately; a loader
    // reading an optional var must stay exercisable without a worker behind it.
    expect(getCloudflareEnv(new RouterContextProvider())).toEqual({});
  });

  it("does not throw on an undefined context", () => {
    expect(() => getCloudflareEnv(undefined as unknown as LoadContext)).not.toThrow();
  });
});

/**
 * The value of the accessor is that it is the ONLY reader. A stray
 * `context.cloudflare.env` elsewhere is not a style problem — it is a call site
 * that the v8 `RouterContextProvider` migration will silently miss, because
 * narrowing to `unknown` is not a type error at every one of them.
 *
 * Enforced here rather than in a lint rule so the constraint travels with the
 * accessor it protects.
 */
describe("load-context access is centralized", () => {
  const APP_DIR = join(import.meta.dirname, "..");

  function sourceFilesUnder(dir: string): string[] {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "paraglide" ? [] : sourceFilesUnder(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it("has no direct context.cloudflare reads outside this module", () => {
    const offenders = sourceFilesUnder(APP_DIR)
      // The accessor and this spec are the pair that owns the expression:
      // the accessor reads it, and the spec names it in the pattern below.
      .filter((file) => !/load-context\.(ts|test\.ts)$/.test(file))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        // Strip comments: several files legitimately MENTION the expression
        // while explaining why they call the accessor instead.
        const code = source
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        return /context\??\.cloudflare/.test(code);
      })
      .map((file) => file.slice(APP_DIR.length + 1));

    expect(offenders).toEqual([]);
  });
});
