# Web application instructions

Read the root [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md)
before changing routes, loaders, actions, components or client behavior.

- Prefer React Router loaders and actions with the typed API client. Server-side
  calls can use the in-process `API_WORKER`; browser `fetch` calls go through the
  outer Worker as HTTP requests.
- Keep session tokens HttpOnly. Do not copy tokens into browser state or logs.
- Use the shared design tokens and components. Read
  [`docs/develop/design-system.md`](../docs/develop/design-system.md) before
  changing the design system.
- Co-locate web tests beside their component or route as `*.test.tsx`.
- Guard writes against same-frame duplicate submits with the established latch
  hooks. A pending state alone does not prevent two events in one frame.
- Test both themes and responsive widths for visible UI changes.
