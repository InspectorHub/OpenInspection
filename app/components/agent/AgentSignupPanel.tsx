import { m } from "~/paraglide/messages";

/**
 * The editorial left-hand panel of `/agent-signup` — the value proposition an
 * external agent reads before deciding whether to fill anything in.
 *
 * Lifted out of the page for the same reason `AgentTermsConsent` was: the signup
 * route is the widest surface in this portal and was 389 of its 400 permitted
 * lines, with no room for the blocked-state handling the form now needs. This is
 * the block worth moving — pure presentation, no loader data, no form state — so
 * what stays in the route is the part that has behaviour.
 */

// Built by a factory (called per render) so the copy resolves against the
// active locale rather than freezing at module import time.
function makeValueProps() {
  return [
    {
      num: "1",
      bold: m.auth_agent_signup_prop1_bold(),
      text: m.auth_agent_signup_prop1_text(),
    },
    {
      num: "2",
      bold: m.auth_agent_signup_prop2_bold(),
      text: m.auth_agent_signup_prop2_text(),
    },
    {
      num: "3",
      bold: m.auth_agent_signup_prop3_bold(),
      text: m.auth_agent_signup_prop3_text(),
    },
  ];
}

export function AgentSignupPanel() {
  return (
    /* ds-allow: fixed-dark marketing panel */
    <aside className="relative flex flex-col justify-center px-8 py-12 lg:px-12 bg-slate-900 text-white overflow-hidden">
      <div className="absolute w-[480px] h-[480px] -right-[120px] -top-[160px] bg-ih-primary blur-[140px] opacity-35 pointer-events-none" />
      <div className="relative z-10 max-w-[460px] mx-auto">
        <div className="flex items-center gap-3 mb-12">
          <img src="/logo.svg" alt="" className="w-8 h-8" width={32} height={32} />
          <span className="font-serif font-bold text-lg tracking-tight">
            OpenInspection
          </span>
        </div>
        <h1 className="font-serif font-bold text-[2.75rem] leading-[1.05] tracking-tight mb-5">
          {m.auth_agent_signup_heading()}
        </h1>
        {/* ds-allow: light tint text on the fixed-dark marketing panel */}
        <p className="text-base leading-relaxed text-stone-300 mb-8">
          {m.auth_agent_signup_panel_text()}
        </p>
        <ul className="space-y-0">
          {makeValueProps().map((v) => (
            <li
              key={v.num}
              className="flex gap-3.5 py-4 border-t border-white/[0.08] last:border-b"
            >
              <span className="w-7 h-7 rounded-full bg-ih-primary text-ih-fg-inverse flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                {v.num}
              </span>
              {/* ds-allow: light tint text on the fixed-dark marketing panel */}
              <span className="text-[15px] leading-relaxed text-stone-200">
                <strong className="text-white font-semibold">{v.bold}</strong>{" "}
                {v.text}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
