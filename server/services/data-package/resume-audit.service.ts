/**
 * §9B.4 — resume device-label change audit.
 *
 * Resume is a deliberately accepted trade-off: a still-valid (or stolen)
 * bearer can reclaim an authorized job within 14 days without step-up. The
 * mitigation is accountability, not prevention — when the reclaiming device
 * differs from the recorded lease holder we write an audit row. No email is
 * sent (per the owner decision).
 */
import type { Context } from 'hono';
import { auditFromContextAwaited } from '../../lib/audit';
import type { HonoConfig } from '../../types/hono';

export interface ResumeDeviceChange {
    jobId: string;
    previousDeviceLabel: string;
    deviceLabel: string;
}

/** Resolve the caller's device label from the optional header, falling back to the lease holder. */
export function resumeDeviceLabel(headerValue: string | undefined, leaseHolder: string | null): string {
    const label = headerValue?.trim().slice(0, 128);
    return label || leaseHolder || 'resumed';
}

/** Write the audit only when the label actually changed. Awaited so it is durable. */
export async function auditResumeDeviceChange(
    c: Context<HonoConfig>,
    change: ResumeDeviceChange | null,
): Promise<void> {
    if (!change) return;
    await auditFromContextAwaited(c, 'data.export', 'bulk_export', {
        metadata: {
            phase: 'resume_device_change',
            jobId: change.jobId,
            previousDeviceLabel: change.previousDeviceLabel,
            deviceLabel: change.deviceLabel,
        },
    });
}
