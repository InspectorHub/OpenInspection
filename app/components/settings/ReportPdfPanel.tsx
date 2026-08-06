import { SettingToggle } from "./SettingToggle";
import { m } from "~/paraglide/messages";

/** The subset of Conform field metadata this panel reads for the address input. */
type AddressField = {
  id: string;
  name: string;
  errors?: string[] | undefined;
};

/**
 * Settings → Company: "Report PDF" section — what the printed/exported report
 * puts in its margins. Grouped as one panel because these four settings only
 * ever matter together: they are the page furniture (company address, footer,
 * page numbers, license line), not anything about inspection content.
 *
 * The three toggles default ON here (`?? true`), unlike the report-feature
 * flags: an existing report already prints its footer, so an unset value means
 * "never configured", not "turned off".
 *
 * Presentational — the route owns the Conform form and the save action.
 */
export function ReportPdfPanel({
  addressField,
  companyAddress,
  pdfShowFooter,
  pdfShowPageNumbers,
  pdfShowLicense,
}: {
  addressField: AddressField;
  companyAddress: string | null | undefined;
  pdfShowFooter: boolean | null | undefined;
  pdfShowPageNumbers: boolean | null | undefined;
  pdfShowLicense: boolean | null | undefined;
}) {
  return (
    <section id="report-pdf" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5 scroll-mt-12">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_report_pdf_heading()}</h3>
      <p className="text-[12px] text-ih-fg-3">{m.settings_workspace_report_pdf_subtitle()}</p>

      <div className="space-y-2">
        <label htmlFor={addressField.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_company_address_label()}</label>
        <input type="text" id={addressField.id} name={addressField.name}
          defaultValue={companyAddress ?? ""}
          placeholder={m.settings_workspace_company_address_placeholder()}
          aria-invalid={addressField.errors ? true : undefined}
          className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1" />
        <p className="text-[11px] text-ih-fg-3">{m.settings_workspace_company_address_hint()}</p>
        {addressField.errors && (
          <p className="mt-1 text-xs text-ih-bad-fg">{addressField.errors[0]}</p>
        )}
      </div>

      <SettingToggle
        name="pdfShowFooter"
        defaultChecked={pdfShowFooter ?? true}
        title={m.settings_workspace_pdf_footer_title()}
        description={m.settings_workspace_pdf_footer_desc()}
      />

      <SettingToggle
        name="pdfShowPageNumbers"
        defaultChecked={pdfShowPageNumbers ?? true}
        title={m.settings_workspace_pdf_page_numbers_title()}
        description={m.settings_workspace_pdf_page_numbers_desc()}
      />

      <SettingToggle
        name="pdfShowLicense"
        defaultChecked={pdfShowLicense ?? true}
        title={m.settings_workspace_pdf_license_title()}
        description={m.settings_workspace_pdf_license_desc()}
      />
    </section>
  );
}
