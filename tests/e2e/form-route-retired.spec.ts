import { test, expect } from "@playwright/test";

// Module B — the orphan /inspections/:id/form surface was retired. It must no
// longer resolve to a route (React Router returns 404 for an unmatched path).
// Before deletion the route existed (auth-redirect / render); after deletion it
// 404s. This guards against accidental reintroduction of the parallel surface.
test("GET /inspections/:id/form no longer resolves (404)", async ({ request }) => {
  const res = await request.get("/inspections/any-id/form");
  expect(res.status()).toBe(404);
});
