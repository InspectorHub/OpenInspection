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
  caller (it includes `server/index.ts`, which answers a few unauthenticated routes inline). `OUT_OF_SCOPE` lists modules that an
  open path reaches and that are deliberately not scanned, each with its reason, and `PAGE_PATHS` lists the open paths outside
  `/api` that no mount answers (pages, or the inline handlers in `server/index.ts`). All three are maintained by hand. Checks that
  read the code instead: every `/api/public` mount in `server/index.ts` must resolve to a scanned module (a mount the reader
  cannot parse stops the run); every path or prefix that `server/lib/auth/public-paths.ts` opens is read in any quote style, the
  number of `startsWith(` and `path ===` comparisons must equal the number read, and each must resolve, through the mounts in
  `server/index.ts` and `server/portal/integration.module.ts`, to a module that is scanned or out of scope, or, outside `/api`, be
  listed in `PAGE_PATHS`. A module mounted at the root is held to the same rule. An `OUT_OF_SCOPE` or `PAGE_PATHS` entry that no
  open path reaches fails the run. What this does not see: a route added to a module that is not mounted under a path the reader
  reads, and paths opened by code other than `public-paths.ts`. The scope is the module, so a module that mixes public and
  signed-in routes is scanned whole.
- **Both numbers every run:** the findings and the baseline are printed together.
- **Baseline:** findings that existed when a module joined the gate are frozen per file in
  `scripts/public-projection-baseline.json`. The baseline is per file and nets out: a fix and a new finding in the same file leave
  the count unchanged. It may only shrink: `node scripts/check-public-projection.mjs --write-baseline` lowers it and refuses to
  raise it.
- **Limits:** the gate reads declarations, not data flow. It looks at every level of the response object, and follows a
  conditional, a `.map` callback and a function of the same file into the literal they return: every property of that literal
  must be built from a field list or be a pick. A row is a name bound by `let`, by destructuring or as a parameter, a property or
  spread of one, or a call that is not a projection. A pick is a property copied under its own name from a plain identifier
  (`id: row.id`), and it counts only nested inside a literal: a top-level key of the response (`data: row.data`,
  `inspection: row.inspection`) is never a pick, and neither is a property of a call, an await, a parenthesised expression or a
  longer path. A pick cannot tell a scalar from a whole object, so a member whose name tends
  to hold a row, a list of rows or a JSON column is not accepted as one: project it, or write a verified `projection-allow`. The names
  come from three sources in `scripts/lib/public-projection-containers.mjs`: a list written by hand (`CONTAINER_NAMES`: `items`, `rows`,
  `settings`, `config`, `metadata`, `photos`, `inspection`, `body`, `rest`, `lines`, `notes`, `tags`, ...), a suffix rule (any name ending
  in `Row`, `Rows`, `Data`, `List`, `Items`, `Policy`, `Prefs`, `Json`, `Config`, `Settings`, `Report`, `Profile` and the like), and every
  column the schema declares with `{ mode: 'json' }`, read from `server/lib/db/schema` with the TypeScript AST, so a new JSON column is
  covered without editing a list. Any other name copied under its own name is taken at its word. An optional chain on a plain
  identifier (`row?.total`) still counts as a pick, and `.length` is accepted on any receiver (`a.b.length`) because it is a number. A property assigned after the declaration is not followed. A call that hands the
  request context and another value to a function the file does not declare, and whose value the handler returns (`return fail(c, row)`),
  is reported as an unknown response helper; a helper whose value is stored first and returned later is not seen. A schema `.parse(...)`
  counts as a projection unless the schema in the same file is `z.any()` or passes unknown keys through; a schema imported from
  elsewhere is taken at its word. The gate finds a response with no field list; it does not judge whether a list names too much.

## An intentional exception

Write `// projection-allow: <reason>` either at the end of the line where the value starts (a trailing marker covers findings that start on
its own line, however many lines the value runs over) or on a comment-only line directly above it (it covers findings that start on the
next line). Nothing else is covered: not a later line of the same call, not the line after a trailing marker, and not a line past a blank
line. In a response written over several lines, every value the gate cannot prove needs a marker on its own line. Markers are read from
comments, so text inside a string or template literal is never a marker. The reason is mandatory (at least ten characters, wherever the
marker sits), and a marker that covers no finding is itself a finding, so it cannot outlive the value it was written for. Use it when the
value is a typed result that a service builds from a field list of its own, a scalar, or itself public content, and say what the value
is and why the holder of that route or token may see it.
