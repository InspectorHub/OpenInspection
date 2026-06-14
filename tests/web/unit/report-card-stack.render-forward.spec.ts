// tests/web/unit/report-card-stack.render-forward.spec.ts
//
// Regression test for: report-view loader didn't forward the `render` token.
//
// Bug: the page loader in app/routes/public/report-card-stack.tsx was only
// forwarding ?token= but not ?render=, so headless PDF rendering received
// "Report not found" (the data route /api/public/report/:tenant/:id uses the
// render token to authenticate without a session cookie).
//
// Fix: the loader now reads:
//   const render = new URL(request.url).searchParams.get("render") ?? undefined;
// and passes  query: { token, render }  to the $get call.
//
// Strategy: raw-source inspection — same harness as report-card-stack.buttons.spec.ts.
// Reverting the fix (removing `render` from the query object) makes both
// assertions below fail.

import { describe, it, expect } from 'vitest';

describe('report-card-stack loader: render token forwarding (regression)', () => {
    it('loads the module source', async () => {
        const src = await import('~/routes/public/report-card-stack?raw');
        const text = (src as unknown as { default: string }).default;
        expect(text.length).toBeGreaterThan(0);
    });

    it('loader reads the render search param from the request URL', async () => {
        const src = await import('~/routes/public/report-card-stack?raw');
        const text = (src as unknown as { default: string }).default;

        // The loader must call searchParams.get("render") to extract the
        // server-minted headless render token from the incoming URL.
        // If this line is absent the render token is never captured and
        // the headless browser never authenticates with the data route.
        expect(text).toContain('searchParams.get("render")');
    });

    it('loader passes render inside the $get query object', async () => {
        const src = await import('~/routes/public/report-card-stack?raw');
        const text = (src as unknown as { default: string }).default;

        // The $get call must forward the render variable inside the query
        // argument: query: { token, render }.  Without this the data route
        // receives no render param and treats the request as unauthenticated,
        // returning "Report not found" to the headless PDF browser.
        //
        // We locate the $get({ ... }) call and assert that render appears
        // inside it, i.e. the source contains the pattern:
        //   query: { token, render }
        // (or any superset — the key requirement is `render` is in the query).
        //
        // A revert that drops render from the query object fails this assertion.
        expect(text).toMatch(/query\s*:\s*\{[^}]*\brender\b[^}]*\}/);
    });

    it('render variable is declared before the $get call', async () => {
        const src = await import('~/routes/public/report-card-stack?raw');
        const text = (src as unknown as { default: string }).default;

        // Ensure the const declaration for render exists in the loader body.
        // A revert that removes the whole render capture fails here.
        expect(text).toMatch(/\bconst\s+render\b/);
    });
});
