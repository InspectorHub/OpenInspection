# Contributing to OpenInspection

Thanks for considering a contribution. OpenInspection is an open-source home inspection app built on Cloudflare Workers. We welcome bug reports, feature ideas, documentation improvements, and code contributions from anyone running their own deployment or building on top of the codebase.

## Quick links

- 🐛 [Report a bug](https://github.com/InspectorHub/OpenInspection/issues/new?template=bug_report.yml)
- 💡 [Suggest a feature](https://github.com/InspectorHub/OpenInspection/issues/new?template=feature_request.yml)
- 💬 [Ask a question](https://github.com/InspectorHub/OpenInspection/discussions/categories/q-a)
- 📣 [Roadmap & releases](https://github.com/InspectorHub/OpenInspection/discussions/categories/announcements)
- 🧪 [Start a free trial](https://inspectorhub.io/register)

## Development setup

```bash
git clone https://github.com/InspectorHub/OpenInspection.git
cd OpenInspection
npm install
npm run setup:cloudflare    # provisions D1 / R2 / KV (or use --local)
npm run dev                 # http://localhost:8788
```

Detailed setup including Cloudflare bindings and environment variables: [`docs/deploy.md`](docs/deploy.md). Architecture overview: [`docs/architecture.md`](docs/architecture.md). Extension cookbook: [`docs/extending.md`](docs/extending.md).

## Code conventions

These are summarized from `CLAUDE.md` — read that file for the canonical, exhaustive rules.

- **Language**: TypeScript with strict mode. All source code, comments, docs, commit messages, and user-facing strings in **English only**.
- **Validation**: Every API endpoint uses Zod. Schemas live in `server/lib/validations/*.schema.ts`. No manual `if (!field)` checks.
- **Auth**: HS256 JWT in HttpOnly cookie, PBKDF2 password hashing. Never use a fallback secret. Read `CLAUDE.md` § JWT & Auth Security Rules.
- **Multi-tenant**: Every D1 table includes `tenant_id`. Use `c.var.services.xxx` (DI proxy) — services auto-scope to the tenant.
- **Logging**: Server-side code uses `import { logger } from '../lib/logger'`. Browser-side `console.*` is fine.
- **CSS**: Tailwind utilities + canonical v3 tokens defined in `server/styles/input.css`. No `font-black` outside stat numbers, no `rounded-2xl`, no `tracking-tightest`. The design system reference is at `docs/superpowers/plans/2026-05-08-sprint1-design-system-reference.md`.

## Commit style

```
<type>(<scope>): <short summary>

<body explaining why, not what>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`. Scope: `core`, `infra`, `docs`, etc.

Example:

```
feat(core): item-aware quick comments ranking

Active item gets a 100-point boost; section match adds 10; rating
bucket adds 5. Avoids the case where Roof comments dominate the
panel when active item is Gutters & Downspouts.
```

## Pull requests

1. Fork → branch off `master` → make your changes
2. Run `npm run type-check && npm run lint && npm run test:unit` (all green)
3. Manual smoke for any UI change at 1440 px AND 375 px
4. Open PR using the template — describe **what + why** (not how)
5. Maintainers aim to review within 7 days

## What gets fast-tracked

- Bug fixes with regression tests
- Performance improvements with before/after benchmarks
- Accessibility fixes with reproduction case
- New seed templates (open-source license, ≥ 8 sections)
- Translation contributions to public-facing strings (welcomed once i18n lands)
- Integration scaffolds (Zapier, QuickBooks, Make.com, etc.)

## What gets pushed back

- Library swaps (Drizzle → another ORM, Hono → another framework)
- Closed-source dependencies
- Features that lock customers into a single payment or scheduling provider
- Mass file moves without prior spec discussion

## Code of Conduct

By contributing, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security disclosures

Never report a vulnerability in a public issue or discussion. Use [GitHub Security Advisories](https://github.com/InspectorHub/OpenInspection/security/advisories) — see [`SECURITY.md`](SECURITY.md) if present.

## License

Source code is licensed under [GNU Affero General Public License v3.0](LICENSE).
