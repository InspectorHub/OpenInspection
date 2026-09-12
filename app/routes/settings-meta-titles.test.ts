// @vitest-environment node
/**
 * F68 — seven Settings pages exported no `meta`, so every one of their browser
 * tabs read "OpenInspection" and nothing else: in a tab strip, and in history,
 * they were indistinguishable from each other and from the app's root.
 *
 * This asserts the rule over EVERY settings route rather than over the seven
 * that were found by hand, so the eighth page to be added is covered before
 * anybody opens it in a browser. That is the difference between fixing a list
 * and fixing the class of defect — the walkthrough found these by reading tab
 * titles one at a time, which is not a thing anybody does twice.
 *
 * It reads the route modules as TEXT. Importing them would pull in
 * `requireToken`, `createApi` and the whole server graph for a question that is
 * answered by whether a file has a `meta` export and what it returns.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES_DIR = join(__dirname);
const CATALOG = join(__dirname, "..", "..", "messages");

/** Every settings page module: `settings-*.tsx`, minus tests and the layout. */
const SETTINGS_ROUTES = readdirSync(ROUTES_DIR)
  .filter((f) => f.startsWith("settings-") && f.endsWith(".tsx"))
  .filter((f) => !f.includes(".test."))
  // The layout renders the chrome around these pages and owns no title of its
  // own; a title on it would win over none of them and lose to all of them.
  .filter((f) => f !== "settings-layout.tsx");

const en = JSON.parse(readFileSync(join(CATALOG, "en", "settings.json"), "utf8")) as Record<string, string>;

function source(file: string) {
  return readFileSync(join(ROUTES_DIR, file), "utf8");
}

describe("settings pages — browser tab titles", () => {
  it("found the settings routes to check", () => {
    // A positive control: an empty list would make every assertion below pass.
    expect(SETTINGS_ROUTES.length).toBeGreaterThan(20);
    expect(SETTINGS_ROUTES).toContain("settings-billing.tsx");
  });

  it("every settings page exports meta", () => {
    const missing = SETTINGS_ROUTES.filter((f) => !/export\s+(function|const)\s+meta\b/.test(source(f)));
    expect(missing).toEqual([]);
  });

  it("every title comes from the catalogue, not from an English literal", () => {
    const hardcoded = SETTINGS_ROUTES.filter((f) => {
      const body = source(f).match(/export\s+function\s+meta\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0]
        ?? source(f).match(/export\s+const\s+meta[\s\S]*?\n\}/)?.[0]
        ?? "";
      return /title:\s*["'`]/.test(body);
    });
    expect(hardcoded).toEqual([]);
  });

  it("the eight titles this finding added are in the catalogue and name their page", () => {
    const expected: Record<string, RegExp> = {
      settings_hub_meta_title: /^Settings - OpenInspection$/,
      settings_profile_meta_title: /^Profile - /,
      settings_security_meta_title: /^Account & Security - /,
      settings_workspace_meta_title: /^Company - /,
      settings_inspection_types_meta_title: /^Inspection types - /,
      settings_advanced_meta_title: /^Advanced - /,
      settings_billing_meta_title: /^Billing - /,
      settings_statutory_meta_title: /^Statutory form PDFs - /,
    };
    for (const [key, shape] of Object.entries(expected)) {
      expect(en[key], key).toBeTruthy();
      expect(en[key]).toMatch(shape);
      // The suffix every other settings tab carries. `/settings/statutory-forms`
      // was the page that had a title and was missing exactly this.
      expect(en[key]).toMatch(/ - OpenInspection$/);
    }
  });
});
