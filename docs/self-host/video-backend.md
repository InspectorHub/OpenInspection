# Video Backend — R2 (default) vs Cloudflare Stream

OpenInspection supports two video backends for inspection walk-through clips. The default is **R2** (free, zero marginal cost). **Cloudflare Stream** is an optional paid upgrade that adds adaptive bitrate delivery, automatic poster generation, and GPS/EXIF stripping on transcode.

---

## Default: R2

Video clips are stored directly in the `PHOTOS` R2 bucket alongside field photos.

- **Zero marginal cost** — covered by Cloudflare R2 Free tier (10 GB storage, 1 M Class A ops/month).
- **Clips are stored as-recorded.** The worker buffers the clip (up to the 200 MB / 30 s cap) and writes it to R2 verbatim. Container-level GPS, EXIF, and other metadata are **not** stripped.
- **Privacy checkbox.** Because clips carry the original container metadata, the Media Studio `VideoCapture` component presents a privacy notice checkbox. The inspector must acknowledge it before the upload is allowed. The checkbox is absent on the Stream path because Stream re-transcodes on ingest, which drops container-level GPS/EXIF.
- **HTTP Range serving.** Clips are served via `GET /api/inspections/:id/media/video/r2-object/:mediaId` with full HTTP 206 Range support so the browser `<video>` element can seek without re-downloading.

### Key shape (R2)

```
{tenantId}/inspections/{inspectionId}/videos/{mediaId}.{ext}          — clip
{tenantId}/inspections/{inspectionId}/videos/{mediaId}.poster.jpg     — poster frame
```

Defined in `server/lib/r2-keys.ts` (`r2Keys.inspectionVideo` / `r2Keys.inspectionVideoPoster`).

---

## Upgrade: Cloudflare Stream

Stream is the paid-tier video backend. It provides:

- **Adaptive bitrate (HLS/DASH)** via an embedded `<iframe>` player.
- **Automatic poster frames** at any `thumbnailTimestampPct`.
- **GPS/EXIF stripping** — Stream re-transcodes on ingest so container metadata is gone by the time the video is playable. The privacy checkbox is therefore not shown.
- **30-second duration cap** enforced at the Stream edge (not in the worker).

Videos are uploaded directly from the browser to Cloudflare via a one-shot direct-creator-upload URL minted by the worker. Video bytes never transit the worker.

### Enabling Stream — Self-host

1. **Provision a Cloudflare Stream subscription** on your Cloudflare account.
2. **Add the `STREAM` binding** to your `wrangler.local.jsonc`:
   ```jsonc
   "stream": { "binding": "STREAM" }
   ```
3. **In the dashboard:** Settings → Integrations → Video → toggle from R2 to Stream and enter your **Stream customer subdomain** (the `<id>.cloudflarestream.com` prefix, e.g. `customer-abc123`). This value is stored in `tenant_configs.integrationConfig.streamCustomerSubdomain`.

The resolver reads `tenant_configs.videoMode`. Default is `'r2'`. When set to `'stream'` but either the `STREAM` binding or the subdomain is absent, the worker returns **503 Service Unavailable** (fail-closed — no silent fallback to R2).

### Enabling Stream — SaaS

In SaaS mode the video backend is **plan-gated and not user-configurable**:

| Tenant tier / status | Backend |
|---|---|
| `free` or `trial` | R2 |
| `pro` or `enterprise` (non-trial) | Stream |

The platform `STREAM_CUSTOMER_SUBDOMAIN` env var supplies the subdomain for all paid tenants. The toggle in Settings → Integrations → Video is hidden in SaaS mode.

---

## Backend resolver

`server/services/video/resolve.ts` exports `resolveVideoBackend(c)`. It reads `APP_MODE`, then:

- **SaaS**: queries `tenants.tier` + `tenants.status` and applies the plan gate.
- **Self-host**: queries `tenant_configs.videoMode` (default `'r2'`) and `integrationConfig.streamCustomerSubdomain`.

Returns `{ backend: VideoBackend, provider: 'r2' | 'stream', streamSubdomain: string | null }`.

The `VideoBackend` interface (`server/services/video/types.ts`) is satisfied by both `R2VideoBackend` and `StreamVideoBackend`:

```
createUpload(inspectionId) → { uploadURL, ref: VideoRef }
finalize(ref, posterRef?)  → { poolId }
getDetails(ref)            → { readyToStream, pctComplete?, durationSec? }
delete(ref)                → void
```

---

## PDF degradation

PDF renders (via `env.BROWSER.quickAction('pdf', ...)`) cannot embed video. `server/lib/report-video.ts` (`selectReportMedia`) detects the PDF path (`isPdf: true`) and substitutes a Stream poster image + a QR code / link to the online player (`/watch/:streamUid`). R2 videos on the PDF path degrade to the poster JPEG served from R2.

---

## Tests

| File | Covers |
|---|---|
| `tests/unit/resolve.spec.ts` | 4-way resolution table, backend instance type, `streamSubdomain` propagation, fail-closed 503 |
| `tests/unit/r2-backend.spec.ts` | Token mint/verify (tamper + expiry), type/size validation, R2 key shape, finalize idempotency |
| `tests/unit/media-video.spec.ts` | `MediaVideoService` (Stream) + `StreamVideoBackend` tenant guard and finalize |
| `tests/unit/report-video.spec.ts` | `selectReportMedia` — image / video-player / video-poster branches |
| `tests/web/unit/video-capture.spec.ts` | `VideoCapture` — privacy checkbox present (R2), absent (Stream) |
| `tests/web/unit/video-player.spec.ts` | `VideoPlayer` — iframe rendered for Stream, native `<video>` for R2 |
| `tests/unit/session-context-video.spec.ts` | `sessionContext` video fields exposed to the frontend |
