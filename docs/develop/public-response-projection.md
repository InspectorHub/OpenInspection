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
and token-gated routes and reports each response (`c.json`, `sendSuccess`, `respondRelativizedJson(ctx, body, tenantId)`, `Response.json`,
`new Response(JSON.stringify(...))`)
whose data is a bare row, a property or spread of one, or the result of a call that is not a known projection. It looks at every
property of the response object, not only `data`.

- **What counts as a projection:** `projectFields`, `projectReportForLink`, `projectCredentialBadgeUrls`, any
  function named `project<Something>`, a `<Name>Schema.parse(...)`, an object literal of explicit properties, a primitive
  conversion (`String`, `Object.keys`, `Math.*`, `Date.now`, ...), a function of the same file whose every return is one of
  these, and a `const` declared from one. Calls are matched by their qualified form, so `JSON.parse(x)` or `obj.projectFields(x)`
  are not mistaken for a projection.
- **Which modules:** `PUBLIC_MODULES` at the top of the script lists the modules that serve an anonymous or token-gated
  caller, and `OUT_OF_SCOPE` lists the modules that sit on or beside an open path and are deliberately not scanned, each with
  its reason. Both lists are maintained by hand. Two checks read the code instead, so a new module cannot slip past them:
  every `/api/public` mount in `server/index.ts` must resolve to a scanned module (a mount the reader cannot resolve stops the
  run), and every path or prefix that `server/lib/auth/public-paths.ts` leaves unauthenticated must resolve, through the mounts
  in `server/index.ts` and `server/portal/integration.module.ts`, to a module that is scanned or out of scope. The scope is the
  module, so a module that mixes public and signed-in routes is scanned whole. The gate also fails when a glob matches nothing,
  when a module that registers routes has no response in it, and when an `OUT_OF_SCOPE` entry no longer exists or is also scanned.
- **Both numbers every run:** the findings and the baseline are printed together.
- **Baseline:** findings that existed when a module joined the gate are frozen per file in
  `scripts/public-projection-baseline.json`. The baseline is per file and nets out: a fix and a new finding in the same file leave
  the count unchanged. It may only shrink: `node scripts/check-public-projection.mjs --write-baseline` lowers it and refuses to
  raise it.
- **Limits:** the gate reads declarations, not data flow. It looks at every level of the response object. A row is a name bound by
  `let`, by destructuring or as a parameter, a property or spread of one, or a call that is not a projection; a property picked
  under its own name (`id: row.id`) is a field pick. A property assigned after the declaration is not followed. A response helper
  the gate does not know (`jsonOk(c, rows)`) is reported as such. A schema `.parse(...)` counts as a projection unless the schema
  in the same file is `z.any()` or passes unknown keys through; a schema imported from elsewhere is taken at its word. The gate
  finds a response with no field list; it does not judge whether a list names too much.

## An intentional exception

Write `// projection-allow: <reason>` on the line above the statement, or at the end of the line that holds the response call. The
reason is mandatory (at least ten characters) and exempts only that call. Use it when the value is a typed result that a
service builds from a field list of its own, a scalar, or itself public content, and say which in the reason.
