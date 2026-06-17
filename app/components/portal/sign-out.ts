/**
 * Client portal sign-out helper.
 *
 * Clears the `__Host-portal_session` cookie via the logout endpoint, then sends
 * the browser back to the tenant login form. SSR-safe: `window` is touched only
 * inside this function, which is invoked from click handlers (never at render).
 * The logout endpoint is idempotent, so we redirect to the login form regardless
 * of the response (a failed fetch still leaves the client on the login page).
 */
export async function signOut(tenant: string): Promise<void> {
  try {
    await fetch(`/api/portal/${tenant}/logout`, { method: "POST" });
  } catch {
    // Idempotent: redirect to the login form regardless of fetch outcome.
  }
  window.location.href = `/portal/${tenant}`;
}
