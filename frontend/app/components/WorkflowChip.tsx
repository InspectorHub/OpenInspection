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
  agreement:           { bg: "bg-amber-50 dark:bg-amber-900/30",   text: "text-amber-700 dark:text-amber-300" },
  payment:             { bg: "bg-sky-50 dark:bg-sky-900/30",       text: "text-sky-700 dark:text-sky-300" },
  "apprentice-review": { bg: "bg-amber-50 dark:bg-amber-900/30",   text: "text-amber-700 dark:text-amber-300" },
  published:           { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300" },
  cancelled:           { bg: "bg-rose-50 dark:bg-rose-900/30",     text: "text-rose-700 dark:text-rose-300" },
  draft:               { bg: "bg-slate-100 dark:bg-slate-700",     text: "text-slate-600 dark:text-slate-300" },
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
