# Native clients

The engine can serve an offline-first native app (iOS, Android, Windows). This
page describes the server-side mechanisms: how a native client signs in, how it
and the server agree on a version, how it uploads media and reconnects its
editor, how work captured offline reaches the server, and which parts of the API
are a promise to installed binaries and therefore may only grow.

It is written for two readers: an operator who runs a deployment, and a
contributor who changes the engine. The native app itself is a separate
project; nothing here depends on how it is built.

---

## 1. Turning it on

Set `NATIVE_CLIENT_ENABLED` to `true` (or `1`) on the worker and redeploy.

```jsonc
// wrangler.local.jsonc, under "vars"
{ "vars": { "NATIVE_CLIENT_ENABLED": "true" } }
```

The switch is **off by default**, and off means closed rather than quiet:

- the authorization step, the token exchange and the refresh grant refuse a
  native client;
- a native access token presented to `/api/*` is rejected (on `/mcp` a native
  grant is always refused with `403`, whatever the switch says);
- a one-time WebSocket ticket (section 7) is rejected;
- the token-only upload routes (section 8) answer `404`.

Everything else behaves exactly as it did. The OAuth provider is mounted when
either `MCP_ENABLED` or `NATIVE_CLIENT_ENABLED` is set (`oauthProviderEnabled` in
`server/lib/mcp/flag.ts`), but the two switches stay independent:

- With only `NATIVE_CLIENT_ENABLED`, the MCP surface is off. The consent page
  answers `404` to an authorization that asks for MCP scopes, the token endpoint
  refuses an MCP grant (`400 invalid_grant`, and the grant is revoked), and
  `/mcp` answers `404` even to a token issued while MCP was on. Client
  registration is open on any deployment that mounts the provider, so this is
  what stops a registered client from being turned into an MCP token.
- With only `MCP_ENABLED`, a native authorization, exchange or refresh is refused
  as described above.
- An MCP grant can never be used as a native session or the reverse (see the
  `native` scope below).

Deploy order matters when you upgrade: apply the migrations **before** the new
code (section 14).

---

## 2. Signing in: OAuth with the `native` scope

A native client authenticates with the same OAuth 2.1 provider that serves MCP
(`/oauth/authorize`, `/oauth/token`, `/oauth/register`), asking for the scope
`native`. A native grant carries exactly that scope and no MCP module scopes,
whatever else the client asked for.

| Rule | Detail |
|---|---|
| Flow | Authorization code with PKCE. **`S256` is required**: a request without a challenge, or with `plain`, is refused. |
| Redirect URI | Only a **private-use scheme containing a dot** (reverse-domain form, for example `io.example.app:/callback`) or an **IP-literal loopback** (`http://127.0.0.1` or `http://[::1]`). `https`, the hostname `localhost` and remote `http` are refused. The dot requirement excludes every scheme a browser treats as active content (`javascript`, `data`, `file`, ...). See "Redirect URIs" below. |
| Consent screen | Shows the app name, the scheme the code will be delivered to (or "this computer" for a loopback redirect), and an "unverified app" label. Client registration is open, so the name is whatever the client claimed. |
| Roles | `owner`, `manager` and `inspector`. The `agent` role is refused before any grant exists, and before the consent page is shown. |
| Access token | Opaque, **1 hour**. |
| Refresh token | No fixed expiry, but a grant **unused for 90 days** is refused and revoked. The 90 days slide: each successful exchange moves the clock. |
| Transport | The client sends the token as `Authorization: Bearer`. No cookie is involved. |
| Scope | There is one scope, `native`, and it is not narrower than a web session. See "What a native token can do" below. |

### What a native token can do

A native access token is equivalent to a full web session for the member it was
issued to. It reaches every `/api/*` route that member's role reaches, including
team management, password and two-factor changes. There is no narrower scope,
and that is by design: the app is the product's own client, not a third party.
This is why the consent screen names the app, the redirect target and an
"unverified app" label, and why the redirect rules below are strict.

### Redirect URIs

Version 1 accepts only a dotted private-use scheme and an IP-literal loopback.
**An `https` callback (a universal link or app link) is not supported**: with open
dynamic registration, an `https` redirect would let anyone register a client whose
code is delivered to a web origin they control, so allowing it would need an
operator-maintained allowlist. Android uses a private scheme instead.

### Grants are not bound to a device

A grant belongs to a member and a client id, not to a device. Authorizing again
under the same client id does **not** revoke the member's earlier grant, so a
second phone, or a reinstall, does not sign the first one out. Register one
client per installation (`POST /oauth/register` is cheap) so the member's list of
connected apps shows each device as its own row and one can be revoked alone.

To keep abandoned installs from piling up, each member keeps at most
`NATIVE_GRANTS_PER_USER_MAX` (10) native grants: when a new one would exceed it,
the oldest by creation time are revoked. This is best effort and never undoes the
sign-in that triggered it. The member's MCP grants are never touched.

### What ends a session

A token is checked against the member's row on every request, and the grant is
revoked on the events below. Either is enough to stop access.

| Event | Effect |
|---|---|
| Member removed | Every OAuth grant the member holds is revoked; the token also fails the row check, and a refresh re-reads the row too. |
| Member re-invited after removal | The reactivated account keeps its id, so every grant that id still holds is revoked when the invitation is accepted. |
| Password change or reset | Grants are revoked. As a second line, the `pwchanged:{userId}` marker that cuts off web sessions is also read for a native token: a grant made before the marker is refused on use and on refresh (a grant made after it is unaffected). The marker is kept for 100 days, longer than the 90-day idle limit, so it covers every grant that could still refresh; a grant left unused past the idle limit is refused by that rule anyway. Revocation remains the primary control and the marker is the fallback for when it failed. Like the web session check, no bound KV skips the comparison and a KV read that fails refuses the token. |
| Role change | Grants are revoked, so no token keeps the old role. Between the change and the revocation the role used is the row's current role, never the one captured at consent. |
| Role no longer native-capable (for example `agent`) | The token resolves to no identity. |
| Account self-deletion | Grants are revoked. |
| `NATIVE_CLIENT_ENABLED` turned off | Every native token and ticket is refused immediately. |

Consent is written to the audit log as `native.grant.created`. A refresh that is
refused for any of the reasons above also revokes the grant it was made with, so a
grant cannot outlive the switch, the membership or the credential that allowed it.
The refresh re-reads the member's row and the marker before it issues a token, so
a revocation that failed when the member was removed cannot be bypassed by
refreshing.

---

## 3. Offline time limit: `offline_max_days`

The company setting `offline_max_days` (API field `offlineMaxDays`, integer
1 to 365, default 30) is how long a device may stay offline before it locks its
local data. The **device enforces it**; the server only publishes it, in
`GET /api/client/session`. Change it with `PATCH /api/admin/tenant-config`.
A company with no configuration row reports the default.

---

## 4. Version handshake

The server can ask old app versions to update. All of it is optional: with no
variables set, no app is ever asked to update.

| Variable | Meaning |
|---|---|
| `NATIVE_MIN_VERSION_<PLATFORM>` | Lowest version still allowed to make changes. Below it, ordinary API calls answer `426`. |
| `NATIVE_RECOMMENDED_VERSION_<PLATFORM>` | Below it, the response carries a "recommended" signal and nothing is blocked. |
| `NATIVE_DOWNLOAD_URL_<PLATFORM>` | Where the client points the user to update. |

`<PLATFORM>` is `IOS`, `ANDROID` or `WINDOWS`. Versions are up to three numeric
components (`1`, `1.4`, `1.4.2`).

**Request headers** the client sends on every call: `X-Client-Platform` (`ios`,
`android` or `windows`) and `X-Client-Version`. A missing platform, a missing
version or an unparseable version never blocks anything; the rule fails open.

**Response header** `X-Client-Upgrade`: `required` or `recommended`, set when the
sent version is below the corresponding threshold. A browser can read it because
it is in `Access-Control-Expose-Headers` for the native origins.

**`426`** (`CLIENT_UPGRADE_REQUIRED`) is returned only when the status is
`required` **and** the call is not in `NEVER_BLOCK_RULES`
(`server/lib/native/client-version.ts`). Work captured on a device must always be
deliverable, so any version may still make these calls. A rule names a path and,
where the same path also serves reads, a method:

- the collab socket, collab import and ticket routes, and the inspection presence
  socket;
- the media upload-URL and video upload routes, and `/api/public/uploads/*`;
- `GET /api/client/session`, `POST /api/client/import` and `GET /api/client/compat`;
- the REST writes that hand over a captured inspection: `POST /api/inspections`
  (with the client's own id), `PATCH /api/inspections/{id}` and
  `POST /api/inspections/{id}/complete`. `PATCH /api/inspections/bulk` is a fixed
  route, not an inspection id, and is not on the list: an outdated app cannot use
  it to update inspections in bulk.

The method matters: `GET /api/inspections` and `GET /api/inspections/{id}` are
still refused with `426`, because an outdated app should hand its work over, not
pull current data. The tenant-wide presence socket (`/api/tenant/presence/ws`) is
not listed: it has no ticket route, so a WebView cannot open it.

**`GET /api/client/compat?platform=<platform>`** is public, so a client can call
it before signing in. It returns `minSupported`, `recommended`, `downloadUrl`
(each possibly `null`) and `serverContractVersion`.

### Which versions are still in use

Retiring an old version is only safe once nothing runs it, so the server records
when each version was last seen. `GET /api/client/session`, which the app calls on
every start and refresh, upserts one row of the table `native_client_seen`
(`tenant_id`, `platform`, `client_version`, `first_seen_at`, `last_seen_at`) when
the request carries a valid `X-Client-Platform` and an `X-Client-Version` of up to
three dotted numbers (at most 32 characters; `1.4` is stored as `1.4.0`). Anything
else is ignored, not rejected.

- **Throttled.** A row is rewritten at most once an hour, so a busy fleet costs
  about one D1 write per version per hour.
- **Bounded.** A company holds at most 200 rows. Past that, new versions are not
  recorded and existing ones are still refreshed. Any signed-in member can fill the
  200 by sending invented versions, so the record can be crowded out; the only
  thing at risk is the completeness of the "last seen" record, and nothing else
  reads the table.
- **Best effort.** A failed write is logged and never changes the response.
- **Per company.** Rows carry `tenant_id` and are removed with the company on a
  purge.

To see what is still in use:

```sql
SELECT platform, client_version, datetime(last_seen_at / 1000, 'unixepoch') AS last_seen
FROM native_client_seen
ORDER BY platform, last_seen_at DESC;
```

Raise `NATIVE_MIN_VERSION_<PLATFORM>` above a version only after its `last_seen`
is older than your longest offline allowance (`offline_max_days`).

---

## 5. CORS for the app's WebView

A Capacitor WebView serves its pages from `capacitor://localhost` (iOS) or
`https://localhost` (Android), so its calls to the API are cross-origin. For
exactly those two origins the API answers with:

- the request headers `Idempotency-Key`, `X-Client-Version` and
  `X-Client-Platform` allowed, and `X-Client-Upgrade` exposed;
- **no `Access-Control-Allow-Credentials`** and no `Set-Cookie` exposure.

The convention is **Bearer only, no credentials**: the app never relies on a
cookie, so the browser is never asked to send one cross-origin. Every other
origin keeps the baseline policy unchanged. Other origins cannot opt in; the
list is fixed in `server/lib/native/cors-origins.ts`.

---

## 6. Client-provided inspection ids

`POST /api/inspections` accepts an optional `id` matching
`^[A-Za-z0-9_-]{1,64}$`, so a device can create an inspection offline and keep
referring to it by a name it chose. The id is not required to be a UUID.

| Case | Answer |
|---|---|
| New id | `201`, the inspection is created. |
| Id already belongs to an inspection in the same company that the caller may open (an owner or manager, or a member assigned to it) | `200` with the existing inspection. None of the create's side effects run again, so a retry is safe. |
| Id belongs to a record outside the company, or to an inspection in it that the caller is not assigned to | `409` `ID_CONFLICT`, the same answer for both, with no inspection fields. |

A create is several writes and cannot be one transaction. For an inspection with a
client-chosen id the writes after the inspection row run in a fixed order whose
**last step is the primary report**, so "the report exists" means "the create
finished". If the first attempt stopped before that, it answers with an error
(a `5xx`) and the retry, a replay of the same id, finishes the job from the
replay's own request body. What the first attempt already wrote stands, and the
new body only supplies the steps that are missing. The steps, each safe to run twice:

| Step | A repeat |
|---|---|
| Roster entry for the inspector | Added only to an inspection nobody is assigned to, so it never undoes a reassignment. |
| Automation notices (`inspection.created`) | Carry a deterministic dedup key, so the notices an earlier attempt wrote are not written again. |
| Client contact | Matched by email and reused, whatever the contact's type and however the address is cased, so a broker who is also a client is linked as the client rather than duplicated; a client with no email is matched by name. Two runs at the very same moment resolve to the one contact when there is an email; with a name only, they can each add one, as two simultaneous creates for one client always could. |
| People links (client, buyer's agent, listing agent) | Unique per inspection, contact and role. A role that already has someone is left as the first attempt wrote it, so a replay with a different body never changes the primary client; only a role that is still empty is filled. |
| Service lines and their price overrides | Written only while the inspection has none, under ids derived from the inspection and the service, so the amounts are never doubled. |
| `inspection.create` audit entry | Written under an id derived from the inspection, so there is one. |
| Primary report and results row | Added only if missing. |

The allowance and the discount are spent before any of this and are never spent
again by a replay. A replay checks the contacts it names against the company
before it writes anything, so it cannot link a contact from another company.
Until the report exists the inspection cannot be opened for editing, and
the collaboration routes answer `404` for it; the retry is what repairs that.

Nothing locks the steps, because each is safe on its own: a replay that arrives
while the first attempt is still running, or two replays at once, write the same
rows once between them. An inspection that was created whole is not touched by a
replay.

A replay by a member who may not open the inspection (not an owner or manager and
not on its roster) answers `409` `ID_CONFLICT`, as for an id held outside the
company. A client should treat that `409` as the **final outcome of that outbox
entry**: retrying it cannot succeed, and it must not be retried or silently
dropped. Surface it to the user.

---

## 7. One-time WebSocket tickets

A WebView WebSocket cannot send an `Authorization` header, and a native client
holds a bearer token rather than a session cookie. It trades its bearer identity
for a ticket and opens the socket with `?ticket=`.

- `POST /api/inspections/{id}/collab/ticket` issues a ticket. The caller must be
  a native session with access to that inspection.
- A ticket is valid for **60 seconds**, for **one use**, and for **one
  inspection**.
- It is accepted only on the WebSocket upgrade of that inspection's collab or
  presence socket (`/api/inspections/{id}/collab/ws`,
  `/api/inspections/{id}/presence/ws`). It is not a credential for any other
  route.
- Redemption deletes the ticket before using it. When the ticket is presented,
  the member's current role is read again; a member who was removed or demoted
  since issue cannot open the socket.
- Every failure (unknown, expired, used, wrong inspection, member gone, native
  clients disabled) is a `401`.

---

## 8. Signed media uploads

A background upload can outlive the access token that started it, so uploads do
not use one.

1. The authenticated client asks for an upload URL:
   `POST /api/inspections/{id}/media/upload-url` for a photo, or the video
   create-upload route for a video. Only native sessions are offered this.
2. The response carries a URL with a signed token. The token is valid for
   **24 hours** (`expiresAt` is in the response), and names one company, one
   inspection and one media id. The photo token also names the member who minted
   it.
3. The client sends the file to `POST /api/public/uploads/photo?token=...` or
   `/api/public/uploads/video?token=...` as a multipart field named `file`, with
   no `Authorization` header.

Rules the upload route applies, in order:

- With `NATIVE_CLIENT_ENABLED` off the route answers `404`, even for a token that
  was minted while it was on and has not expired. (The web editor is never handed
  this URL; it uploads through its session.)
- A photo token is refused by the video route and the reverse; a tampered or
  expired token is `401`.
- Before reading any bytes it re-checks that the inspection still exists and that
  the member who minted the token is still an active member; otherwise `401` or
  `404`.
- The request **must declare `Content-Length`**: a missing or non-numeric length
  is `411`, and an oversized declaration is `413`, both before the body is
  buffered. The limits are 10 MiB for a photo and 200 MiB for a video.
- The photo's content type must be the one the URL was minted for (`image/jpeg`,
  `image/png` or `image/heic`).
- The storage key is a pure function of the token, so sending the same token
  twice overwrites one object instead of adding another.

---

## 9. Offline package, format v1

When a device cannot sync, it can write a **package** that another signed-in
member imports with `POST /api/client/import` (body `application/zip`, with
`Content-Length`). Everything in a package is a claim by whoever produced it:
the company and the importing identity come from the importer's verified
session, never from the package.

### Contents

A package is a zip with only these entries; any other name refuses the package.

| Entry | Content |
|---|---|
| `manifest.json` | `format` (`openinspection-offline-package`), `version` (`1`), `tenantId`, `deviceId`, `exportedBy`, `exportedAt`, and the list of `inspections` (`id`, `reportId`). Unknown keys are ignored, so a later writer can add fields within version 1. |
| `yjs/<inspectionId>.bin` | The collaborative results document of one inspection, as a Yjs update. |
| `outbox.json` | The writes the device queued. Each entry has an `idempotencyKey`, an `op` (`inspection.create`, `inspection.update` or `inspection.complete`) and a `payload` whose `id` names the inspection. The envelope is strict: an unknown key or an unknown `op` refuses the package. |
| `media/index.json` | One row per photo: `pendingId`, `inspectionId`, `contentType`. |
| `media/<pendingId>.<jpg\|png\|heic>` | The photo bytes. |

Identifiers match `^[A-Za-z0-9_-]{1,64}$`, so an id can never smuggle a path
separator into a zip entry name or a storage key.

### Import semantics

An import has two phases and the line between them is the point.

1. **Validate, writing nothing.** The archive is judged from its directory (entry
   names, counts, declared sizes), the manifest, media index and outbox are
   parsed, the manifest's company must be the importer's, and every inspection
   named must be one the **importer** is allowed to edit or one the package's own
   outbox creates. Any failure changes nothing, for every inspection in the
   package.
2. **Apply**, in this order: queued creates, photos, Yjs updates (resolving
   pending photo references), then the remaining queued writes.

Further rules:

- **The importer is the caller.** Queued writes are replayed as ordinary
  requests with the caller's credentials, so each is checked by the route it
  targets against the caller's role. `exportedBy` is recorded in the audit trail
  and never consulted for authorization; a package from a member who has since
  been removed imports fine when another member with access imports it.
- **Partial failure is reported, not hidden.** A queued write the server refuses
  is listed in `outbox.failed` (`idempotencyKey`, `op`, `inspectionId` and the
  HTTP `status` it was refused with). The results and photos in the package are
  still imported; the listed entries need attention on the device.
- **A refused update blocks the completion after it.** If a queued update to an
  inspection is refused, a later `inspection.complete` for the same inspection is
  not attempted: it is listed in `outbox.failed` with `status` `424` and
  `reason` `blocked_by_failed_update`, because completing the inspection would
  mark finished a record that lacks the device's change. Other inspections are
  unaffected, and the entry stays retryable once the update is fixed. The set of
  `reason` values may grow in a later version, so a client must tolerate a value
  it does not know: treat it as "not attempted, keep the entry", and do not
  validate `reason` against a closed enumeration.
- **A busy key stops the request.** A queued write whose idempotency key is held
  by a request that is still running (`409` `IDEMPOTENCY_IN_FLIGHT`, for example
  the same package sent twice at once) is not reported as failed: the whole import
  answers `409` and the client retries it, exactly as for a `5xx`. That `409` is
  told apart from the other ones by `error.details.reason`, which is
  `idempotency_in_flight`; `details` also names the `idempotencyKey`, `op` and
  `inspectionId` of the busy write.
- **Imports are idempotent.** Sending the same package again is safe. A create is
  held by its client-chosen id; the 24-hour `Idempotency-Key` ledger replays a
  repeat inside its window; and the table `offline_import_applied` records every
  queued write that was applied, per company, key and inspection, so a repeat
  after the ledger expired cannot put an old value over a newer edit. Rows are
  written only after the target route answered `2xx`, so a refused entry stays
  retryable. A row can only be matched by a package that is still importable,
  so it is deleted once it is older than the package age limit plus a margin
  (see the limits table); an import sweeps a bounded batch of such rows for its
  own company at the end, and a failed sweep never affects the import.
- **Packages expire.** A package whose manifest `exportedAt` is more than 400
  days old is refused with `422` `PACKAGE_EXPIRED` and nothing is written. The
  limit is longer than the longest a device can stay offline (`offline_max_days`
  is at most 365), so an honest package is never turned away. `exportedAt` is the
  device's own claim: the limit protects against replaying a stale package by
  accident, not against a member who edits the manifest.
- **Packages cannot be dated ahead.** A package whose `exportedAt` is more than
  one day ahead of the server clock is refused with `422`
  `PACKAGE_FROM_THE_FUTURE` (`details.maxFutureSkewDays`) and nothing is written.
  A device clock set far ahead would otherwise produce a package that never
  expires. The day covers ordinary clock skew and time zones; the fix is to
  correct the device clock and export again.
- **Every entry must hold the bytes it declares.** The zip directory states each
  entry's size; an entry that unpacks to more or fewer bytes than that refuses
  the whole package with `400` before anything is written. (The zip checksum is
  not verified: computing it over up to 48 MiB costs more CPU than the Free plan
  allows. JSON and Yjs entries must parse, and photos pass the same type and size
  checks as every other photo upload.)
- **The work of reading a package follows its declared size.** Deflate can pack
  zeros about a thousandfold, so a small body can describe a very large entry.
  The directory is refused before anything is unpacked when an entry carries more
  compressed data than its declared size could need, when a stored entry's length
  differs from its declared size, or when two entries share compressed bytes. An
  entry that passes is unpacked incrementally and abandoned as soon as it
  produces more than it declared, so the CPU an entry can cost is a small
  multiple of its declared size, which the unpacked-size limit bounds, and not of
  what its stream could expand to.
- **A deleted inspection stays deleted.** If a recorded create names an
  inspection that has since been deleted, the package is refused with `409`
  `PACKAGE_INSPECTION_DELETED` and nothing is written.
- The response reports `inspections`, `photos`, `outbox` (`applied`, `skipped`,
  `failed`) and `yjs` (`changed`, `unchanged`).

---

## 10. Import limits

One import is **one worker invocation**, and an invocation has a CPU-time limit
and a limit on subrequests (every call to a binding counts: each D1 query, KV or
R2 operation, Durable Object fetch). A package can reach those before it runs
out of memory, so the server bounds the size of what it accepts at once.

| Variable | Default | Allowed range |
|---|---|---|
| `NATIVE_IMPORT_MAX_INSPECTIONS` | 8 | 1 to 200 |
| `NATIVE_IMPORT_MAX_OUTBOX` (queued writes) | 20 | 1 to 500 |
| `NATIVE_IMPORT_MAX_PHOTOS` | 50 | 1 to 1500 |
| `NATIVE_IMPORT_MAX_ENTRIES` (zip entries) | 200 | 4 to 2000 |
| `NATIVE_IMPORT_MAX_COMPRESSED_BYTES` (request body) | 16777216 (16 MiB) | 65536 (64 KiB) to 25165824 (24 MiB) |
| `NATIVE_IMPORT_MAX_UNCOMPRESSED_BYTES` (sum of decompressed entries) | 50331648 (48 MiB) | 65536 (64 KiB) to 75497472 (72 MiB) |

Reading a variable never throws. A missing, blank or non-numeric value falls
back to the default, and a number outside the range is clamped into it, so a
misconfiguration can never switch a limit off.

Three constants are fixed rather than configurable, because together they define
how long the server remembers what it has applied:

| Constant | Value | Meaning |
|---|---|---|
| Package age (`PACKAGE_MAX_AGE_DAYS`) | 400 days | Oldest `exportedAt` an import accepts |
| Applied-record retention (`APPLIED_RECORD_RETENTION_DAYS`) | 420 days | Age at which an `offline_import_applied` row may be swept |
| Sweep batch (`APPLIED_RECORD_SWEEP_BATCH`) | 100 rows | Most rows one import deletes |

The defaults are sized from a measured estimate of the subrequests a package
costs:

```
estimated subrequests = 70 + inspections * 22 + queued writes * 20 + photos * 3
```

The largest default package (8 inspections, 20 queued writes, 50 photos) comes to
796. Queued writes dominate because each is replayed as an ordinary request and
pays the whole middleware chain.

The defaults are sized from the subrequest count alone. **Their CPU time has not
been measured on the platform**: the test runtime does not enforce a CPU limit, and
an import of any size spends more than the 10 ms the Workers Free plan allows per
invocation, so on that plan it relies on the platform's tolerance for short
overruns, which is not a guarantee. Use the default small batches, send a large
batch as several smaller packages, and before raising a limit check the
platform's current CPU-time and subrequest limits for your plan against the
estimate above.

### When a package is over a limit

Nothing is written. The answer is `422` `PACKAGE_TOO_LARGE` for a count (too
many inspections, queued writes, photos or entries) and `413` `PACKAGE_TOO_LARGE`
for a size (request body or unpacked size). `details` names the limit that was
hit, its maximum and the package's actual value, and `details.limits` carries the
numbers a client needs to split the package: `inspections`, `outbox`, `photos`
and `compressedBytes`.

A split package imports exactly like a whole one, because every step is
idempotent. When splitting, keep each inspection's results, photos and queued
writes in the same part, and send the part that carries an inspection's create
first.

### Splitting a package that one inspection keeps refusing

A refusal about one inspection refuses the whole package, so a single bad entry
can hold up every other inspection in it. The error names the inspection:
`details.inspectionId` on a `403` (the importer cannot edit it) and a `404` (it
does not exist and the package does not create it), on a `400` for an inspection
exported from a different report, on `409` `PACKAGE_INSPECTION_DELETED` (which
also lists `details.inspectionIds`), and on a failure while its results or photos
were being applied. A client that gets one of these should write the inspection
named into a package of its own, send the rest as a package without it, and keep
the named one on the device for the person to resolve.

---

## 11. Owner rules

Only an **owner** can change or remove an owner. A non-owner is refused when they
try to remove an owner, demote an owner, invite someone as an owner, or promote a
member to owner. The check runs before the target is looked at further, so a
refused caller learns nothing about the target. The last owner of a company can
neither be removed nor demoted, and nobody can remove themselves or change their
own role.

---

## 12. The contract registry and the add-only rule

An installed app binary cannot be recalled, so every endpoint a native client
calls is a promise. Two files keep the promise visible:

- `scripts/lib/native-contract-registry.ts` lists the endpoints. Operations
  declared with `createRoute()` are in `NATIVE_CONTRACT`; endpoints OpenAPI
  cannot describe (WebSocket upgrades, binary bodies, the OAuth endpoints a
  library serves) are in `NATIVE_NON_OPENAPI_CONTRACT`, and their shape is pinned
  by `tests/unit/native/contract-non-openapi.spec.ts`.
- `contracts/native-contract.openapi.json` is the OpenAPI slice for the first
  list, generated from the live routes.

**The rule is add-only.** Adding an endpoint, an optional request field or a
response property is fine. Removing or renaming anything, making an optional
request field required, or removing a response property breaks installed apps.

Workflow when you change a registered endpoint:

```bash
npm run native:contract      # regenerate contracts/native-contract.openapi.json
npm run lint:native-contract # registry and committed document must agree
```

- `tests/unit/native/contract-drift.spec.ts` fails when the committed file is
  stale, so a route change cannot land without regenerating it.
- `lint:native-contract` fails when a registry entry has no operation in the
  file, when an operation has no registry entry, when none are found, or when the
  registry is empty. It prints both numbers on every run.
- In CI, **oasdiff** compares the file against the base branch's copy and fails
  the pull request on any breaking change. The comparison is skipped only in the
  pull request that first introduces the file.

---

## 13. Related pages

- [`../integrations/mcp.md`](../integrations/mcp.md): the MCP server, which shares
  the OAuth provider.
- [`conventions/mcp-oauth-notes.md`](conventions/mcp-oauth-notes.md): OAuth provider
  internals and pinned package symbols.
- [`../operate/deploy.md`](../operate/deploy.md): what a deploy provisions.
- [`testing.md`](testing.md) and [`gates.md`](gates.md): where the specs and gates
  mentioned above live.

---

## 14. Upgrading a deployment that already runs the engine

The native surface adds two forward-only migrations:

| Migration | Adds |
|---|---|
| `0001_offline_max_days.sql` | `tenant_configs.offline_max_days` (integer, default 30) |
| `0002_offline_import_applied.sql` | The `offline_import_applied` table and its `(tenant_id, applied_at)` index, and the `native_client_seen` table |

**Apply migrations before deploying the new code.** The new code reads
`offline_max_days` on the session route, writes `native_client_seen` there too (a
failed write is logged and ignored), and writes `offline_import_applied` on
import; running it against a database that has not been migrated fails those
routes. With the flag off, nothing else changes. See
[`../operate/upgrade.md`](../operate/upgrade.md) for the upgrade procedure.
