/**
 * Why an inspection was cancelled — the single source for the drizzle enum on
 * `inspections.cancel_reason`, the wire schema, and the classification the
 * cancellation ladder needs.
 *
 * The ladder is driven by two axes: WHO ended the appointment and WHAT
 * happened. Those are not the same question — "the client no-showed" names an
 * event with a client on one side and no cancellation at all — and the reason
 * the operator already picks encodes both. So nothing new is persisted: the
 * axes are DERIVED from `cancel_reason`, which is written by the existing
 * cancel path and is the only durable record of the decision.
 *
 * Every ambiguous reason maps to `inspector`, which charges nothing. That
 * direction is deliberate: a fee the agreement may not support is the one
 * mistake this feature must not make, so an unclassifiable cancellation costs
 * the client nothing rather than defaulting to a charge.
 */
import type { CancellationEvent, CancellationInitiator } from './billing/cancellation-outcome';

export const CANCELLATION_REASONS = [
    'client_cancelled',
    'no_show',
    'weather',
    'inspector_unavailable',
    'property_unavailable',
    'rescheduled',
    'other',
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

interface Classification {
    initiator: CancellationInitiator;
    event: CancellationEvent;
}

const CLASSIFICATION: Record<CancellationReason, Classification> = {
    // The client called it off. The notice window decides what it costs.
    client_cancelled:      { initiator: 'client',    event: 'cancellation' },
    // Nobody called it off; the client did not turn up. The notice window is
    // irrelevant, which is exactly why event is a separate axis.
    no_show:               { initiator: 'client',    event: 'no_show' },
    // A storm is not the client's doing. The company made the call, so the
    // company's own always-full-refund rule applies.
    weather:               { initiator: 'inspector', event: 'cancellation' },
    inspector_unavailable: { initiator: 'inspector', event: 'cancellation' },
    // Access was not provided — the client's side of the appointment failed.
    // Distinct from a no-show only in that the client may well have been there.
    property_unavailable:  { initiator: 'client',    event: 'cancellation' },
    // Not really a cancellation: the money follows the job to its new date.
    // Charging a late fee for moving an appointment is not a published policy
    // anyone has, so this never charges.
    rescheduled:           { initiator: 'inspector', event: 'cancellation' },
    // Unclassifiable. Charges nothing, on purpose.
    other:                 { initiator: 'inspector', event: 'cancellation' },
};

export function classifyCancellationReason(reason: string): Classification {
    return CLASSIFICATION[reason as CancellationReason] ?? CLASSIFICATION.other;
}
