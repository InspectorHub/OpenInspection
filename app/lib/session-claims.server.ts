/**
 * The company a session token belongs to.
 *
 * Reads `custom:tenantId` from the payload WITHOUT verifying the signature. That
 * is only safe after something else has proven the token: callers use it right
 * after `requireAdminLoader`, whose session-context API call makes the API verify
 * the bearer. It is a display and comparison value (does this file belong to my
 * company?), never an authorisation decision: the import endpoint takes the
 * tenant from the verified token on every request.
 */
export function tenantIdFromSessionToken(token: string): string | null {
    try {
        const part = token.split(".")[1];
        if (!part) return null;
        let b64 = part.replace(/-/g, "+").replace(/_/g, "/");
        b64 += "=".repeat((4 - (b64.length % 4)) % 4);
        const payload = JSON.parse(atob(b64)) as Record<string, unknown>;
        const tenantId = payload["custom:tenantId"] ?? payload["tenantId"];
        return typeof tenantId === "string" && tenantId !== "" ? tenantId : null;
    } catch {
        return null;
    }
}
