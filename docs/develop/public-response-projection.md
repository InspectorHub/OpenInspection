# Public response projection

A route that someone reaches without signing in (a report link, a pay link, a booking page, a share link) answers with a
response built from a **list of fields**, not from a database row or a service result.

## Why

A row carries every column its table has, today and after the next change. A response built from the row inherits each of
them. A response built from a field list carries what the list names and nothing else, and the list is the one place a
reader can see what that surface states. Declaring a response schema is not enough on its own: the router does not trim a
response to its schema, so the schema documents the shape without enforcing it.

## The rule

1. Name the fields. Use `projectFields(source, keys)` from `server/lib/response-projection.ts`, or an object literal of
   explicit properties, or a schema `.parse(...)` that drops what is not declared.
2. Keep the list next to the schema it belongs to (the public invoice keeps `PUBLIC_INVOICE_FIELDS` beside
   `PublicInvoiceBodySchema`, and a spec checks that the two agree).
3. A key the source does not have stays absent. `projectFields` copies own keys only, never changes the source, and is typed
   as the picked subset, so a name that is not a key of the source is a compile error.

The report link response is the largest example: `projectReportForLink` in `server/lib/report-link-response.ts` classifies
every top-level key of the report and rebuilds the inspection, sign-off and document-review rows from lists.

## The gate

`npm run lint:public-projection` (`scripts/check-public-projection.mjs`, push rung) reads the route modules that serve public
and token-gated routes and reports each response (`c.json`, `sendSuccess`, `Response.json`, `new Response(JSON.stringify(...))`)
whose data is a bare row, a property or spread of one, or the result of a call that is not a known projection. It looks at every
property of the response object, not only `data`.

- **What counts as a projection:** `projectFields`, `projectReportForLink`, `finishReportLink`, `relativizeReportKeys`, any
  function named `project<Something>`, a `<Name>Schema.parse(...)`, an object literal of explicit properties, a primitive
  conversion (`String`, `Object.keys`, `Math.*`, `Date.now`, ...), a function of the same file whose every return is one of
  these, and a `const` declared from one. Calls are matched by their qualified form, so `JSON.parse(x)` or `obj.projectFields(x)`
  are not mistaken for a projection.
- **Which modules:** `PUBLIC_MODULES` at the top of the script is data. It lists every module that serves an anonymous or
  token-gated caller, derived from the prefixes in `server/lib/auth/public-paths.ts` and the `/api/public` mounts in
  `server/index.ts`. The scope is the module, so a module that mixes public and signed-in routes is scanned whole. The gate
  fails when a glob matches nothing, when a module that registers routes has no response in it, and when a module mounted under
  `/api/public` is not in the list.
- **Both numbers every run:** the findings and the baseline are printed together.
- **Baseline:** findings that existed when a module joined the gate are frozen per file in
  `scripts/public-projection-baseline.json`. The baseline may only shrink: `node scripts/check-public-projection.mjs
  --write-baseline` lowers it and refuses to raise it.
- **Limits:** the gate reads declarations, not data flow. A `let`, a property assigned after the declaration, or a name bound by
  destructuring is not followed (and is reported). It finds a response with no field list at all; it does not judge whether a list
  names too much, and it does not look inside the values of a nested object literal.

## An intentional exception

Write `// projection-allow: <reason>` on the line above the statement, or at the end of the line that holds the response call. The
reason is mandatory (at least ten characters) and exempts only that statement. Use it when the value is a typed result that a
service builds from a field list of its own, a scalar, or itself public content, and say which in the reason.
