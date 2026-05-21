# Extending OpenInspection

A cookbook for common extensions. Each recipe shows the minimal files to add or modify.

## Add a new seed template

A "seed" template ships in the marketplace and any tenant can import it.

1. Create `seed/templates/your-template.json` matching the existing schema:

   ```json
   {
     "name": "Annual HVAC Tune-up",
     "version": "1.0.0",
     "type": "specialty",
     "ratingSystemId": "oi-4-level",
     "sections": [
       {
         "id": "hvac-1",
         "title": "Outdoor unit",
         "items": [
           {
             "id": "hvac-1-1",
             "label": "Refrigerant lines",
             "tabs": {
               "information": [],
               "limitations": [],
               "defects": []
             }
           }
         ]
       }
     ]
   }
   ```

2. Add the file path to `scripts/seed-marketplace.js` import list.
3. Run `node scripts/seed-marketplace.js` (local) or `wrangler d1 execute openinspection --file scripts/seed-marketplace.sql` (remote).
4. Submit a PR. We feature standout templates in the marketplace listing.

## Add a new payment provider

Replace or extend Stripe Connect:

1. Create `src/services/payments/<provider>.service.ts` implementing the `PaymentProvider` interface (in `payments/types.ts`).
2. Add the provider's API key to `wrangler.toml` env vars and to the env table in `CLAUDE.md`.
3. Wire into `src/api/billing.ts` route — provider selected per-tenant via `tenant_settings.paymentProvider`.
4. Settings UI: extend `src/templates/pages/settings-services.tsx` to add a provider config card.

## Add a new automation rule

1. Add the automation type to `src/lib/db/schema.ts` `automation_rules.event` enum.
2. Trigger in the relevant service:

   ```typescript
   await this.automation.fire({
     event:        'inspection.published',
     inspectionId: ins.id,
     tenantId,
     context:      { recipientType: 'client', ... },
   });
   ```

3. UI: Settings → Communication → Automations form lets the inspector pick rule + email template.

## Add a new comment library

1. Author a `library.json` file with 50-300 entries:

   ```json
   {
     "name": "Texas TREC-compliant comments",
     "version": "1.0.0",
     "entries": [
       { "id": "trec-1", "section": "Roof", "text": "...", "ratingBucket": "good" }
     ]
   }
   ```

2. Submit via PR to `seed/libraries/`.
3. After merge, marketplace import gives any tenant the library.

## Add a new SSO provider

OAuth/OIDC scaffolding lives in `src/api/auth.ts`. Add a new handler:

```typescript
app.get('/api/auth/saml', ...);
```

Generic OAuth helpers live in `lib/oauth.ts`. Open a Discussion thread first to discuss the spec before opening a PR.

## Add a new language (i18n)

Not yet implemented. The intended path:

1. Wrap public-facing strings with `t('key')` from `src/lib/i18n.ts` (TBD module).
2. Translation files in `locales/<lang>.json`.
3. Browser language detection via `Accept-Language` header.
4. Tenant override via Settings → Workspace → Language.

PRs welcome.

## Customize the report template visual style

Each tenant has a `report_theme` setting (Settings → Workspace → Report Theme). Three themes ship: `modern` (default), `classic`, `minimal`. To add a new theme:

1. Add a stylesheet at `public/themes/<theme-id>.css` overriding canonical `--ih-*` tokens.
2. Add to `src/lib/themes.ts` registry.
3. The theme picker UI in Settings auto-includes new themes.

## Build a custom PDF output

CF Free tier doesn't allow Browser Rendering, so OpenInspection's report PDF uses browser `window.print()`. To add a server-side PDF (e.g., for TREC REI 7-6 government form):

1. Use `pdf-lib` (pure JS, ~200 KB) — works in Cloudflare Workers.
2. New endpoint at `src/api/inspections.ts` `GET /api/inspections/:id/pdf?format=trec-rei-7-6`.
3. Build PDF programmatically via field-by-field placement.
4. Return `Content-Type: application/pdf` plus a signed URL or inline body.

## Add a webhook receiver

For integration with Zapier / Make / custom CRMs:

1. New endpoint at `src/api/webhooks.ts` `POST /api/webhooks/<provider>`.
2. Validate HMAC signature using webhook secret stored in `tenant_settings`.
3. Map external event → internal action (e.g., a Zap creates a booking).

## Override individual UI components

Pages live in `src/templates/pages/`. To replace one:

1. Fork the file (e.g. `dashboard.tsx`).
2. Modify rendering — keep the route registration unchanged.
3. Type-check + visual smoke at 1440 px and 375 px.

For more invasive customizations, see `src/templates/themes/` (TBD scaffold for tenant-specific overrides).

## Add a new keyboard hotkey

1. Choose a key not already in `docs/superpowers/plans/2026-05-08-sprint1-design-system-reference.md` § Differentiation.
2. Wire in `public/js/inspection-edit.js` keydown handler. Check `isTyping(e)` for single-character keys to avoid hijacking text input.
3. Register the hotkey in `src/templates/components/keyboard-hud.tsx` so the `?` HUD shows it.
4. Add an e2e test asserting the action fires.

## Get help

- 💬 [Q&A discussions](https://github.com/InspectorHub/OpenInspection/discussions/categories/q-a)
- 🐛 [Issue tracker](https://github.com/InspectorHub/OpenInspection/issues)
- 🧪 [Start a free trial](https://inspectorhub.io/register)
