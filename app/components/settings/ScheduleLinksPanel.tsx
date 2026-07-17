import { useCopyClipboard } from "~/hooks/useCopyClipboard";
import { m } from "~/paraglide/messages";

export function ScheduleLinksPanel({
  tenant,
  slug,
}: {
  tenant: string | null | undefined;
  slug: string | null | undefined;
}) {
  const { copied: copiedField, copy } = useCopyClipboard();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const deepLink = tenant && slug ? `${origin}/book/${tenant}/${slug}` : null;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
        {m.settings_schedlinks_heading()}
      </h3>

      {deepLink ? (
        <div className="space-y-2">
          <p className="text-[12px] font-bold text-ih-fg-2">{m.settings_schedlinks_personal_label()}</p>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-ih-fg-1 truncate flex-1 font-mono bg-ih-bg-muted rounded px-2 py-1.5 border border-ih-border">
              {deepLink}
            </span>
            <button
              type="button"
              onClick={() => copy(deepLink, "deep")}
              className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
            >
              {copiedField === "deep" ? m.settings_common_copied() : m.common_copy()}
            </button>
          </div>
          <p className="text-[11px] text-ih-fg-3">
            {m.settings_schedlinks_deeplink_hint()}
          </p>
        </div>
      ) : (
        <p className="text-[12px] text-ih-fg-3">
          {m.settings_schedlinks_not_ready()}
        </p>
      )}

      <div className="pt-3 border-t border-ih-border space-y-1">
        <p className="text-[12px] font-bold text-ih-fg-2">{m.settings_schedlinks_ics_label()}</p>
        <p className="text-[11px] text-ih-fg-3">
          {m.settings_schedlinks_ics_desc()}{" "}
          <a
            href="https://support.google.com/calendar/answer/37100"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ih-primary font-semibold hover:underline"
          >
            {m.settings_schedlinks_ics_learn()}
          </a>
          .
        </p>
      </div>
    </section>
  );
}
