/**
 * <ContactChannels> — the company's own email and phone, as links.
 *
 * IA-36 ⑨ put this block on the dead-report page, and F37 needed the same thing
 * on the closed booking page: that page told visitors to "contact them directly"
 * and then listed a Privacy Policy and a Terms link, so a potential customer who
 * followed a shared booking link reached a dead end. The two surfaces ask the
 * same question — how does this reader reach this company — so they render the
 * same answer rather than two that drift.
 *
 * Either field may be null; with both null this renders NOTHING, which is the
 * load-bearing half. Callers must pick copy that does not promise a channel when
 * nothing comes back, instead of printing "contact us" over an empty block.
 */
export interface ContactChannelsProps {
  email?: string | null;
  phone?: string | null;
  className?: string;
}

/** True when there is at least one channel to show. Callers branch their copy on it. */
export function hasContactChannel(contacts: { email?: string | null; phone?: string | null }): boolean {
  return Boolean(contacts.email?.trim() || contacts.phone?.trim());
}

export function ContactChannels({ email, phone, className }: ContactChannelsProps) {
  const mail = email?.trim() || null;
  const tel = phone?.trim() || null;
  if (!mail && !tel) return null;
  return (
    <div className={`flex flex-col items-center gap-1.5 ${className ?? ""}`}>
      {mail && (
        <a
          href={`mailto:${mail}`}
          className="text-[14px] font-medium text-ih-primary-text hover:underline break-all"
        >
          {mail}
        </a>
      )}
      {tel && (
        /* tel: is the one deep-link that is reliably handled everywhere — every
           phone dials it and desktop browsers degrade to showing the number as
           text. The href strips formatting; the label keeps it. */
        <a
          href={`tel:${tel.replace(/[^\d+]/g, "")}`}
          className="text-[14px] font-medium text-ih-primary-text hover:underline"
        >
          {tel}
        </a>
      )}
    </div>
  );
}
