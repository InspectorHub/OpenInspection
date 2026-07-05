import { useNavigation } from "react-router";

/**
 * Sticky save bar for the long settings forms (Profile, Company).
 *
 * Renders the primary submit control pinned to the bottom of the settings
 * scroll area (`sticky bottom-0`) so Save stays reachable without scrolling to
 * the end of a long form. It is an opaque card (bg + border + popover
 * elevation, z-10) so content scrolling underneath never bleeds through.
 *
 * It renders a plain `type="submit"` button, so it MUST live inside the
 * form it saves — it reuses the form's existing submit wiring rather than
 * introducing a second competing submit. Disabled while the route navigation
 * is submitting (fetcher-driven side actions like photo/logo/signature upload
 * do not flip navigation state, so they never disable Save).
 */
export function SettingsSaveBar({ label }: { label: string }) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  return (
    <div className="sticky bottom-0 z-10 -mb-2 flex items-center justify-end gap-3 rounded-lg border border-ih-border bg-ih-bg-card px-4 py-3 shadow-ih-popover">
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 bg-ih-primary text-white rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:pointer-events-none"
      >
        {submitting ? "Saving…" : label}
      </button>
    </div>
  );
}
