#!/usr/bin/env node
/**
 * Agent-route prefix gate.
 *
 * `app/lib/session.server.ts` decides which sign-in page a session ends on by
 * reading the request path: anything under `agent-` goes to `/agent-login`,
 * everything else to `/login`. That derivation exists because the alternative —
 * every caller passing the door in — is a thing a new route can forget, and the
 * failure is invisible: an agent lands on the STAFF login, which has no account
 * for them, and under `APP_MODE=saas` bounces on to the portal's sign-in, out of
 * this product entirely.
 *
 * Deriving it from the path only moved the forgetting, though. A route mounted
 * inside `agent-layout` WITHOUT the prefix silently gets the staff door, and no
 * unit test would notice, because the specs pin the routes that exist today.
 * This gate is the part that cannot be forgotten.
 *
 * Rule: every child of `layout("routes/agent-layout.tsx", [...])` must have a
 * path starting with `agent-`. Nothing else is checked — this is not a general
 * naming gate, it is the enforcement half of one function's assumption.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ROUTES = join(ROOT, "app", "routes.ts");
const LAYOUT = "routes/agent-layout.tsx";
const PREFIX = "agent-";

/**
 * Locate the agent-layout children array and pull out its route() paths.
 * Shared by findAgentRouteViolations and the CLI's route-count denominator so
 * the two never disagree about what "checked" means.
 * @returns {{ routes: string[], error?: string }}
 */
function locateAgentLayoutRoutes(source) {
  const start = source.indexOf(`layout("${LAYOUT}"`);
  if (start === -1) {
    return { routes: [], error: `agent-layout block not found in app/routes.ts (looked for layout("${LAYOUT}")` };
  }

  // Walk from the opening bracket of the children array to its match, so a
  // nested array or a later layout() cannot end the block early.
  const open = source.indexOf("[", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return { routes: [], error: "could not find the end of the agent-layout children array" };

  const block = source.slice(open, end);
  const routes = [...block.matchAll(/\broute\(\s*"([^"]+)"/g)].map((m) => m[1]);
  if (routes.length === 0) {
    return { routes, error: "agent-layout has no route() children — the gate is matching nothing" };
  }
  return { routes };
}

/** @returns {string[]} human-readable violation messages */
export function findAgentRouteViolations(source) {
  const { routes, error } = locateAgentLayoutRoutes(source);
  if (error) {
    // Fail loudly rather than passing vacuously. A gate that silently finds
    // nothing to check is the failure mode this repository has been bitten by.
    return [error];
  }
  const out = [];
  for (const path of routes) {
    if (!path.startsWith(PREFIX)) {
      out.push(
        `app/routes.ts: "${path}" is mounted inside ${LAYOUT} but does not start with "${PREFIX}" — ` +
        `loginPathFor() would send this page's visitors to the STAFF login`,
      );
    }
  }
  return out;
}

const source = readFileSync(ROUTES, "utf8");
const violations = findAgentRouteViolations(source);
if (violations.length > 0) {
  console.error("\nAgent-route prefix gate FAILED:\n");
  for (const v of violations) console.error(`  ${v}`);
  console.error("");
  process.exit(1);
}
const { routes } = locateAgentLayoutRoutes(source);
console.log(`agent-route gate OK (${routes.length} route(s) checked under ${LAYOUT})`);
