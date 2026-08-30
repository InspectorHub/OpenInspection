import { useId, useState } from "react";
import { Card, Input } from "@core/shared-ui";

import { m } from "~/paraglide/messages";

/**
 * The inspection-level answers an authority's form asks for and nothing else in
 * this product does.
 *
 * ── WHY IT IS HERE AND NOT IN THE PROPERTY FORM ─────────────────────────────
 * Every field on this card exists for one document. Putting them in
 * `PropertyInfoForm` would make every inspector who never files a statutory
 * form fill in — or scroll past — eight boxes that will never be printed
 * anywhere. So the card renders only where the template declares a form, and it
 * says so in its own subtitle rather than leaving the reader to work out why it
 * appeared.
 *
 * ── 🔴 THE OWNER IS NOT THE CLIENT, AND THE CARD SAYS SO ────────────────────
 * The inspection already knows a client, and the tempting kindness is to
 * pre-fill the owner from them. A buyer commissions the inspection and the
 * seller owns the house — that is the ordinary case, not the edge one — so a
 * pre-filled owner would be wrong most of the time and would look answered.
 * Nothing is pre-filled, and the group's own hint explains the distinction to
 * the person deciding what to type.
 *
 * ── 🔴 THE SIGNING DATE IS NOT THE INSPECTION DATE ──────────────────────────
 * Both are printed on the Citizens roof form, in different boxes, and signing
 * commonly happens days after the visit. The field's hint says which one this
 * is, because on the form itself the box is labelled with the single word
 * "Date".
 *
 * ── SAVING: A WHOLE SNAPSHOT, ON BLUR ───────────────────────────────────────
 * `PropertyInfoForm`'s convention, and for its reason: every commit carries the
 * full set, so one shared fetcher is abort-safe — a later submit is a superset
 * of any in-flight one, and a cancelled earlier request loses nothing. Per-field
 * PATCHes through one fetcher lose whichever field was in flight.
 */
export interface StatutoryDetailsValues {
    inspectorSignatureDate: string | null;
    employeePrintedName: string | null;
    ownerName: string | null;
    ownerEmail: string | null;
    ownerMailingAddress: string | null;
    ownerHomePhone: string | null;
    ownerWorkPhone: string | null;
    ownerCellPhone: string | null;
}

export interface StatutoryDetailsPanelProps {
    details: StatutoryDetailsValues;
    /** Called on blur with the whole set. The parent persists it. */
    onCommit: (details: StatutoryDetailsValues) => void;
    /** True while this panel's own request is in flight. */
    saving?: boolean;
}

type Field = keyof StatutoryDetailsValues;

export function StatutoryDetailsPanel({ details, onCommit, saving = false }: StatutoryDetailsPanelProps) {
    // Seeded once and owned locally afterwards. Re-seeding from the prop on
    // every render would fight the inspector's typing the moment a revalidation
    // lands mid-field.
    const [draft, setDraft] = useState<StatutoryDetailsValues>(details);
    const ids = useId();

    const set = (field: Field) => (value: string) => {
        setDraft((prev) => ({ ...prev, [field]: value }));
    };
    // The whole draft, so the request is a superset of any earlier one.
    const commit = () => onCommit(draft);

    const field = (
        name: Field,
        label: string,
        hint?: string,
        type: "text" | "date" | "email" | "tel" = "text",
    ) => (
        <Input
            id={`${ids}-${name}`}
            label={label}
            hint={hint}
            type={type}
            value={draft[name] ?? ""}
            onChange={(e) => set(name)(e.target.value)}
            onBlur={commit}
            disabled={saving}
        />
    );

    return (
        <Card className="p-5 space-y-4" data-testid="statutory-details-panel">
            <div>
                <h3 className="text-[15px] font-bold text-ih-fg-1">
                    {m.statutory_details_title()}
                </h3>
                <p className="mt-1 text-[12px] text-ih-fg-3">{m.statutory_details_subtitle()}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                {field(
                    "inspectorSignatureDate",
                    m.statutory_details_signature_date(),
                    m.statutory_details_signature_date_hint(),
                    "date",
                )}
                {field(
                    "employeePrintedName",
                    m.statutory_details_employee_name(),
                    m.statutory_details_employee_name_hint(),
                )}
            </div>

            <div className="border-t border-ih-border pt-4">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-3">
                    {m.statutory_details_owner_group()}
                </h4>
                <p className="mt-1 mb-3 text-[12px] text-ih-fg-3">
                    {m.statutory_details_owner_group_hint()}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                    {field("ownerName", m.statutory_details_owner_name())}
                    {field("ownerEmail", m.statutory_details_owner_email(), undefined, "email")}
                    {field(
                        "ownerMailingAddress",
                        m.statutory_details_owner_mailing_address(),
                        m.statutory_details_owner_mailing_address_hint(),
                    )}
                    {field("ownerHomePhone", m.statutory_details_owner_home_phone(), undefined, "tel")}
                    {field("ownerWorkPhone", m.statutory_details_owner_work_phone(), undefined, "tel")}
                    {field("ownerCellPhone", m.statutory_details_owner_cell_phone(), undefined, "tel")}
                </div>
            </div>
        </Card>
    );
}
