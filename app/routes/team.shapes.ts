import { m } from "~/paraglide/messages";

/**
 * What `/team` renders, and the two shapes the API answers with.
 *
 * Split out of `team.tsx` when that file reached its 400-line ceiling. These
 * are the page's DATA definitions — one row as the table sees it, and the two
 * payload shapes the loader maps into it — so they travel together and none of
 * them needs the component to make sense.
 */

export interface Member {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: "active" | "pending";
  lastActiveAt: string | null;
  /** Present only on pending rows — the tenant_invites token to cancel/resend. */
  token: string | null;
  /** Present only on pending rows — ISO expiry for the "expires in Nd" label. */
  expiresAt: string | null;
  /**
   * Pending rows only — the absolute accept URL, as the SERVER built it.
   *
   * Not composed in the browser from `window.location.origin` + token: the
   * email is sent from the deployment's configured base URL, and where the two
   * differ (a proxy, a preview host, a custom domain) a locally-composed link
   * is the one that does not work. One invitation must have one URL.
   */
  inviteLink: string | null;
  /** Capability toggles differing from the role template; seeds the edit drawer (IA-101). */
  permissionOverrides: Record<string, boolean> | null;
  /** Whether this member has a second factor an owner could clear. */
  totpEnabled: boolean;
}

export interface LoaderActiveUser { id: string; email: string; role: string; name?: string | null; permissionOverrides?: Record<string, boolean> | null; totpEnabled?: boolean }
export interface LoaderInvite { id: string; email: string; role: string; expiresAt: string; inviteLink?: string }

export const ROLE_TONES: Record<string, "primary" | "info" | "neutral" | "warning" | "monitor" | "sat" | "gen"> = {
  owner: "primary",
  manager: "info",
  inspector: "neutral",
  lead: "info",
  specialist: "sat",
  agent: "warning",
  office: "gen",
};

/**
 * Human "expires in Nd" / "expired Nd ago" from an ISO expiry. Whole-day
 * granularity is enough for a 7-day invite window.
 *
 * Called during render rather than at module scope so the message resolves in
 * the request's locale, not whichever one was current at import.
 */
export function expiryLabel(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(Math.abs(ms) / 86_400_000);
  if (ms <= 0) return m.settings_team_invite_expired({ days });
  return m.settings_team_invite_expires_in({ days });
}
