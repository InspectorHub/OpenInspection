/**
 * The first line of an error's message, cut short. A driver error can carry the values bound to the failed statement on later lines
 * (a signer's email, the address and browser they signed from), so only this line is ever logged, never the error object or its stack.
 */
export function errorSummary(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return (message.split('\n')[0] ?? '').slice(0, 200);
}
