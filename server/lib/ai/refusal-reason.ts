/**
 * WHY A CALL CANNOT RUN — one closed vocabulary, seven answers.
 *
 * `resolveAi` already returned `null` for four distinct situations and every
 * one of them reached the inspector as the same sentence. Several are
 * actionable by DIFFERENT PEOPLE, and one of them — a platform key that was
 * never provisioned — is actionable by nobody the workspace can reach. Telling
 * that workspace to check their settings wastes their time and ours.
 *
 * The HTTP shape does NOT change: everything here still travels as
 * `AppError(503, ErrorCode.AI_NOT_CONFIGURED)`. `errors.ts` keeps one shape for
 * "this call cannot run" on purpose, and a second status code would undo that.
 * The reason rides in `details` and chooses the MESSAGE, not the channel.
 *
 * The union is closed. An eighth situation is added here first, which breaks
 * every exhaustive switch that renders a message — that break is the point.
 */
export const AI_REFUSAL_REASONS = [
    /** The workspace turned AI off in Settings. Their configuration is intact. */
    'switched_off',
    /** No key has been saved for this workspace. */
    'not_configured',
    /** This deployment offers no managed path, or the workspace is not granted
     *  one. Nothing the workspace can change in Settings. */
    'unavailable_here',
    /** The managed allowance for this period is spent. */
    'over_cap',
    /** THE OPERATOR'S misconfiguration: an entitled workspace on a deployment
     *  whose platform key was never provisioned. Never instruct the workspace
     *  to fix this — there is no setting of theirs that would.
     *
     *  ALSO covers a platform credential that EXISTS but cannot be used: one
     *  that will not parse, and one that refreshes itself and failed to. The
     *  member was not split, because the property that matters is the one it
     *  already carries — nobody the workspace can reach fixes any of them, and
     *  every renderer already treats it that way. A more precise member would
     *  say something more precise to nobody, while breaking every exhaustive
     *  switch for no reader's benefit. The distinction that IS worth keeping
     *  lives in the log, where the operator reads. */
    'platform_key_missing',
    /** The workspace has not accepted the current privacy version, so the
     *  processing this capability performs is not yet authorised for them. */
    'policy_not_accepted',
    /** The provider rejected the credentials, or refused on account or rate
     *  grounds (401/402/403/429). On a workspace's own key this is their own
     *  provider account and only they can fix it, which is exactly why it must
     *  not degrade into "no suggestions". */
    'upstream_credential',
] as const;

export type AiRefusalReason = typeof AI_REFUSAL_REASONS[number];

/**
 * The same members under names a call site can read.
 *
 * `satisfies Record<string, AiRefusalReason>` is the half that a type can
 * check: it stops a typo becoming a new reason. It does NOT check that every
 * member of the tuple has a constant here — nothing in the type system does —
 * so the spec asserts the two collections against each other instead.
 */
export const AI_REFUSAL_REASON = {
    SWITCHED_OFF:         'switched_off',
    NOT_CONFIGURED:       'not_configured',
    UNAVAILABLE_HERE:     'unavailable_here',
    OVER_CAP:             'over_cap',
    PLATFORM_KEY_MISSING: 'platform_key_missing',
    POLICY_NOT_ACCEPTED:  'policy_not_accepted',
    UPSTREAM_CREDENTIAL:  'upstream_credential',
} as const satisfies Record<string, AiRefusalReason>;

/** Narrow an unknown value — a value read back out of `details`, or off the
 *  wire — to a member of the vocabulary. Whole-value comparison, so a
 *  near-miss is a miss. */
export function isAiRefusalReason(value: unknown): value is AiRefusalReason {
    return typeof value === 'string'
        && (AI_REFUSAL_REASONS as readonly string[]).includes(value);
}
