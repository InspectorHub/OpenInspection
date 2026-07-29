import { useState } from "react";
import { useFetcher } from "react-router";
import { Card, Button, Modal } from "@core/shared-ui";
import { BlockHeading } from "./BlockHeading";
import { MoneyInput } from "~/components/MoneyInput";
import { formatCents } from "~/lib/hub-blocks";
import { m } from "~/paraglide/messages";
import type { action } from "~/routes/inspection-hub";

export interface ServiceLine {
    id: string;
    serviceId: string;
    name: string;
    // IA-95 — all three are absent when the caller lacks the `financial`
    // capability. The LINE itself (what was sold) is still legitimately theirs
    // to see; only the figures are withheld.
    priceCents?: number;
    priceSnapshot?: number;
    priceOverride?: number | null;
}

export interface CatalogService {
    id: string;
    name: string;
    price: number;
}

/**
 * What this inspection is billed for (IA-87).
 *
 * `inspection_services` rows were written once, at creation, and never again:
 * the booking flow and the new-inspection wizard could book services, and after
 * that the set was frozen. This card showed them and offered nothing — an
 * inspection created without services displayed "No services have been added"
 * beside no way to add one, and the only remaining lever on the money was the
 * denormalized `inspections.price` cache, edited from a panel inside the report
 * editor behind an unlabelled gear.
 *
 * Money verbs are owner/manager, matching what the API enforces: a card must
 * never offer an action the server refuses.
 *
 * IA-95 — a caller without the `financial` capability (an inspector's default)
 * gets the LINES but not the figures: what was sold is theirs to see, what it
 * cost is not. The figures are redacted server-side, so this component reads
 * their absence rather than re-deriving the permission.
 */
export function ServicesCard({
    services,
    catalog,
    canManage,
}: {
    services: ServiceLine[];
    catalog: CatalogService[];
    canManage: boolean;
}) {
    const addFetcher = useFetcher<typeof action>();
    const priceFetcher = useFetcher<typeof action>();
    const removeFetcher = useFetcher<typeof action>();

    const [addOpen, setAddOpen] = useState(false);
    const [repricing, setRepricing] = useState<ServiceLine | null>(null);
    const [removing, setRemoving] = useState<ServiceLine | null>(null);

    // IA-95 — absence of the figures IS the signal that money is redacted; we
    // do not carry a second client-side copy of the capability that could
    // disagree with what the server actually sent. Every money affordance
    // (total, per-line figure, reprice, the add modal's price field) hangs off
    // this one derivation.
    const showMoney = services.every((s) => s.priceCents !== undefined);
    const total = showMoney ? services.reduce((sum, s) => sum + (s.priceCents ?? 0), 0) : undefined;
    const booked = new Set(services.map((s) => s.serviceId));
    const available = catalog.filter((c) => !booked.has(c.id));

    // The route action's union includes `search-contacts`, which carries no
    // ok/error at all — narrow on the intents this card actually submits.
    const error = [addFetcher, priceFetcher, removeFetcher]
        .map((f) => {
            const d = f.state === "idle" ? f.data : undefined;
            if (!d || !("ok" in d) || d.ok) return undefined;
            return d.intent?.startsWith("service-") ? d.error : undefined;
        })
        .find(Boolean);

    return (
        <Card className="p-5">
            <BlockHeading title={m.inspections_hub_block_services()} />

            {services.length === 0 ? (
                // Compact, like every other card's empty case — a full EmptyState in
                // a half-width card is a tall pane of whitespace beside neighbours
                // that are three lines high.
                <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_services_empty_desc()}</p>
            ) : (
                <div className="divide-y divide-ih-border">
                    {services.map((svc) => (
                        <div key={svc.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                            <span className="text-ih-fg-1 min-w-0 truncate">{svc.name}</span>
                            <span className="flex items-center gap-2 shrink-0">
                                {svc.priceCents !== undefined && (
                                    <span className="text-ih-fg-2 font-medium tabular-nums">
                                        {formatCents(svc.priceCents)}
                                    </span>
                                )}
                                {canManage && (
                                    <>
                                        {showMoney && (
                                        <button
                                            type="button"
                                            onClick={() => setRepricing(svc)}
                                            className="text-[12px] font-bold text-ih-primary hover:underline"
                                        >
                                            {m.inspections_hub_services_edit_price()}
                                        </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setRemoving(svc)}
                                            className="text-[12px] font-bold text-ih-fg-3 hover:text-ih-bad-fg hover:underline"
                                        >
                                            {m.inspections_hub_services_remove()}
                                        </button>
                                    </>
                                )}
                            </span>
                        </div>
                    ))}
                    {total !== undefined && (
                        <div className="flex items-center justify-between py-2 text-[13px] font-bold">
                            <span className="text-ih-fg-1">{m.inspections_hub_services_total()}</span>
                            <span className="text-ih-fg-1 tabular-nums">{formatCents(total)}</span>
                        </div>
                    )}
                </div>
            )}

            {error && <p className="text-[12px] text-ih-bad-fg mt-3">{error}</p>}

            {canManage && (
                <div className="mt-4">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setAddOpen(true)}
                        disabled={addFetcher.state !== "idle"}
                    >
                        {m.inspections_hub_services_add()}
                    </Button>
                </div>
            )}

            <AddServiceModal
                open={addOpen}
                available={available}
                catalogEmpty={catalog.length === 0}
                submitting={addFetcher.state !== "idle"}
                onClose={() => setAddOpen(false)}
                onAdd={(serviceId, cents) => {
                    addFetcher.submit(
                        {
                            intent: "service-add",
                            serviceId,
                            priceOverrideCents: cents == null ? "" : String(cents),
                        },
                        { method: "post" },
                    );
                    setAddOpen(false);
                }}
            />

            <RepriceModal
                line={repricing}
                submitting={priceFetcher.state !== "idle"}
                onClose={() => setRepricing(null)}
                onSave={(lineId, cents) => {
                    priceFetcher.submit(
                        {
                            intent: "service-price",
                            lineId,
                            priceOverrideCents: cents == null ? "" : String(cents),
                        },
                        { method: "post" },
                    );
                    setRepricing(null);
                }}
            />

            {/* A modal, never window.confirm — removing a line changes what the
                client is billed, so the name has to be in the question. */}
            <Modal
                open={!!removing}
                onClose={() => setRemoving(null)}
                title={m.inspections_hub_services_remove_title()}
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" size="sm" onClick={() => setRemoving(null)}>
                            {m.common_cancel()}
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={removeFetcher.state !== "idle"}
                            onClick={() => {
                                if (!removing) return;
                                removeFetcher.submit(
                                    { intent: "service-remove", lineId: removing.id },
                                    { method: "post" },
                                );
                                setRemoving(null);
                            }}
                        >
                            {m.inspections_hub_services_remove()}
                        </Button>
                    </>
                }
            >
                <p className="text-[13px] text-ih-fg-2">
                    {m.inspections_hub_services_remove_body({ name: removing?.name ?? "" })}
                </p>
            </Modal>
        </Card>
    );
}

/* ------------------------------------------------------------------ */

function AddServiceModal({
    open,
    available,
    catalogEmpty,
    submitting,
    onClose,
    onAdd,
}: {
    open: boolean;
    available: CatalogService[];
    catalogEmpty: boolean;
    submitting: boolean;
    onClose: () => void;
    onAdd: (serviceId: string, priceOverrideCents: number | null) => void;
}) {
    const [serviceId, setServiceId] = useState("");
    const [cents, setCents] = useState<number | null>(null);

    // The price field seeds from the chosen service's catalog price, so the
    // common case (bill the usual amount) is zero typing and the override case
    // is an edit rather than a blank you have to look up.
    const choose = (id: string) => {
        setServiceId(id);
        setCents(available.find((s) => s.id === id)?.price ?? null);
    };

    if (!open) return null;

    const chosen = available.find((s) => s.id === serviceId);
    const isOverride = !!chosen && cents != null && cents !== chosen.price;

    return (
        <Modal
            open
            onClose={onClose}
            title={m.inspections_hub_services_add_title()}
            footer={
                <>
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        {m.common_cancel()}
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        disabled={!serviceId || submitting}
                        onClick={() => onAdd(serviceId, isOverride ? cents : null)}
                    >
                        {m.inspections_hub_services_add()}
                    </Button>
                </>
            }
        >
            {catalogEmpty ? (
                <p className="text-[13px] text-ih-fg-3">{m.inspections_hub_services_catalog_empty()}</p>
            ) : available.length === 0 ? (
                <p className="text-[13px] text-ih-fg-3">{m.inspections_hub_services_all_added()}</p>
            ) : (
                <div className="space-y-4">
                    <label className="block">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
                            {m.inspections_hub_services_field_service()}
                        </span>
                        <select
                            value={serviceId}
                            onChange={(e) => choose(e.target.value)}
                            className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none"
                            data-testid="hub-add-service-select"
                        >
                            {/* Not the field's own label again — a placeholder
                                that repeats the label says nothing. */}
                            <option value="">{m.inspections_hub_services_select()}</option>
                            {available.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name} — {formatCents(s.price)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
                            {m.inspections_hub_services_field_price()}
                        </span>
                        <MoneyInput
                            cents={cents}
                            onChange={setCents}
                            disabled={!serviceId}
                            className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none"
                            ariaLabel={m.inspections_hub_services_field_price()}
                        />
                        <span className="mt-1 block text-[11px] text-ih-fg-4">
                            {m.inspections_hub_services_price_hint()}
                        </span>
                    </label>
                </div>
            )}
        </Modal>
    );
}

/* ------------------------------------------------------------------ */

function RepriceModal({
    line,
    submitting,
    onClose,
    onSave,
}: {
    line: ServiceLine | null;
    submitting: boolean;
    onClose: () => void;
    onSave: (lineId: string, priceOverrideCents: number | null) => void;
}) {
    const [cents, setCents] = useState<number | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);

    if (!line) return null;

    // Seed on first render for THIS line: keyed by id so reopening on a
    // different row re-seeds instead of carrying the last row's figure over.
    if (editingId !== line.id) {
        setEditingId(line.id);
        setCents(line.priceCents ?? null);
    }

    return (
        <Modal
            open
            onClose={onClose}
            title={m.inspections_hub_services_price_title()}
            size="sm"
            footer={
                <>
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        {m.common_cancel()}
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        disabled={submitting}
                        onClick={() => onSave(line.id, cents === (line.priceSnapshot ?? null) ? null : cents)}
                    >
                        {m.common_save()}
                    </Button>
                </>
            }
        >
            <p className="text-[13px] font-semibold text-ih-fg-1 mb-3">{line.name}</p>
            <MoneyInput
                cents={cents}
                onChange={setCents}
                className="w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none"
                ariaLabel={m.inspections_hub_services_field_price()}
            />
            <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-ih-fg-4">
                    {m.inspections_hub_services_price_catalog({ price: formatCents(line.priceSnapshot ?? 0) })}
                </span>
                {line.priceOverride !== null && (
                    <button
                        type="button"
                        onClick={() => setCents(line.priceSnapshot ?? null)}
                        className="text-[11px] font-bold text-ih-primary hover:underline"
                    >
                        {m.inspections_hub_services_price_revert()}
                    </button>
                )}
            </div>
        </Modal>
    );
}
