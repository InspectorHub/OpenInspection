import type { StepState } from "~/lib/checkout-steps";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

export function CheckoutShell({
    children,
    brandStyle,
    companyName,
}: {
    children: React.ReactNode;
    brandStyle: React.CSSProperties;
    companyName: string;
}) {
    return (
        <div className="min-h-screen bg-ih-bg-app py-6 px-4" style={brandStyle}>
            <div className="max-w-2xl mx-auto">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-9 h-9 bg-ih-primary rounded-2xl flex items-center justify-center shadow-ih-popover">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <span className="text-lg font-bold tracking-tight text-ih-fg-1">{companyName}</span>
                </div>
                <div className="bg-ih-bg-card rounded-lg shadow-ih-popover overflow-hidden">{children}</div>
                <p className="text-center text-[11px] text-ih-fg-4 mt-6">{m.checkout_powered_by()}</p>
            </div>
        </div>
    );
}

export function StepPill({ index, label, state }: { index: number; label: string; state: StepState }) {
    const done = state === "done" || state === "na";
    const active = state === "todo" || state === "waiting";
    return (
        <div className="flex items-center gap-2">
            <span
                className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold ${
                    done
                        ? "bg-ih-ok-bg text-ih-ok-fg"
                        : active
                          ? "bg-ih-primary text-ih-primary-fg"
                          : "bg-ih-bg-muted text-ih-fg-4"
                }`}
            >
                {done ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                ) : (
                    index
                )}
            </span>
            <span className={`text-[13px] font-semibold ${done ? "text-ih-fg-2" : active ? "text-ih-fg-1" : "text-ih-fg-4"}`}>
                {label}
                {state === "na" && <span className="text-ih-fg-4 font-normal">{m.checkout_step_suffix_not_required()}</span>}
                {state === "waiting" && <span className="text-ih-fg-4 font-normal">{m.checkout_step_suffix_waiting()}</span>}
            </span>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Completion card                                                    */
/* ------------------------------------------------------------------ */

export function CompleteCard({ tenant, inspectionId }: { tenant: string; inspectionId: string }) {
    // Report URL is constructed from the path tenant slug + inspection id
    // (matches the /report/:tenant/:id public route). The report itself is
    // still gated server-side, so this is a convenience link, not a bypass.
    const reportHref = tenant ? `/report/${tenant}/${inspectionId}` : null;
    return (
        <div className="px-6 py-6 sm:px-8 bg-ih-ok-bg border-b border-ih-ok">
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-ih-ok rounded-full flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <div>
                    <h2 className="text-[15px] font-bold text-ih-ok-fg">{m.checkout_complete_heading()}</h2>
                    <p className="text-[13px] text-ih-fg-2 mt-0.5">
                        {m.checkout_complete_body()}
                    </p>
                </div>
            </div>
            {reportHref && (
                <a
                    href={reportHref}
                    className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-md bg-ih-primary text-ih-primary-fg text-sm font-bold hover:bg-ih-primary-600 transition-all"
                >
                    {m.checkout_complete_view_report()}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                </a>
            )}
        </div>
    );
}
