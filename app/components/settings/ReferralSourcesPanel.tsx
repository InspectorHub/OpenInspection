import { m } from "~/paraglide/messages";

/**
 * Settings → Company: "Referral sources" section. Seven seeded labels the
 * dropdown always offers, plus a newline-separated list of the tenant's own.
 *
 * Lifted out of `app/routes/settings-workspace.tsx` verbatim (pure movement) so
 * the route stays under the file-size gate as the page grows sections.
 * Presentational — the route owns the Conform form and the save action; the
 * textarea is uncontrolled and read straight off the submitted FormData.
 */
export function ReferralSourcesPanel({
  fieldId,
  fieldName,
  customReferralSources,
}: {
  fieldId: string;
  fieldName: string;
  customReferralSources: string[] | null | undefined;
}) {
  return (
    <section id="referral" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5 scroll-mt-12">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_referral_heading()}</h3>
      <div className="space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-ih-fg-2">{m.settings_workspace_referral_builtin_label()}</div>
        <div className="flex flex-wrap gap-2">
          {["Realtor", "Past Client", "Google Search", "Facebook", "Yelp", "Walk-in", "Other"].map((s) => (
            <span key={s} className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-ih-bg-muted text-ih-fg-2">{s}</span>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <label htmlFor={fieldId} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_referral_custom_label()}</label>
        <textarea id={fieldId} name={fieldName} rows={6}
          defaultValue={(customReferralSources ?? []).join("\n")}
          placeholder={m.settings_workspace_referral_custom_placeholder()}
          className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1" />
        <p className="text-[11px] text-ih-fg-3">{m.settings_workspace_referral_custom_hint()}</p>
      </div>
    </section>
  );
}
