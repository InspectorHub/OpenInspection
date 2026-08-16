import { m } from "~/paraglide/messages";

/**
 * What a tenant with no QuickBooks connection sees.
 *
 * Intuit's listing requirements govern this card, not our design system:
 *
 *   - The connect control must use their approved artwork. Using outdated or
 *     unapproved QuickBooks imagery is among the most common reasons an app
 *     fails review, and "do not modify the appearance of any button graphics"
 *     is stated plainly — so the anchor carries layout only, and no colour,
 *     radius or sizing of ours reaches the graphic.
 *   - Base AND hover states must both be defined. Hence two files.
 *   - This whole card must disappear once a company is connected, replaced by a
 *     control titled "Disconnect from QuickBooks". The caller owns that
 *     mutual exclusion; this component only renders the unconnected half.
 *
 * One graphic serves both themes. Intuit's transparent variant is transparent
 * in its background only — its text is #393A3D, which all but vanishes on our
 * dark surface — and recolouring it is exactly what their rule forbids. The
 * green button is white on #2CA01C and reads on either.
 */
export function QboConnectCard() {
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg p-8 text-center">
      <div className="w-16 h-16 bg-[#2CA01C]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <span className="text-[#2CA01C] text-2xl font-extrabold">QB</span>
      </div>
      <h3 className="text-[16px] font-bold text-ih-fg-1 mb-2">
        {m.settings_qbo_connect_heading()}
      </h3>
      <ul className="text-[13px] text-ih-fg-3 text-left max-w-xs mx-auto mb-6 space-y-2">
        <li className="flex items-start gap-2">
          <span className="text-ih-ok-fg mt-0.5">&#x2713;</span> {m.settings_qbo_feature_sync()}
        </li>
        <li className="flex items-start gap-2">
          <span className="text-ih-ok-fg mt-0.5">&#x2713;</span> {m.settings_qbo_feature_payments()}
        </li>
        <li className="flex items-start gap-2">
          <span className="text-ih-ok-fg mt-0.5">&#x2713;</span> {m.settings_qbo_feature_dedup()}
        </li>
        <li className="flex items-start gap-2">
          <span className="text-ih-ok-fg mt-0.5">&#x2713;</span> {m.settings_qbo_feature_void()}
        </li>
      </ul>
      <a
        href="/api/integrations/qbo/connect"
        className="group inline-flex rounded focus:shadow-ih-focus outline-none"
      >
        <img
          src="/intuit/C2QB_green_btn_med_default.svg"
          alt={m.settings_qbo_connect_button()}
          width={223}
          height={36}
          className="group-hover:hidden"
        />
        <img
          src="/intuit/C2QB_green_btn_med_hover.svg"
          alt=""
          aria-hidden="true"
          width={223}
          height={36}
          className="hidden group-hover:block"
        />
      </a>
    </div>
  );
}
