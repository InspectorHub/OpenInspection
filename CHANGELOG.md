# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
