import { useState, useEffect } from "react";
import { Modal, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * Track I-a Task 9 — shared multi-signer send modal. Self-contained (no route
 * coupling): the parent owns submission via `onSend`, so the same modal mounts
 * on the admin Signing tab and (later) the #111 inspection hub. Collects N
 * signer rows (name + email + role) and a completion policy. Admin surface →
 * DS tokens, light/dark via data-color-scheme. No native confirm/alert.
 */

export type SignerRole = "client" | "co_client" | "agent" | "other";

export interface SignerDraft {
    name: string;
    email: string;
    role: SignerRole;
}

export interface SendAgreementPayload {
    signers: SignerDraft[];
    completionPolicy: "all" | "one";
}

const ROLE_OPTIONS: Array<{ value: SignerRole; label: string }> = [
    { value: "client", label: "Client" },
    { value: "co_client", label: "Co-client" },
    { value: "agent", label: "Agent" },
    { value: "other", label: "Other" },
];

/** Internal row state: extends SignerDraft with a stable UUID key for React reconciliation. */
export interface SignerDraftRow extends SignerDraft {
    key: string;
}

/** Factory for a new, empty signer row. The `key` is stable across re-renders. */
export function emptySigner(): SignerDraftRow {
    return { name: "", email: "", role: "client", key: crypto.randomUUID() };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pure validation: every row needs a name + a plausible email, no duplicate
 * emails (case-insensitive), at least one row. Returns the first problem or
 * null when the draft is submittable.
 */
export function validateSigners(signers: SignerDraft[]): string | null {
    if (signers.length === 0) return m.agreement_send_error_no_signers();
    const seen = new Set<string>();
    for (const s of signers) {
        if (!s.name.trim()) return m.agreement_send_error_no_name();
        const email = s.email.trim().toLowerCase();
        if (!EMAIL_RE.test(email)) return m.agreement_send_error_invalid_email({ email: s.email || m.agreement_send_email_empty() });
        if (seen.has(email)) return m.agreement_send_error_duplicate({ email: s.email });
        seen.add(email);
    }
    return null;
}

/**
 * Pure submit-payload builder: trims each signer's name/email (preserving role)
 * and pairs them with the completion policy. The `key` field (stable row identity
 * used by React reconciliation) is stripped — it must not reach the server.
 * The parent serializes this into the route's `send` intent. Kept pure so the
 * wiring can be unit-tested without a render harness (happy-dom has none in this repo).
 */
export function buildSendPayload(
    signers: SignerDraft[] | SignerDraftRow[],
    completionPolicy: "all" | "one",
): SendAgreementPayload {
    return {
        // Destructure to drop any `key` field that may be present on SignerDraftRow.
        signers: signers.map(({ name, email, role }) => ({ name: name.trim(), email: email.trim(), role })),
        completionPolicy,
    };
}

export function SendAgreementModal({
    open,
    onSend,
    onClose,
    busy,
    initialSigners,
}: {
    open: boolean;
    onSend: (payload: SendAgreementPayload) => void;
    onClose: () => void;
    busy?: boolean;
    initialSigners?: SignerDraft[];
}) {
    const seed = (): SignerDraftRow[] => {
        if (initialSigners && initialSigners.length > 0) {
            // Attach stable keys to any externally-supplied initial rows.
            return initialSigners.map((s) => ({ ...s, key: crypto.randomUUID() }));
        }
        return [emptySigner()];
    };

    const [signers, setSigners] = useState<SignerDraftRow[]>(seed);
    const [completionPolicy, setCompletionPolicy] = useState<"all" | "one">("all");
    const [error, setError] = useState<string | null>(null);

    // The modal stays mounted (Modal renders null when closed), so reseed the
    // draft each time it opens — a reopened modal must start fresh, not resume
    // the previous run's rows/policy/error.
    useEffect(() => {
        if (!open) return;
        setSigners(seed());
        setCompletionPolicy("all");
        setError(null);
    }, [open]);

    const update = (i: number, patch: Partial<SignerDraft>) =>
        setSigners((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    const addRow = () => setSigners((prev) => [...prev, emptySigner()]);
    const removeRow = (i: number) => setSigners((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

    const submit = () => {
        const problem = validateSigners(signers);
        if (problem) { setError(problem); return; }
        setError(null);
        onSend(buildSendPayload(signers, completionPolicy));
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m.agreement_send_title()}
            size="lg"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={busy}>{m.common_cancel()}</Button>
                    <Button variant="primary" onClick={submit} disabled={busy}>
                        {busy ? m.agreement_send_pending() : m.agreement_send_submit()}
                    </Button>
                </>
            }
        >
            <p className="text-[13px] text-ih-fg-3 mb-4">
                {m.agreement_send_intro()}
            </p>

            <div className="space-y-3">
                {signers.map((s, i) => (
                    <div key={s.key} className="flex items-start gap-2">
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                                type="text"
                                value={s.name}
                                placeholder={m.agreement_send_name_placeholder()}
                                aria-label={m.agreement_send_name_aria()}
                                disabled={busy}
                                onChange={(e) => update(i, { name: e.target.value })}
                                className="px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-ih-primary/30 outline-none"
                            />
                            <input
                                type="email"
                                value={s.email}
                                placeholder={m.agreement_send_email_placeholder()}
                                aria-label={m.agreement_send_email_aria()}
                                disabled={busy}
                                onChange={(e) => update(i, { email: e.target.value })}
                                className="px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-ih-primary/30 outline-none"
                            />
                        </div>
                        <select
                            value={s.role}
                            disabled={busy}
                            onChange={(e) => update(i, { role: e.target.value as SignerRole })}
                            className="px-2 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-ih-primary/30 outline-none"
                            aria-label={m.agreement_send_role_aria()}
                        >
                            {ROLE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={() => removeRow(i)}
                            disabled={busy || signers.length === 1}
                            aria-label={m.agreement_send_remove_aria()}
                            className="px-2 py-2 text-ih-fg-3 hover:text-ih-bad-fg disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={addRow}
                disabled={busy}
                className="mt-3 text-[13px] font-semibold text-ih-primary hover:opacity-80 disabled:opacity-40"
            >
                {m.agreement_send_add()}
            </button>

            <fieldset className="mt-5">
                <legend className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-2">{m.agreement_send_completion_legend()}</legend>
                <div className="space-y-2">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                            type="radio"
                            name="completionPolicy"
                            checked={completionPolicy === "all"}
                            disabled={busy}
                            onChange={() => setCompletionPolicy("all")}
                            className="mt-0.5 h-4 w-4 text-ih-primary focus:ring-ih-primary/30"
                        />
                        <span className="text-[13px] text-ih-fg-2">{m.agreement_send_policy_all()}</span>
                    </label>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                            type="radio"
                            name="completionPolicy"
                            checked={completionPolicy === "one"}
                            disabled={busy}
                            onChange={() => setCompletionPolicy("one")}
                            className="mt-0.5 h-4 w-4 text-ih-primary focus:ring-ih-primary/30"
                        />
                        <span className="text-[13px] text-ih-fg-2">{m.agreement_send_policy_one()}</span>
                    </label>
                </div>
            </fieldset>

            {error && <p className="text-[13px] text-ih-bad-fg mt-3">{error}</p>}
        </Modal>
    );
}
