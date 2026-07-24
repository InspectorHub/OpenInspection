import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.portal_observe_meta_title() }];
}

// The standalone token-gated live-progress page has been retired. The same
// per-section progress now lives inside the client portal (the Hub's "progress"
// section), so this surface is a second entry to one capability — and the only
// entry no email or in-app action ever linked. It is not redirected into the
// portal because the observer-link token is a separate credential system from
// the portal's magic-link session (it cannot authenticate a visitor into a
// specific portal inspection), so a redirect would land on a login wall. The
// observer-link service, schema, and token/claim machinery are kept intact for
// reuse when the portal's own credential lifecycle is built out. This page just
// tells anyone holding an old link where progress now lives.
export default function ObserveRetiredPage() {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="rounded-lg border border-ih-border bg-ih-bg-card p-8 text-center">
        <h1 className="text-lg font-semibold text-ih-fg-1">
          {m.portal_observe_retired_title()}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ih-fg-2">
          {m.portal_observe_retired_body()}
        </p>
      </div>
    </div>
  );
}
