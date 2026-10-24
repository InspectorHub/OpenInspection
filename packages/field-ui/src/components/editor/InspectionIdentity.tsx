import { m } from "../../i18n";

export interface InspectionIdentityProps {
  address: string | null | undefined;
  id: string;
  /** The inspection date, already formatted for display. */
  date?: string | null;
  status: string;
}

/**
 * Which inspection this is: the property address, its short number and date, and its status badge. The desktop
 * header carries the same facts; the tablet layout shows them at the top of the list pane.
 */
export function InspectionIdentity({ address, id, date, status }: InspectionIdentityProps) {
  return (
    <div data-testid="inspection-identity" className="flex items-center gap-2 px-3 py-2 border-b border-ih-border min-w-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold truncate">{address || m.editor_header_property_fallback()}</div>
        <div className="text-[11px] text-ih-fg-3 truncate">
          #{id.slice(0, 8).toUpperCase()}
          {date && <span className="ml-2">{date}</span>}
        </div>
      </div>
      <span className="shrink-0 px-2 h-6 rounded-md text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset bg-ih-bg-muted text-ih-fg-2 ring-ih-border inline-flex items-center">
        {status}
      </span>
    </div>
  );
}
