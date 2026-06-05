type WorkflowState =
 | "agreement"
 | "payment"
 | "apprentice-review"
 | "published"
 | "cancelled"
 | "draft";

const STATE_LABELS: Record<WorkflowState, string> = {
 agreement: "Agreement",
 payment: "Payment",
 "apprentice-review": "Apprentice review",
 published: "Published",
 cancelled: "Cancelled",
 draft: "Draft",
};

const STATE_TONES: Record<WorkflowState, { bg: string; text: string }> = {
 agreement: { bg: "bg-ih-watch-bg", text: "text-ih-watch-fg" },
 payment: { bg: "bg-ih-info-bg", text: "text-ih-info-fg" },
 "apprentice-review": { bg: "bg-ih-watch-bg", text: "text-ih-watch-fg" },
 published: { bg: "bg-ih-ok-bg", text: "text-ih-ok-fg" },
 cancelled: { bg: "bg-ih-bad-bg", text: "text-ih-bad-fg" },
 draft: { bg: "bg-ih-bg-muted", text: "text-ih-fg-3" },
};

interface WorkflowChipProps {
 state: WorkflowState;
 label?: string;
}

export function WorkflowChip({ state, label }: WorkflowChipProps) {
 const tone = STATE_TONES[state] ?? STATE_TONES.draft;
 const text = label ?? STATE_LABELS[state] ?? STATE_LABELS.draft;

 return (
 <span
 className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${tone.bg} ${tone.text}`}
 aria-label={`Workflow state: ${text}`}
 >
 {text}
 </span>
 );
}
