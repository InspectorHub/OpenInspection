import { m } from "~/paraglide/messages";

/** The id of the "Your Intuit app" section, which the blocked state points at. */
const QBO_APP_SECTION_ID = "qbo-app";

const CHECK = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-ih-ok-fg">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/**
 * What a company with no QuickBooks connection sees.
 *
 * Intuit's listing requirements govern the connect control, not our design
 * system:
 *
 *   - It must use their approved artwork. Using outdated or unapproved
 *     QuickBooks imagery is among the most common reasons an app fails review,
 *     and "do not modify the appearance of any button graphics" is stated
 *     plainly -- so the anchor carries layout only, and no colour, radius,
 *     filter or sizing of ours reaches the graphic. That includes the blocked
 *     state below: the image is never greyed out.
 *   - Base AND hover states must both be defined. Hence two files.
 *   - This whole card must disappear once a company is connected, replaced by a
 *     control titled "Disconnect from QuickBooks". The caller owns that mutual
 *     exclusion; this component only renders the unconnected half.
 *
 * One graphic serves both themes. Intuit's transparent variant is transparent in
 * its background only -- its text is #393A3D, which all but vanishes on our dark
 * surface -- and recolouring it is exactly what their rule forbids. The green
 * button is white on #2CA01C and reads on either.
 *
 * `ready` is false when the operator brings their own Intuit app and has not
 * finished entering it. Pressing Connect then could only come back as an error,
 * so the link stops being a link to the OAuth start: it becomes an
 * `aria-disabled` pointer to the section that fixes it.
 */
export function QboConnectCard({
  ready,
  onNeedCredentials,
}: {
  ready: boolean;
  onNeedCredentials: () => void;
}) {
  // No preventDefault: the href is the section anchor, so the browser scrolls
  // to it while the section opens.
  const blockedClick = () => onNeedCredentials();
  return (
    <div className="space-y-4">
      <div className="bg-ih-bg-card border border-ih-border rounded-ih-card px-6 py-10 text-center">
        <div className="mx-auto flex max-w-[520px] flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#2CA01C]/10" aria-hidden="true">
            <span className="text-2xl font-extrabold text-[#2CA01C]">QB</span>
          </div>
          <div>
            <h2 className="text-[20px] font-bold text-ih-fg-1">{m.settings_qbo_connect_heading()}</h2>
            <p className="mt-1.5 text-[13px] text-ih-fg-3">{m.settings_qbo_connect_sub()}</p>
          </div>
          <ul className="max-w-[420px] space-y-2 self-stretch text-left text-[13px] text-ih-fg-2">
            {[
              m.settings_qbo_feature_sync(),
              m.settings_qbo_feature_payments(),
              m.settings_qbo_feature_dedup(),
              m.settings_qbo_feature_void(),
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                {CHECK}
                {t}
              </li>
            ))}
          </ul>
          <a
            href={ready ? "/api/integrations/qbo/connect" : `#${QBO_APP_SECTION_ID}`}
            aria-disabled={ready ? undefined : true}
            onClick={ready ? undefined : blockedClick}
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
          {ready ? (
            <p className="max-w-[44ch] text-xs text-ih-fg-3">{m.settings_qbo_connect_note()}</p>
          ) : (
            <p className="max-w-[44ch] text-xs text-ih-fg-3">
              {m.settings_qbo_connect_blocked()}{" "}
              <a href={`#${QBO_APP_SECTION_ID}`} onClick={blockedClick} className="font-semibold text-ih-primary-text underline">
                {m.settings_qbo_connect_blocked_link()}
              </a>
            </p>
          )}
        </div>
      </div>

      <section className="bg-ih-bg-card border border-ih-border rounded-ih-card p-6" aria-labelledby="qbo-before-heading">
        <h2 id="qbo-before-heading" className="text-[15px] font-bold text-ih-fg-1">
          {m.settings_qbo_before_heading()}
        </h2>
        <dl className="mt-3 space-y-3 text-[13px]">
          <div>
            <dt className="font-bold text-ih-fg-1">{m.settings_qbo_before_who_term()}</dt>
            <dd className="text-ih-fg-3">{m.settings_qbo_before_who_def()}</dd>
          </div>
          <div>
            <dt className="font-bold text-ih-fg-1">{m.settings_qbo_before_one_term()}</dt>
            <dd className="text-ih-fg-3">{m.settings_qbo_before_one_def()}</dd>
          </div>
          <div>
            <dt className="font-bold text-ih-fg-1">{m.settings_qbo_before_unsent_term()}</dt>
            <dd className="text-ih-fg-3">{m.settings_qbo_before_unsent_def()}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
