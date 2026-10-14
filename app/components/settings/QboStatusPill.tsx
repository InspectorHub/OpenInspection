import { Pill } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/** A refresh token this close to its end (or past it) needs a new authorisation. */
const QBO_RECONNECT_WINDOW_SEC = 30 * 24 * 3600;

export type QboConnectionState = "active" | "paused" | "attention" | "reconnect";

/** True once the connection must be re-authorised: inside the window, or already expired. */
export function qboNeedsReconnect(refreshTokenExpiresAt: number, nowSeconds: number): boolean {
  return refreshTokenExpiresAt > 0 && refreshTokenExpiresAt < nowSeconds + QBO_RECONNECT_WINDOW_SEC;
}

/**
 * The one word that answers "is it working?".
 *
 * Four states, exactly one at a time, in the order a person would have to act
 * on them: a connection that must be re-authorised outranks everything (nothing
 * else works until it is), then items that need a decision, then a paused sync,
 * and only then "Active".
 */
export function qboConnectionState(input: {
  refreshTokenExpiresAt: number;
  openErrorCount: number;
  syncEnabled: boolean;
  nowSeconds: number;
}): QboConnectionState {
  if (qboNeedsReconnect(input.refreshTokenExpiresAt, input.nowSeconds)) return "reconnect";
  if (input.openErrorCount > 0) return "attention";
  if (!input.syncEnabled) return "paused";
  return "active";
}

export function QboStatusPill({ state }: { state: QboConnectionState }) {
  const tone = { active: "sat", paused: "neutral", attention: "monitor", reconnect: "defect" } as const;
  const label = {
    active: m.settings_qbo_status_active(),
    paused: m.settings_qbo_status_paused(),
    attention: m.settings_qbo_status_needs_attention(),
    reconnect: m.settings_qbo_status_reconnect(),
  }[state];
  return (
    <Pill tone={tone[state]} dot className="text-[12px] font-bold" >
      <span data-testid="qbo-status-pill">{label}</span>
    </Pill>
  );
}
