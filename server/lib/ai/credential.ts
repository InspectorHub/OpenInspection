/**
 * What an AI adapter is given to authenticate with.
 *
 * It used to be a `string`, and for most backends it still is: an API key that
 * does not expire, spent once per request, resolved when the provider is
 * constructed. That shape is unchanged and remains the whole of the
 * bring-your-own-key path.
 *
 * Some backends do not issue such a key at all. They authenticate with an
 * OAuth ACCESS TOKEN whose life is measured in minutes, so the value that is
 * correct when a provider is built is wrong before the provider is collected.
 * A credential resolved at construction would begin returning 401 partway
 * through an hour, and the adapter maps 401 to a sentence telling the customer
 * to check their own key — which, for a deployment-owned credential, blames
 * the one person who cannot fix it.
 *
 * So a credential may instead be something that PRODUCES a token on demand.
 * The adapter asks it once per call. Where the answer is cached, for how long,
 * and what happens when two callers race is the implementation's business, not
 * the adapter's; all the adapter promises is that it will not remember the
 * answer.
 */

/** A credential that mints or refreshes its own short-lived token. */
export interface AiAccessTokenSource {
    /**
     * The id recorded as the backend that served the call.
     *
     * Declared by the credential rather than derived from configuration, and
     * that is deliberate. The derivation reads a vendor prefix off the model
     * id, which is right for a gateway that multiplexes many vendors onto one
     * host — but it makes the recorded backend a function of how a model id is
     * SPELLED, so re-spelling one would relabel every row written afterwards.
     * A credential knows what it is; a model string only hints.
     */
    readonly providerId: string;

    /**
     * A token that is valid now.
     *
     * Throws when one cannot be obtained. That is a deployment-configuration
     * failure, never a statement about a workspace's own credentials, and the
     * adapter is required to keep those two apart.
     */
    getAccessToken(): Promise<string>;
}

/** Either an API key that does not expire, or something that refreshes itself. */
export type AiCredential = string | AiAccessTokenSource;

/** Whether a credential refreshes itself. A plain key does not. */
export function isAccessTokenSource(cred: AiCredential): cred is AiAccessTokenSource {
    return typeof cred === 'object' && cred !== null && typeof cred.getAccessToken === 'function';
}
