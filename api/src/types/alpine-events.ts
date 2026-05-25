/**
 * Helper to pass Alpine.js @event directives via JSX spread (avoids parser error
 * since @ is not a valid JSX attribute name character).
 *
 * Usage: <button {...alpineEvents({ click: "handler()" })}>
 */
export function alpineEvents(events: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(events).map(([k, v]) => [`@${k}`, v])
    );
}
