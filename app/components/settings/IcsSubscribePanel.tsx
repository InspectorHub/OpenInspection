import { Banner } from "@core/shared-ui";
import { useCopyClipboard } from "~/hooks/useCopyClipboard";
import { m } from "~/paraglide/messages";

/**
 * Feed PATHS, not absolute URLs. The API is mounted in-process behind the RR
 * server, so a URL built there carries the API worker's host rather than the
 * one the browser is on — the copied link would be dead on arrival. The origin
 * is added here, where it is known to be the user's.
 */
export interface IcsLinks {
  /** Opaque busy blocks, public slug path. Null until the user has a slug. */
  busyPath: string | null;
  /** The inspector's own schedule WITH addresses, sealed-token path. */
  schedulePath: string | null;
  /** Every inspection in the company. Null for non-admins. */
  companyPath: string | null;
}

interface FeedRow {
  key: string;
  label: string;
  description: string;
  url: string;
  sensitive?: boolean;
}

/**
 * The subscribe catalog: three feeds, each with what it is FOR.
 *
 * The three exist because they have different audiences and therefore
 * different payloads — that distinction is the useful content here, not the
 * URLs, so every row states its audience and the schedule row says out loud
 * that its link carries addresses. A copied calendar link gets pasted into
 * shared calendars; someone doing that deserves to know which one is private.
 */
export function IcsSubscribePanel({ links }: { links: IcsLinks }) {
  const { copied: copiedField, copy } = useCopyClipboard();
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const rows: FeedRow[] = [
    ...(links.companyPath
      ? [{
          key: "company",
          label: m.settings_icsfeeds_company_label(),
          description: m.settings_icsfeeds_company_desc(),
          url: `${origin}${links.companyPath}`,
          sensitive: true,
        }]
      : []),
    ...(links.busyPath
      ? [{
          key: "busy",
          label: m.settings_icsfeeds_busy_label(),
          description: m.settings_icsfeeds_busy_desc(),
          url: `${origin}${links.busyPath}`,
        }]
      : []),
    ...(links.schedulePath
      ? [{
          key: "schedule",
          label: m.settings_icsfeeds_schedule_label(),
          description: m.settings_icsfeeds_schedule_desc(),
          url: `${origin}${links.schedulePath}`,
          sensitive: true,
        }]
      : []),
  ];

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <div className="space-y-1">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.settings_icsfeeds_heading()}
        </h3>
        <p className="text-[12px] text-ih-fg-3">{m.settings_icsfeeds_intro()}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-ih-fg-3">{m.settings_icsfeeds_none()}</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => (
            <li key={row.key} className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[12px] font-bold text-ih-fg-2">{row.label}</p>
                {row.sensitive && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ih-fg-3 border border-ih-border rounded px-1.5 py-0.5">
                    {m.settings_icsfeeds_private_badge()}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-ih-fg-3">{row.description}</p>
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-ih-fg-1 truncate flex-1 font-mono bg-ih-bg-muted rounded px-2 py-1.5 border border-ih-border">
                  {row.url}
                </span>
                <button
                  type="button"
                  onClick={() => copy(row.url, row.key)}
                  className="h-8 px-3 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
                >
                  {copiedField === row.key ? m.settings_common_copied() : m.common_copy()}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Banner tone="info">{m.settings_icsfeeds_privacy_note()}</Banner>

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
    </section>
  );
}
