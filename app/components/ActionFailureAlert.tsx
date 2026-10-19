import type { ReactNode } from "react";
import { Banner } from "@core/shared-ui";

/** The part of an action's answer this reads: every write action returns `{ ok, intent }`. */
export interface ActionResultLike {
    ok?: boolean;
    intent?: string | undefined;
}

/**
 * A visible failure for a write whose action answered `{ ok: false }`.
 *
 * Pages that delete through a fetcher used to read nothing back: a refused
 * delete left the row in place and said nothing, so it looked like a dead
 * button. Pass the fetcher's `data` and the intents it should speak for; it
 * renders nothing for a success, for another intent, or before any answer.
 * The answer lasts until the fetcher's next submission replaces it.
 */
export function ActionFailureAlert({ result, intents, busy = false, children }: {
    result: ActionResultLike | undefined | null;
    intents: readonly string[];
    /** The next attempt has started: the old failure is stale and is not shown. */
    busy?: boolean;
    children: ReactNode;
}) {
    if (busy || !result || result.ok !== false || !result.intent || !intents.includes(result.intent)) return null;
    return <Banner tone="danger">{children}</Banner>;
}
