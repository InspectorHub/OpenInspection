# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-12

First stable release. Consolidates the work landed since `1.0.0-rc.1`;
grouped by theme rather than one entry per commit.

### Added
- **Commercial PCA reports** — an ASTM E2018-style Property Condition
  Assessment surface: dual-table Cost Engine (Opinion of Cost + Capital
  Replacement Reserve Schedule), tiered light/full reports, per-unit
  inspection, ASTM compliance module (dual sign-off, PSQ, document review),
  editable narrative and reliance text, photo appendix, clickable TOC, and a
  Word (`.docx`) export with a full reserve-schedule year grid.
- **Collaborative inspection editing** — real-time co-editing on Yjs +
  Durable Objects, with version history and offline media upload.
- **Remote MCP server + OAuth 2.1** — a flag-gated Model Context Protocol
  endpoint (tools, resources, prompts) for AI clients.
- **Client portal** — magic-link "My Inspections" + inspection hub, a
  per-inspection shared client documents area, and a client Repair Request
  Builder.
- **Pluggable communications** — bring-your-own email providers (Resend,
  SendGrid, Postmark, Mailgun) and SMS providers (Twilio, Telnyx) behind a
  provider abstraction, with compliance webhooks, a template library,
  connection-test history, and toll-free-verification opt-in handling
  (HELP/OPTOUT/REVOKE, legal links).
- **Report PDF** — paginated print layout, per-tenant PDF settings, and an
  in-editor Preview PDF.
- **Usage metering** — per-tenant metering with a self-service usage view and
  free-tier usage quotas.
- **Inspection detail hub** — consolidated inspection + contact detail views.

### Changed
- Eliminated SSR page-transition lag and added consistent loading states.
- Removed the built-in per-tenant Google Analytics (GA4) tracking.
- MCP extended tier: Resources, Prompts, and UI polish.

### Fixed
- Editor field-readiness, offline queue, and new-inspection wizard fixes.
- Settings persistence: conform-native checkboxes for report/repair-feature
  flags, provider-aware Email/SMS copy, and correct branding read-back.
- M2M tenant upsert keyed on a stable id with slug self-heal.
- Kept the automation cron flush query under D1's 100-column result-set cap.
- Pointed "Switch workspace" links at `/company/switch`.
- UI/endpoint bug batch with nav-skeleton anti-flicker.
- Resolved code-scanning alerts and dependency vulnerabilities (Hono, uuid).

## [1.0.0-rc.1] - 2026-04-09

### Added
- **High-Fidelity Testing**: Introduced `vitest` and `better-sqlite3` for in-memory, deterministic unit testing of the service layer.
- **Service Mocks**: Created robust simulations for Cloudflare D1 and KV to enable developer-friendly, portable testing.
- **CI/CD Automation**: Integrated unit tests, type-checking, and security audits into GitHub Actions.
- **Structured Logging**: Implemented a JSON-based `Logger` utility for professional observability in production.
- **Governorance Documents**: Added `SECURITY.md` and updated `README.md` with status badges.
- **Multi-Tenant Branding**: Propagated CSS-variable based themeing across all UI components.

### Changed
- Refactored `AuthService` and `AdminService` into standalone, unit-testable classes.
- Migrated testing infrastructure from edge runtime to high-fidelity Node.js environment for improved portability on Windows/macOS.
- Standardized error handling with structured JSON responses.

### Fixed
- Resolved module resolution issues between Cloudflare types and standard Node.js types.
- Fixed logic errors in team-joining and password reset workflows via unit test verification.

---

## [0.9.0] - 2026-04-08

### Added
- Multi-tenancy support via subdomain routing.
- SQLite (D1) integration with Drizzle ORM.
- Manual tenant approval workflow.
- Responsive dashboard and inspector field form.
- Branding system with logo uploads and custom color support.
