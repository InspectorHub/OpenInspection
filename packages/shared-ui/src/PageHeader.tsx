import React from "react";
import { Eyebrow, type EyebrowColor } from "./Eyebrow";

interface PageHeaderProps {
  /** @deprecated Use a breadcrumb (app/components/Breadcrumb) + a Pill in `meta` instead. Do not use on new pages. */
  eyebrow?: string;
  /** @deprecated Same as `eyebrow`. */
  eyebrowColor?: EyebrowColor;
  title: string | React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, eyebrowColor = "slate", title, meta, actions }: PageHeaderProps) {
  return (
    // Three rules, and every one of them is load-bearing on a narrow screen.
    //
    // `flex-wrap` on the row: without it the row is `nowrap`, so when the
    // actions do not fit beside the title there is nowhere for them to go but
    // off the right edge — which is what happened. Four page headers pushed
    // their primary button outside a 390px viewport (New Inspection by 29px,
    // Invite Member by 94px, the calendar's day button by 136px) and dragged a
    // horizontal scrollbar onto the whole document.
    //
    // `min-w-0` on the title column: a flex item's automatic minimum size is
    // its min-content width, so a long title refuses to shrink below its
    // longest word and steals the space the actions needed.
    //
    // The actions block wraps INTERNALLY and is shrinkable (no
    // `flex-shrink-0`). A header whose actions are wider than the viewport on
    // their own — Contacts carries two selects, a link and a button, ~520px of
    // controls — is not fixed by moving them to a second line: that line is
    // just as narrow. They have to be able to reflow inside themselves.
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        {eyebrow && <Eyebrow color={eyebrowColor}>{eyebrow}</Eyebrow>}
        <h1 className="text-[26px] font-bold tracking-tight text-ih-fg-1 mt-1 break-words">{title}</h1>
        {meta && <p className="text-[13px] text-ih-fg-3 mt-1">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2 min-w-0">{actions}</div>}
    </div>
  );
}
