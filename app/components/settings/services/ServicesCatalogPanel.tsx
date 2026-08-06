import { Form } from "react-router";
import { Table } from "@core/shared-ui";
import { QualificationWidget } from "./QualificationWidget";
import { PayRuleWidget } from "./PayRuleWidget";
import type { PayRule } from "./PayRuleWidget";
import { splitDurationMinutes, serviceIsBookable } from "~/lib/settings-services";
import { m } from "~/paraglide/messages";

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  active: boolean;
  durationMinutes: number | null;
  templateId: string | null;
}

interface Member {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

interface ServicesCatalogPanelProps {
  services: Service[];
  restrictionMap: Record<string, string[]>;
  /** serviceId -> its pay rules. Empty means pay splits are off for that service. */
  payRuleMap: Record<string, PayRule[]>;
  members: Member[];
  /** templateId → template name, for naming the template each service builds from. */
  templateNames: Record<string, string>;
  /** The row whose edit form is open, so its own Edit reads as the way back. */
  editingId?: string | null;
  onEdit?: (id: string | null) => void;
}

/** "1h 30m" / "1h" / "45m", or "Not set" when the service carries none. Compact
 *  because the DURATION column is narrow enough that "1 hr 30 min" wrapped. */
function durationLabel(minutes: number | null): string {
  const split = splitDurationMinutes(minutes);
  if (!split) return m.settings_services_duration_unset();
  if (split.hours && split.minutes) return m.settings_services_duration_hm(split);
  if (split.hours) return m.settings_services_duration_h({ hours: split.hours });
  return m.settings_services_duration_m({ minutes: split.minutes });
}

export function ServicesCatalogPanel({
  services,
  restrictionMap,
  payRuleMap,
  members,
  templateNames,
  editingId = null,
  onEdit,
}: ServicesCatalogPanelProps) {
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
      <Table<Service>
        rows={services}
        getRowKey={(svc) => svc.id}
        empty={
          <p className="py-10 text-center text-[13px] text-ih-fg-3">
            {m.settings_services_empty()}
          </p>
        }
        columns={[
          {
            label: m.settings_services_col_name(),
            cell: (svc) => (
              <>
                <p className="text-[13px] font-medium text-ih-fg-1">{svc.name}</p>
                {svc.description && (
                  <p className="text-[11px] text-ih-fg-3 mt-0.5 line-clamp-1">{svc.description}</p>
                )}
                {/* A service with no template takes down any booking that picks
                    it (BadRequest from the multi-service branch, shown to the
                    customer). Say so here, where it can be fixed. */}
                {serviceIsBookable(svc) ? (
                  <p className="text-[11px] text-ih-fg-3 mt-0.5">
                    {m.settings_services_template_prefix()}{" "}
                    {templateNames[svc.templateId ?? ""] ?? svc.templateId}
                  </p>
                ) : (
                  <p className="text-[11px] text-ih-bad-fg mt-0.5">
                    {m.settings_services_no_template_warning()}
                  </p>
                )}
                <QualificationWidget
                  service={svc}
                  initialUserIds={restrictionMap[svc.id] ?? []}
                  members={members}
                />
                {/* Directly below the qualification line: who may run this,
                    and what they earn running it, are one thought. */}
                <PayRuleWidget
                  serviceId={svc.id}
                  rules={payRuleMap[svc.id] ?? []}
                  members={members}
                />
              </>
            ),
          },
          {
            label: m.settings_services_col_duration(),
            // `whitespace-nowrap`: a duration is one token. Compacting the
            // English (see durationLabel) was not enough — es-419 "2 h 30 min"
            // has spaces to break at and split as "2 h 30 / min".
            cell: (svc) => (
              <span className={`whitespace-nowrap ${svc.durationMinutes ? "text-ih-fg-2" : "text-ih-fg-3"}`}>
                {durationLabel(svc.durationMinutes)}
              </span>
            ),
          },
          {
            label: m.settings_services_col_price(),
            cell: (svc) => <span className="font-bold text-ih-ok-fg">${((svc.price || 0) / 100).toFixed(2)}</span>,
          },
          {
            label: m.settings_services_col_status(),
            cell: (svc) => (
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                svc.active
                  ? "bg-ih-ok-bg text-ih-ok-fg"
                  : "bg-ih-bg-muted text-ih-fg-3"
              }`}>
                {svc.active ? m.settings_discount_active() : m.settings_services_inactive()}
              </span>
            ),
          },
          {
            label: m.settings_services_col_actions(),
            align: "right",
            // Both of a row's actions live in the ACTIONS column. Edit used to
            // sit inside the NAME cell — and edited only the qualified-inspector
            // list, which is now labelled for what it does.
            cell: (svc) => (
              <div className="flex items-center justify-end gap-3">
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(editingId === svc.id ? null : svc.id)}
                    className="text-[12px] font-semibold text-ih-primary hover:underline"
                  >
                    {editingId === svc.id ? m.common_cancel() : m.settings_services_edit()}
                  </button>
                )}
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="toggle-service" />
                  <input type="hidden" name="id" value={svc.id} />
                  <input type="hidden" name="active" value={String(svc.active)} />
                  <button type="submit" className="text-[12px] font-semibold text-ih-primary hover:underline">
                    {svc.active ? m.settings_services_deactivate() : m.settings_services_activate()}
                  </button>
                </Form>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
