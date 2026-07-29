// `mintToken` and `INVITE_TTL_DAYS` lived here to issue the 7-day agent-invite
// tokens. That track is gone — an agent reads a report through a per-inspection
// access token that needs no account, so an invitation gated nothing — and the
// helpers went with it rather than sitting here waiting to be re-adopted.
export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}
