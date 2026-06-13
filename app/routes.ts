import {
  type RouteConfig,
  index,
  route,
  layout,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  // Issue #111 — read-only inspection hub ("where does this job stand?").
  route("inspections/:id", "routes/inspection-hub.tsx"),
  // Full-screen editor (own chrome, no sidebar)
  route("inspections/:id/edit", "routes/inspection-edit.tsx"),
  route("templates/:id/edit", "routes/template-edit.tsx"),
  // Public pages — no auth, minimal layout, SSR for SEO
  layout("routes/public-layout.tsx", [
    route("book/:tenant", "routes/public/booking.tsx"),
    // IA-26 — legacy per-inspector URL kept alive as a deep link: 302 to the
    // company page with ?inspector=<slug> (preserves ?ref= and other params).
    route("book/:tenant/:slug", "routes/public/booking-inspector-redirect.tsx"),
    route("report/:tenant/:id", "routes/public/report.tsx"),
    route(
      "agreements/sign/:tenant/:token",
      "routes/public/agreement-sign.tsx",
    ),
    route("checkout/:tenant/:token", "routes/public/checkout.tsx"),
    route("r/:id/invoice", "routes/public/invoice.tsx"),
    route("verify/:envelopeId", "routes/public/verify.tsx"),
    route("verify", "routes/public/verify-offline.tsx"),
    route("v/:token", "routes/public/verify-token.tsx"),
    route("observe/inspections/:id", "routes/public/observe.tsx"),
    route("concierge/expired", "routes/public/concierge-expired.tsx"),
    // Flow A — client redeems the agent-concierge magic link emailed as
    // ${APP_BASE_URL}/confirm/<token>. Shows booking details then POSTs the
    // confirm and follows the server-chosen redirect (agreement / report).
    route("confirm/:token", "routes/public/concierge-confirm-token.tsx"),
    route(
      "inspector/:tenant/:slug",
      "routes/public/inspector-profile.tsx",
    ),
    route("inspector-not-found", "routes/public/inspector-not-found.tsx"),
    route(
      "report-gate/:tenant/:id",
      "routes/public/report-gate.tsx",
    ),
    route(
      "report-view/:tenant/:id",
      "routes/public/report-card-stack.tsx",
    ),
    route("messages/:token", "routes/public/messages.tsx"),
    // Track L (D6, path B) — public SMS double-opt-in confirmation page.
    route("sms-optin/:token", "routes/public/sms-optin.tsx"),
    route("r/:id/repair-request", "routes/public/repair-request.tsx"),
    route(
      "agreements/print/:token",
      "routes/public/agreement-printable.tsx",
    ),
  ]),
  // Standalone pages (own chrome, no sidebar)
  route("setup", "routes/setup.tsx"),
  route("inspections/:id/form", "routes/form-renderer.tsx"),
  route("join/:token", "routes/join.tsx"),
  route("guest-join/:token", "routes/guest-join.tsx"),
  route("conflict-resolver/:id", "routes/conflict-resolver.tsx"),
  route("version-diff/:id", "routes/version-diff.tsx"),
  // Standalone public — no layout (iframe-friendly)
  // IA-26 — company-level embed (no inspector slug); legacy per-inspector kept alive.
  route("embed/:tenant", "routes/public/booking-embed-company.tsx"),
  route(
    "embed/:tenant/:slug",
    "routes/public/booking-embed.tsx",
  ),
  // Standalone agent pages — no agent-layout chrome
  route("agent-invite/:token", "routes/agent/invite-accept.tsx"),
  route("agent-invite-expired", "routes/agent/invite-expired.tsx"),
  route("agent-signup", "routes/agent/signup.tsx"),
  // Error / utility pages (bare, outside auth)
  route("not-found", "routes/not-found.tsx"),
  route("feature-disabled", "routes/feature-disabled.tsx"),
  // API docs (Swagger UI) — was hono GET /ui; OpenAPI JSON still served at /doc
  route("ui", "routes/docs.tsx"),
  // BFF resource routes (no UI) — Token-Relay endpoints for editor hooks
  // (Track H / C-12: client code never fetches /api directly).
  route("resources/comments-library", "routes/resources/comments-library.tsx"),
  route("resources/repair-items", "routes/resources/repair-items.tsx"),
  route("resources/identities", "routes/resources/identities.tsx"),
  route("resources/inspection-prefs", "routes/resources/inspection-prefs.tsx"),
  route("resources/inspection-settings-sheet", "routes/resources/inspection-settings-sheet.tsx"),
  route("resources/publish-readiness", "routes/resources/publish-readiness.tsx"),
  route("resources/recent-inspections", "routes/resources/recent-inspections.tsx"),
  route("resources/team-members", "routes/resources/team-members.tsx"),
  route("resources/template-search", "routes/resources/template-search.tsx"),
  route("resources/inspection-search", "routes/resources/inspection-search.tsx"),
  layout("routes/auth-layout.tsx", [
    // IA-6 — BFF resource route for advisory schedule-conflict detection.
    // Loaded via useFetcher; no UI rendered; must be inside the auth layout so
    // requireToken() can redirect to /login when unauthenticated.
    route("resources/schedule-conflicts", "routes/resources/schedule-conflicts.ts"),
    route("dashboard", "routes/dashboard.tsx"),
    route("calendar", "routes/calendar.tsx"),
    route("contacts", "routes/contacts.tsx"),
    // IA-18 (#111) — contact detail (record + inspection history + stats).
    route("contacts/:id", "routes/contact-detail.tsx"),
    route("invoices", "routes/invoices.tsx"),
    route("notifications", "routes/notifications.tsx"),
    route("templates", "routes/templates.tsx"),
    route("team", "routes/team.tsx"),
    route("metrics", "routes/metrics.tsx"),
    route("apprentice-review", "routes/apprentice-review.tsx"),
    route("reports", "routes/reports-redirect.tsx"),
    layout("routes/settings-layout.tsx", [
      route("settings", "routes/settings-hub.tsx"),
      route("settings/profile", "routes/settings-profile.tsx"),
      route("settings/inspection", "routes/settings-inspection.tsx"),
      route("settings/workspace", "routes/settings-workspace.tsx"),
      route("settings/services", "routes/settings-services.tsx"),
      route("settings/communication", "routes/settings-communication.tsx"),
      route("settings/communication/templates/:trigger", "routes/settings-communication-template.tsx"),
      route("settings/automations", "routes/settings-automations.tsx"),
      route("settings/data", "routes/settings-data.tsx"),
      route("settings/compliance", "routes/settings-compliance.tsx"),
      route("settings/widget", "routes/settings-widget.tsx"),
      route("settings/account", "routes/settings-account.tsx"),
      route("settings/advanced", "routes/settings-advanced.tsx"),
      route("settings/integrations", "routes/settings-integrations.tsx"),
      route("settings/integrations/qbo", "routes/settings-integrations-qbo.tsx"),
      route("settings/event-types", "routes/settings-event-types.tsx"),
      route("settings/contractor-types", "routes/settings-contractor-types.tsx"),
      route("settings/inspection-types", "routes/settings-inspection-types.tsx"),
      route("settings/booking", "routes/settings-booking.tsx"),
      route("settings/catalog/booking", "routes/settings-catalog-booking.tsx"),
      route("settings/billing", "routes/settings-billing.tsx"),
      route("settings/usage", "routes/settings-usage.tsx"),
      route("settings/security", "routes/settings-security.tsx"),
    ]),
    route("comments", "routes/comments.tsx"),
    route("repair-items", "routes/repair-items.tsx"),
    route("recommendations", "routes/recommendations-redirect.tsx"),
    route("library/tags", "routes/library/tags.tsx"),
    route("agreements", "routes/agreements.tsx"),
    route("library/rating-systems", "routes/library/rating-systems.tsx"),
    route("marketplace", "routes/marketplace.tsx"),
  ]),
  layout("routes/agent-layout.tsx", [
    route("agent-dashboard", "routes/agent/dashboard.tsx"),
    route("agent-settings/profile", "routes/agent/settings-profile.tsx"),
    route("agent-inspectors", "routes/agent/inspectors.tsx"),
    route("agent-recommendations", "routes/agent/recommendations.tsx"),
  ]),
] satisfies RouteConfig;
