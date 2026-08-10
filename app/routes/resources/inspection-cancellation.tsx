/**
 * BFF resource route for cancelling an inspection (#67).
 *
 * WHY THIS FILE EXISTS AT ALL. The fee ladder shipped complete —
 * `GET /api/inspections/:id/cancellation-quote`, `POST /api/inspections/:id/cancel`,
 * the resolver, the ledger writer, the QuickBooks credit memo — and a grep of
 * `app/` for either path came back empty. Nothing in the product could cancel
 * an inspection, so the cancellation-policy panel in Settings configured a
 * ladder that could never be climbed. This route is the front door.
 *
 * A LOADER FOR THE QUOTE, AN ACTION FOR THE CANCEL, and the split is deliberate.
 * The quote endpoint computes and writes nothing, so it stays a GET here too:
 * behind a POST intent, every change of reason would be a mutation that
 * revalidates the whole hub page, and a read would be wearing the verb this
 * codebase reserves for writes.
 *
 * A client `fetch('/api/...')` arrives UNAUTHENTICATED — the JWT is a
 * server-held cookie — so the browser talks to this route and this route relays
 * the token to the in-process API.
 *
 * ⚠️ THE FEE ACKNOWLEDGEMENT IS THE SERVER'S RULE, NOT THIS ROUTE'S. `POST
 * /cancel` answers 409 `CANCELLATION_FEE_NEEDS_CONFIRM` unless the caller echoes
 * back the exact fee the quote named, so whoever cancels has to have seen the
 * number. This route does not paper over that: a 409 comes back to the UI WITH
 * the fresh quote attached, so the figures are shown again rather than silently
 * re-submitted.
 */
import type { Route } from "./+types/inspection-cancellation";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";
import {
    CANCELLATION_REASONS,
    type CancellationReason,
} from "../../../server/lib/cancellation-reason";

/**
 * The flattened quote the API returns, mirrored for the client.
 *
 * Hand-written rather than inferred because the API's `CancellationQuoteSchema`
 * is a Zod object built inside the route module, and pulling a value import of
 * that module into the browser bundle to describe nine numbers is a bad trade.
 * Every field below is named in `server/api/inspections/cancellation.ts`; the
 * spec beside this file pins the mapping so a rename there cannot go unnoticed.
 */
export interface CancellationQuoteView {
    /** Kept by the company. Never exceeds what was collected. */
    feeCents: number;
    /** Returned to the payer. */
    refundCents: number;
    /** Machine code for WHY, e.g. `late_cancellation`. Rendered in the reader's language. */
    reason: string;
    /** The ladder asked for more than was collected and the charge was reduced. */
    cappedAtCollected: boolean;
    priceCents: number;
    paidCents: number;
    currency: string;
    /** What the card processor keeps on the refund. Not recoverable. */
    retainedProcessingFeeCents: number;
    /** False when the workspace configured no ladder; nothing is ever charged. */
    policyConfigured: boolean;
}

export type CancellationQuoteResult =
    | { ok: true; quote: CancellationQuoteView }
    | { ok: false; error: string };

/**
 * The 409 re-confirm path deliberately carries NO quote back.
 *
 * The API attaches its freshly computed one, and passing it through would give
 * the panel a second source for the figure it displays — one that goes stale the
 * moment the reason is changed underneath it. The caller re-asks the loader
 * instead (React Router revalidates it after the mutation on its own), so what
 * is on screen always answers the question currently being asked.
 */
export type CancelInspectionResult = { ok: true } | { ok: false; error: string };

/** Narrow an untrusted form/query value to the enum the API's Zod schema accepts. */
function isCancellationReason(value: unknown): value is CancellationReason {
    return typeof value === "string" && (CANCELLATION_REASONS as readonly string[]).includes(value);
}

/** Pull the API's own refusal text out of an error envelope, if it sent one. */
async function apiErrorMessage(
    res: { json: () => Promise<unknown> },
    fallback: string,
): Promise<string> {
    try {
        const body = (await res.json()) as { error?: { message?: string } };
        const message = body?.error?.message;
        return typeof message === "string" && message.trim() ? message : fallback;
    } catch {
        return fallback;
    }
}

/**
 * GET /resources/inspection-cancellation?id=<inspectionId>&reason=<reason>
 *
 * Read-only. Prices the cancellation the caller is contemplating; nothing is
 * cancelled and no money moves.
 */
export async function loader({ request, context }: Route.LoaderArgs): Promise<CancellationQuoteResult> {
    const failed = m.inspections_hub_cancel_quote_failed();
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    const reason = url.searchParams.get("reason");

    const token = await getToken(context, request);
    // No session, no id, or a reason the API's enum would reject: answer with
    // the failure the UI already renders rather than letting the API 401/400.
    // The confirm button is gated on a quote, so failing here is fail-closed.
    if (!token || !id || !isCancellationReason(reason)) return { ok: false, error: failed };

    const api = createApi(context, { token });
    try {
        const res = await api.inspections[":id"]["cancellation-quote"].$get(
            { param: { id }, query: { reason } },
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { ok: false, error: await apiErrorMessage(res, failed) };
        const body = (await res.json()) as { data?: CancellationQuoteView };
        const quote = body.data;
        // A missing payload is not "a free cancellation" — treating it as one
        // would let the UI offer a confirm button over figures it never got.
        if (!quote || typeof quote.feeCents !== "number") return { ok: false, error: failed };
        return { ok: true, quote };
    } catch {
        return { ok: false, error: failed };
    }
}

/**
 * POST /resources/inspection-cancellation
 *
 * Fields: `id`, `reason`, optional `notes`, and `acknowledgedFeeCents` — the
 * figure the caller was shown. Sent on every submit, including zero, so the
 * server compares against something the human actually read.
 */
export async function action({ request, context }: Route.ActionArgs): Promise<CancelInspectionResult> {
    const failed = m.inspections_hub_cancel_failed();
    const token = await getToken(context, request);
    if (!token) return { ok: false, error: failed };

    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    const reason = form.get("reason");
    if (!id || !isCancellationReason(reason)) return { ok: false, error: failed };

    const notes = String(form.get("notes") ?? "").trim();
    // ⚠️ The ABSENT case is checked before the numeric one, and it is the whole
    // reason this block exists: `Number(null)` is 0, so a submit that carried no
    // acknowledgement at all would have been forwarded as "the caller was shown
    // a fee of zero" — a claim about what a human read, invented out of a
    // missing field. Refuse instead; the UI always sends the figure it rendered.
    const rawAcknowledged = form.get("acknowledgedFeeCents");
    if (typeof rawAcknowledged !== "string" || rawAcknowledged.trim() === "") {
        return { ok: false, error: failed };
    }
    const acknowledged = Number(rawAcknowledged);
    if (!Number.isInteger(acknowledged) || acknowledged < 0) return { ok: false, error: failed };

    const api = createApi(context, { token });
    try {
        const res = await api.inspections[":id"].cancel.$post(
            {
                param: { id },
                json: {
                    reason,
                    acknowledgedFeeCents: acknowledged,
                    ...(notes ? { notes } : {}),
                },
            },
            { headers: { "x-token-relay": "1" } },
        );

        // CANCELLATION_FEE_NEEDS_CONFIRM. The priced outcome moved between the
        // quote and the confirm — the notice window is measured against the
        // clock, so it can cross a rung while a dialog is open. This is its own
        // message, not the generic failure: nothing went wrong, the figures
        // changed, and "read them again" is a different instruction from "try
        // again". The caller re-prices; see CancelInspectionResult for why the
        // API's attached quote is not forwarded.
        if (res.status === 409) return { ok: false, error: m.inspections_hub_cancel_stale() };
        if (!res.ok) return { ok: false, error: await apiErrorMessage(res, failed) };
        return { ok: true };
    } catch {
        return { ok: false, error: failed };
    }
}
