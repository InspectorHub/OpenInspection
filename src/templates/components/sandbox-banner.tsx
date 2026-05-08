/**
 * Sprint 1 CC-2 — Sandbox demo banner.
 *
 * Rendered at the top of every authenticated page when the worker is running
 * in sandbox mode (env.SANDBOX_MODE === 'true'). Lets visitors know they are
 * in a public demo, that data resets nightly, and that they should not enter
 * real customer information. Hidden from print so PDF reports stay clean.
 *
 * Design system: indigo-50 background + 12 px medium text + emoji icon to
 * keep visual weight low. The banner is sticky-top inside the layout so it
 * remains visible while scrolling on long pages.
 */
export const SandboxBanner = (): JSX.Element => (
    <div
        role="status"
        aria-label="Sandbox demo notice"
        class="print:hidden bg-indigo-50 border-b border-indigo-100 text-indigo-900 px-4 py-2 flex items-center justify-center gap-2 text-[12px] font-medium tracking-tight"
    >
        <span aria-hidden="true">🧪</span>
        <span>
            You are using the public OpenInspection sandbox. Data resets every
            night at 03:00&nbsp;UTC — please don&rsquo;t enter real customer
            information.
        </span>
        <a
            href="https://github.com/InspectorHub/OpenInspection#deploy"
            class="underline decoration-dotted underline-offset-2 hover:text-indigo-700"
            target="_blank"
            rel="noopener noreferrer"
        >
            Deploy your own
        </a>
    </div>
);
