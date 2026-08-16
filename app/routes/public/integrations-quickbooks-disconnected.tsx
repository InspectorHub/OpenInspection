import { m } from "~/paraglide/messages";

/**
 * Intuit's Disconnect URL, registered in the app's settings on their developer
 * portal. QuickBooks sends a user here after they disconnect our app from
 * their side (QuickBooks -> Apps -> My Apps).
 *
 * PUBLIC and STATELESS, and both by requirement rather than by preference:
 * that redirect is a cross-site navigation, so `__Host-inspector_token` is
 * withheld and there is no session to read. Anyone on the internet can load
 * this URL. It therefore resolves no tenant, reads nothing, and writes nothing
 * — a page that cleaned up a connection here would be an unauthenticated
 * endpoint for destroying one.
 *
 * The connection row is retired instead by the refresh path, which is where we
 * actually learn the grant is gone: Intuit answers a token refresh with
 * `invalid_grant`, and that handler files the flag the settings page reads.
 */
export function meta() {
  return [{ title: m.qbo_disconnected_meta_title() }];
}

export default function QuickBooksDisconnected() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-[20px] font-bold text-ih-fg-1 mb-3">
        {m.qbo_disconnected_heading()}
      </h1>
      <p className="text-[14px] text-ih-fg-2 mb-8">{m.qbo_disconnected_body()}</p>

      <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-3">
        {m.qbo_disconnected_steps_heading()}
      </h2>
      <ol className="text-[13px] text-ih-fg-2 space-y-2 mb-8 list-decimal list-inside">
        <li>{m.qbo_disconnected_step_signin()}</li>
        <li>{m.qbo_disconnected_step_settings()}</li>
        <li>{m.qbo_disconnected_step_connect()}</li>
      </ol>

      <a
        href="/settings/integrations/qbo"
        className="inline-flex h-9 items-center px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
      >
        {m.qbo_disconnected_cta()}
      </a>
    </main>
  );
}
