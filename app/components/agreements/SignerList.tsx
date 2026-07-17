import { useState } from "react";
import { Pill } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * Track I-a Task 9 — shared multi-signer list for an agreement envelope.
 *
 * Self-contained: takes a signers array + per-signer action callbacks; it has
 * NO route coupling so the #111 inspection-hub session can mount it later. The
 * admin Signing tab wires the callbacks to BFF loaders/fetchers (no client
 * fetch('/api/...')). DS tokens only; admin surface so it inherits light/dark
 * via data-color-scheme (no hardcoded colors).
 */

export type SignerStatus = "pending" | "sent" | "viewed" | "signed" | "declined" | "expired";

export interface SignerRow {
    id: string;
    name: string;
    email: string;
    role: "client" | "co_client" | "agent" | "other" | string;
    status: SignerStatus | string;
    channel?: "remote" | "in_person" | null;
    signedAt?: number | null;
    onBehalfOf?: string | null;
    /** Epoch ms of the last reminder; drives the rate-limit affordance. */
    lastRemindedAt?: number | null;
}

const TERMINAL: ReadonlySet<string> = new Set(["signed", "declined", "expired"]);

/** A signer in a terminal state can no longer be reminded or re-signed. */
export function isTerminal(status: string): boolean {
    return TERMINAL.has(status);
}

type ChipTone = "sat" | "monitor" | "defect" | "info" | "neutral";

/** Status → (tone, label) for the per-signer status chip. */
export function statusChip(status: string): { tone: ChipTone; label: string } {
    switch (status) {
        case "signed":   return { tone: "sat", label: "Signed" };
        case "viewed":   return { tone: "info", label: "Viewed" };
        case "sent":     return { tone: "monitor", label: "Sent" };
        case "declined": return { tone: "defect", label: "Declined" };
        case "expired":  return { tone: "neutral", label: "Expired" };
        case "pending":  return { tone: "neutral", label: "Pending" };
        default:         return { tone: "neutral", label: status.charAt(0).toUpperCase() + status.slice(1) };
    }
}

const ROLE_LABELS: Record<string, string> = {
    client: "Client",
    co_client: "Co-client",
    agent: "Agent",
    other: "Other",
};
export function roleLabel(role: string): string {
    return ROLE_LABELS[role] ?? role;
}

/**
 * Pure remind-eligibility check. A signer can be reminded when it is
 * non-terminal AND its last reminder is older than one hour. Returns a friendly
 * reason when it cannot (surfaced as a tooltip — never a native alert).
 */
export function remindState(
    signer: Pick<SignerRow, "status" | "lastRemindedAt">,
    nowMs: number,
): { canRemind: boolean; reason: string | null } {
    if (isTerminal(signer.status)) {
        return { canRemind: false, reason: m.agreement_signers_remind_terminal() };
    }
    if (signer.lastRemindedAt && nowMs - signer.lastRemindedAt < 3600_000) {
        return { canRemind: false, reason: m.agreement_signers_remind_ratelimited() };
    }
    return { canRemind: true, reason: null };
}

export interface SignerListProps {
    signers: SignerRow[];
    /**
     * Re-send a reminder to one signer.
     *
     * Contract: if the callback returns a rejected Promise, `SignerList` catches
     * it and surfaces the error as a per-row inline message (no native alert).
     * Void-returning (fire-and-forget) callbacks — e.g. a fetcher submit that
     * never rejects — MUST surface errors themselves; the agreements route uses
     * its own banner for that wiring.
     */
    onRemind?: (signerId: string) => Promise<void> | void;
    /** Resolve a signer's persistent public link for clipboard copy. */
    onCopyLink?: (signerId: string) => Promise<string>;
    /** Disable all actions (e.g. an in-flight envelope-level mutation). */
    busy?: boolean;
    /** Injected for deterministic tests; defaults to Date.now(). */
    nowMs?: number;
}

export function SignerList({ signers, onRemind, onCopyLink, busy, nowMs }: SignerListProps) {
    const now = nowMs ?? Date.now();
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [remindingId, setRemindingId] = useState<string | null>(null);
    const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

    if (signers.length === 0) {
        return <p className="text-[13px] text-ih-fg-3">{m.agreement_signers_empty()}</p>;
    }

    const handleRemind = async (id: string) => {
        if (!onRemind) return;
        setRowError(null);
        setRemindingId(id);
        try {
            await onRemind(id);
        } catch (e) {
            setRowError({ id, message: e instanceof Error ? e.message : m.agreement_signers_remind_error() });
        } finally {
            setRemindingId(null);
        }
    };

    const handleCopy = async (id: string) => {
        if (!onCopyLink) return;
        setRowError(null);
        try {
            const url = await onCopyLink(id);
            await navigator.clipboard.writeText(url);
            setCopiedId(id);
            setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800);
        } catch {
            setRowError({ id, message: m.agreement_signers_copy_error() });
        }
    };

    return (
        <ul className="divide-y divide-ih-border">
            {signers.map((s) => {
                const chip = statusChip(s.status);
                const { canRemind, reason } = remindState(s, now);
                const terminal = isTerminal(s.status);
                return (
                    <li key={s.id} className="py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[13px] font-semibold text-ih-fg-1 truncate">{s.name}</span>
                                <Pill tone="neutral">{roleLabel(s.role)}</Pill>
                                <Pill tone={chip.tone}>{chip.label}</Pill>
                                {s.channel === "in_person" && <Pill tone="info">{m.agreement_signers_in_person()}</Pill>}
                            </div>
                            <div className="text-[12px] text-ih-fg-3 mt-0.5 truncate">{s.email}</div>
                            {s.onBehalfOf && (
                                <div className="text-[12px] text-ih-fg-3 mt-0.5">
                                    {m.agreement_signers_on_behalf_of()}<span className="font-medium text-ih-fg-2">{s.onBehalfOf}</span>
                                </div>
                            )}
                            {rowError?.id === s.id && (
                                <div className="text-[12px] text-ih-bad-fg mt-1">{rowError.message}</div>
                            )}
                        </div>

                        {!terminal && (onRemind || onCopyLink) && (
                            <div className="flex items-center gap-3 shrink-0">
                                {onRemind && (
                                    <button
                                        type="button"
                                        onClick={() => handleRemind(s.id)}
                                        disabled={!!busy || !canRemind || remindingId === s.id}
                                        title={reason ?? undefined}
                                        className="text-[13px] font-semibold text-ih-primary hover:opacity-80 disabled:text-ih-fg-4 disabled:cursor-not-allowed disabled:hover:opacity-100"
                                    >
                                        {remindingId === s.id ? m.agreement_signers_remind_pending() : m.agreement_signers_remind()}
                                    </button>
                                )}
                                {onCopyLink && (
                                    <button
                                        type="button"
                                        onClick={() => handleCopy(s.id)}
                                        disabled={!!busy}
                                        className="text-[13px] font-semibold text-ih-primary hover:opacity-80 disabled:text-ih-fg-4 disabled:cursor-not-allowed"
                                    >
                                        {copiedId === s.id ? m.common_copied() : m.agreement_signers_copy()}
                                    </button>
                                )}
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
