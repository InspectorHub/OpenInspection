import { useState } from "react";
import { parseQuickPhraseLines, resolveQuickPhrases, seedQuickPhrases } from "~/lib/repair-quick-phrases";
import { m } from "~/paraglide/messages";

/**
 * Settings → Company: "Repair-note quick phrases" (#275).
 *
 * A textarea, not a list editor, and deliberately: LINE ORDER IS BUTTON ORDER,
 * so add / edit / remove / reorder are all just editing text — the same idiom
 * the referral-sources panel beside it already uses. A drag-and-drop list
 * editor would buy nothing here and would be a second idiom for one shape.
 *
 * The preview is not decoration. The tenant is configuring something only their
 * CLIENTS ever see, on a public page they may never open, so without it they
 * are editing blind — including the case that matters most, an empty list,
 * which turns the buttons off rather than restoring the defaults.
 *
 * The hidden `repairQuickPhrasesPresent` input is what makes turning them off
 * possible at all. Conform coerces an empty textarea to `undefined`, which is
 * indistinguishable from "this form never carried the field" — and a save that
 * cannot tell those apart either silently ignores the clear or silently clears
 * a configured list from an unrelated form. The sentinel says which happened.
 *
 * It is withheld while the list is UNCONFIGURED AND UNTOUCHED, so that saving
 * an unrelated company setting does not quietly turn the defaults into tenant
 * content. It would look like a no-op — the same two buttons — but the defaults
 * are resolved per request from the message catalog while tenant content is
 * frozen text, so an admin working in Spanish would have pinned Spanish buttons
 * onto every English-speaking client of that workspace.
 */
export function RepairQuickPhrasesPanel({
  fieldId,
  fieldName,
  repairQuickPhrases,
}: {
  fieldId: string;
  fieldName: string;
  repairQuickPhrases: string[] | null | undefined;
}) {
  const seeds = seedQuickPhrases();
  const initial = resolveQuickPhrases(repairQuickPhrases, seeds).join("\n");
  const [value, setValue] = useState(initial);
  const preview = parseQuickPhraseLines(value);
  const submitsPhrases = repairQuickPhrases != null || value !== initial;

  return (
    <section id="quick-phrases" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5 scroll-mt-12">
      <div>
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_quick_phrases_heading()}</h3>
        <p className="mt-1 text-[12px] text-ih-fg-3">{m.settings_workspace_quick_phrases_subtitle()}</p>
      </div>
      {submitsPhrases && <input type="hidden" name="repairQuickPhrasesPresent" value="1" />}
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="space-y-2">
          <label htmlFor={fieldId} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_quick_phrases_label()}</label>
          <textarea id={fieldId} name={fieldName} rows={6}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={m.settings_workspace_quick_phrases_placeholder()}
            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1" />
          <p className="text-[11px] text-ih-fg-3">{m.settings_workspace_quick_phrases_hint()}</p>
        </div>
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-ih-fg-2">{m.settings_workspace_quick_phrases_preview_label()}</div>
          <div className="rounded-md border border-dashed border-ih-border-strong bg-ih-bg-app px-3 py-3">
            <div className="h-9 rounded-md border border-ih-border bg-ih-bg-card" aria-hidden="true" />
            {preview.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                {preview.map((phrase) => (
                  <span key={phrase} className="text-[11px] font-bold text-ih-primary">{phrase}</span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-ih-fg-3">{m.settings_workspace_quick_phrases_empty_warning()}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
