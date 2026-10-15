import { Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { formatDate } from "~/lib/format";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { QboBooksHealth } from "~/components/settings/QboBooksHealth";
import { useQboContactMatch } from "~/components/settings/useQboContactMatch";
import { QboCopyButton } from "~/components/settings/QboCopyButton";
import { QboEnvironmentBadge } from "~/components/settings/QboEnvironmentBadge";
import { QboSyncStatus } from "~/components/settings/QboSyncStatus";
import { QboStatusPill, qboConnectionState, qboNeedsReconnect } from "~/components/settings/QboStatusPill";
import type { QBOConnectionStatus } from "../../../server/services/qbo/api-base";

/**
 * Everything the page shows once a QuickBooks company is connected: the
 * connection card (who, which environment, whether it is working, when it
 * stops being valid), the sync controls, and below it the items that need
 * attention and the contact matching summary.
 *
 * It takes callbacks rather than a fetcher: whether an action is permitted and
 * what it submits are the route's business, and a component that submitted on
 * its own would be a second place to keep those decisions right.
 */
export function QboConnectionPanel({
  status,
  busy,
  syncing,
  dismissingId,
  onSync,
  onToggleAuto,
  onRequestDisconnect,
  onDismissError,
}: {
  status: QBOConnectionStatus;
  /** Any QBO action is in flight -- every control disables together. */
  busy: boolean;
  /** The in-flight action is specifically the sync, which gets its own label. */
  syncing: boolean;
  dismissingId: string | null;
  onSync: () => void;
  onToggleAuto: () => void;
  /** Opens the confirmation. Disconnecting is not a one-click action. */
  onRequestDisconnect: () => void;
  onDismissError: (id: string) => void;
}) {
  const locale = useDisplayLocale();
  const match = useQboContactMatch();
  const timeZone = useDisplayTimeZone();
  const now = Math.floor(Date.now() / 1000);
  const openErrors = status.openErrors ?? [];
  const reconnect = qboNeedsReconnect(status.refreshTokenExpiresAt, now);
  const expired = status.refreshTokenExpiresAt > 0 && status.refreshTokenExpiresAt < now;
  const state = qboConnectionState({
    refreshTokenExpiresAt: status.refreshTokenExpiresAt,
    openErrorCount: openErrors.length,
    syncEnabled: status.syncEnabled,
    nowSeconds: now,
  });
  const day = (seconds: number) => formatDate(seconds * 1000, { locale, timeZone });

  return (
    <div className="space-y-4">
      <section className="bg-ih-bg-card border border-ih-border rounded-ih-card p-6 space-y-5" aria-labelledby="qbo-conn-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2CA01C]/10" aria-hidden="true">
              <span className="text-[14px] font-extrabold text-[#2CA01C]">QB</span>
            </div>
            <h2 id="qbo-conn-heading" className="min-w-0 break-words text-[20px] font-bold text-ih-fg-1">
              {status.companyName ?? m.settings_qbo_connected_fallback()}
            </h2>
            <QboEnvironmentBadge environment={status.environment} />
          </div>
          <QboStatusPill state={state} />
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ih-fg-3">
          <span className="inline-flex items-center gap-1">
            {m.settings_qbo_meta_realm()}{" "}
            <b className="font-mono font-medium text-ih-fg-1">{status.realmId}</b>
            <QboCopyButton value={status.realmId} label={m.settings_qbo_copy_realm_label()} />
          </span>
          <span>
            {m.settings_qbo_meta_connected()} <b className="text-ih-fg-1">{day(status.connectedAt)}</b>
          </span>
          <span>
            {m.settings_qbo_meta_valid_until()} <b className="text-ih-fg-1">{day(status.refreshTokenExpiresAt)}</b>
          </span>
        </div>

        {reconnect && (
          <div className="flex items-start gap-3 rounded-ih-card border border-ih-watch bg-ih-watch-bg p-4 text-[13px] text-ih-watch-fg">
            <svg className="mt-0.5 h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              {expired ? m.settings_qbo_expired_warning() : m.settings_qbo_expiry_warning()}{" "}
              {/* /api/*, not a child of this page's path: only API-prefixed paths
                  reach the Hono app (workers/app.ts allow-list). A link under
                  /settings/** lands on React Router, which has no such route. */}
              <a href="/api/integrations/qbo/connect" className="font-semibold underline">
                {expired ? m.settings_qbo_reconnect_now() : m.settings_qbo_reconnect_link()}
              </a>
            </span>
          </div>
        )}

        <hr className="border-ih-border" />

        <QboSyncStatus
          lastSyncAt={status.lastSyncAt}
          openErrorCount={openErrors.length}
          syncEnabled={status.syncEnabled}
          syncing={syncing}
          busy={busy}
          mappedCustomers={status.mappedCustomers}
          mappedInvoices={status.mappedInvoices}
          onSync={onSync}
          onToggleAuto={onToggleAuto}
        />

        <hr className="border-ih-border" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[56ch] text-xs text-ih-fg-3">{m.settings_qbo_disconnect_note()}</p>
          {/* Quiet on purpose: ending the connection is rare and not the page's job. */}
          <Button variant="danger-link" size="sm" pending={busy} onClick={onRequestDisconnect}>
            {m.settings_qbo_disconnect()}
          </Button>
        </div>
      </section>

      {/* Failed pushes, disagreements and what is never sent -- see
          QboBooksHealth for why a discrepancy shows both figures. */}
      <QboBooksHealth
        openErrors={openErrors}
        discrepancies={status.paymentDiscrepancies ?? []}
        heldDepositCount={status.heldDepositCount ?? 0}
        onDismissError={onDismissError}
        dismissingId={dismissingId}
        onMatchContact={match.open}
      />
      {match.dialog}

      <section className="bg-ih-bg-card border border-ih-border rounded-ih-card p-6" aria-labelledby="qbo-matching-heading">
        <h2 id="qbo-matching-heading" className="text-[15px] font-bold text-ih-fg-1">
          {m.settings_qbo_matching_heading()}
        </h2>
        <p className="mt-1.5 max-w-[64ch] text-[13px] text-ih-fg-3">{m.settings_qbo_matching_desc()}</p>
        <div className="mt-4 inline-flex min-w-[200px] flex-col gap-0.5 rounded-lg border border-ih-border px-4 py-3.5">
          <span className="text-[24px] font-bold leading-tight tracking-tight text-ih-fg-1">{status.mappedCustomers}</span>
          <span className="text-xs text-ih-fg-3">{m.settings_qbo_matching_count()}</span>
        </div>
      </section>
    </div>
  );
}
