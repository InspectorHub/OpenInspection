# Sprint 2 Track 2 — Evidence

This directory holds visual evidence (Chrome MCP GIFs + static screenshots)
for the two Track 2 deliverables:

- **S2-2** Multi-inspection per request
- **S2-5** Inspection-edit sub-route split (5 tabs)

## GIF capture status

Both GIFs are **deferred** with a documented gap. Recording the full admin
flow (login → dashboard → request expand → switcher click) requires:

1. A seeded admin/inspector user (`tenants` + `users` rows)
2. At least one tenant-scoped service in `services` table (for the multi-service
   step on `/book` to render the checkbox list — currently gated by
   `x-show="hasServices"` and falls back to the Sprint 1 single-service form
   when no services are seeded)
3. An existing multi-inspection request (or a real customer booking with two
   selected services) so the sibling switcher banner has > 1 sibling to render

The Track 2 worktree was started from a clean `.wrangler` state with no
fixtures available. The router-level Playwright specs
(`tests/multi-inspection-request.spec.ts`,
`tests/inspection-subroutes.spec.ts`) exercise the surface that **does not
need seeded data** — both pass cleanly:

```text
[multi-inspection] 3 passed (6.0s)
[subroutes]        7 passed (6.1s)   (5 tabs + /edit redirect + responsive sweep)
```

## How to capture the GIFs locally once seed data is present

1. Run the standalone setup helpers to seed an admin + sample services:

   ```bash
   cd apps/core
   npm run dev:setup           # writes .dev.vars + applies migrations
   npm run seed                # if available — seeds templates / services
   ```

2. Open Chrome MCP tab to `http://127.0.0.1:8789` and authenticate.

3. **`s2-2-multi-inspection.gif`** — record:
   - `/book` → click two services → submit booking
   - `/dashboard` → see the request row with "(2 inspections)" badge
   - Click an inspection → editor shows "Part 1 of 2 in request ABC123"
   - Click sibling chip → URL switches to the other inspection

4. **`s2-5-subroutes.gif`** — record:
   - Open an inspection on `/inspections/<id>/report`
   - Click each tab: Photos → Summary → Signatures → Settings
   - Hit browser Back → returns through history
   - Visit `/inspections/<id>/edit` → 302 redirects to `/report`

The Alpine factory `requestSwitcher(inspectionId)` (see
`public/js/request-switcher.js`) and the `<InspectionShell>` component
(`src/templates/components/inspection-shell.tsx`) are the rendering surfaces
verified manually during implementation.

## Files referenced

- Migration: `migrations/0041_inspection_requests.sql`
- API: `src/api/inspection-requests.ts` (incl. `GET /by-inspection/:id`)
- Service: `src/services/inspection-request.service.ts`
- Sub-route shell: `src/templates/components/inspection-shell.tsx`
- Sub-pages: `src/templates/pages/inspection/{report,photos,summary,signatures,settings}.tsx`
- Router wiring: `src/index.ts` (lines ~1023–1136)
- Dashboard sibling badge: `src/templates/pages/dashboard.tsx` + `src/services/inspection.service.ts`
- Request switcher: `src/templates/pages/inspection-edit.tsx` (mobile + desktop banners) + `public/js/request-switcher.js`
