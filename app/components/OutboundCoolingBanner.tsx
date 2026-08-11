/**
 * Portal #98 §3.4 — the first-24-hours notice.
 *
 * Shown while the window is OPEN, not at the moment a send fails. A legitimate
 * inspector who signs up on site and wants to send today IS blocked, and that
 * is a real product cost. What makes it survivable is being told before they
 * need it, in enough detail that the account does not read as broken.
 *
 * `unlockAtMs` is decided by the server and is non-null only while the window
 * is open (see `resolveCoolingWindowForSession`), so there is no clock
 * arithmetic here that could disagree with the gate.
 *
 * Tone is `info`, not `warn`: nothing is wrong. `warn` on this banner would be
 * the loudest thing on a brand-new company's first screen, which is precisely
 * the "broken account" reading §3.4 exists to avoid.
 */
import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { formatShapedDateTime } from "~/lib/format-date";
import { useChromeDateTimeFormat, useDisplayTimeZone } from "~/hooks/useSessionContext";

export function OutboundCoolingBanner({
  unlockAtMs,
}: {
  unlockAtMs: number | null | undefined;
}) {
  const timeZone = useDisplayTimeZone();
  const fmt = useChromeDateTimeFormat();
  if (!unlockAtMs) return null;

  return (
    <Banner
      tone="info"
      className="mb-0 rounded-none"
      actions={
        <a
          href="/settings/communication"
          className="text-sm font-bold text-ih-primary-text hover:underline"
        >
          {m.outbound_cooling_notice_action()}
        </a>
      }
    >
      {m.outbound_cooling_notice({
        unlockAt: formatShapedDateTime(unlockAtMs, timeZone, fmt),
      })}
    </Banner>
  );
}
