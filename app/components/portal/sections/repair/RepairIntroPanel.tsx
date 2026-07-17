/**
 * <RepairIntroPanel> — the custom-introduction editor for the Repair Request
 * Builder. Presentational: the parent owns the `customIntro` state + the
 * intro fetcher (offline-queue / persistence stays in the parent).
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { m } from "~/paraglide/messages";

interface RepairIntroPanelProps {
  customIntro: string;
  saving: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}

export function RepairIntroPanel({
  customIntro,
  saving,
  onChange,
  onBlur,
}: RepairIntroPanelProps) {
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-xl p-5 space-y-3">
      <p className="text-[12px] font-bold text-ih-fg-4 uppercase tracking-widest">
        {m.repair_intro_heading()}
      </p>
      <textarea
        placeholder={m.repair_intro_placeholder()}
        rows={4}
        value={customIntro}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 resize-none focus:outline-none focus:border-ih-primary"
      />
      {saving && (
        <p className="text-[11px] text-ih-fg-4">{m.common_saving()}</p>
      )}
    </div>
  );
}
