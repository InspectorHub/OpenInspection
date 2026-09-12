import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Button, Modal, Select, type SelectOption } from "@core/shared-ui";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import {
  INSPECTION_PROPERTY_TYPES,
  type InspectionPropertyType,
} from "../../../server/lib/inspection-property-type";

/** Label per canonical slug. A value added to the tuple is a compile error here. */
const LABELS: Record<InspectionPropertyType, () => string> = {
  single_family: () => m.editor_property_type_single_family(),
  multi_unit: () => m.editor_property_type_multi_unit(),
  commercial: () => m.editor_property_type_commercial(),
};

interface PropertyTypeControlProps {
  inspectionId: string;
  propertyType: string | null;
  commercialSubtype: string | null;
  reportTier: string | null;
  /** True when findings are scoped per unit — decides the second bullet below. */
  perUnitMode: boolean;
  /** True when any ASTM PCA narrative block has text. */
  hasPcaNarrative: boolean;
}

/**
 * The property-type selector — the ONLY way to reclassify an inspection after
 * intake.
 *
 * Why it exists: `inspections.property_type` is set at creation by the wizard and
 * was settable nowhere else, so a wrong pick was permanent and every inspection
 * created before the field was captured could never reach the commercial surface
 * at all. Its two siblings (`commercial_subtype`, `report_tier`) have always been
 * editable through the property-facts strip; this was the one omission.
 *
 * Why it is NOT gated on `propertyType === 'commercial'` like its neighbours: a
 * control that only appears once you are already commercial cannot be the thing
 * that gets you there. It renders for every inspection, including unclassified
 * ones.
 *
 * -- WHY LEAVING 'commercial' ASKS FIRST --------------------------------------
 * Reclassifying is not a neutral edit. Four readers branch on this column
 * (`report-tier.ts`, `pca-report-block.ts`, `building-profile.ts`, and the
 * editor's own units gate), so moving off `commercial` closes the units surface,
 * the cost-items drawer, the PCA narrative panel and the compliance panel in one
 * step. Nothing is DELETED — no cascade runs, every row stays exactly where it
 * is, and setting the type back to Commercial restores all of it — but the work
 * stops being visible, and two different things happen to two kinds of data:
 *
 *   - Cost items, PCA narrative and deviations drop off the PUBLISHED REPORT.
 *     `inspection-report.service.ts` only reads cost rows when `resolveReportTier`
 *     returns non-null, and `buildPcaReportBlock` returns null for non-commercial.
 *   - Per-unit findings and the unit list KEEP PRINTING. The report's unit
 *     payload is gated on `unit_inspection_mode`, a separate column this control
 *     does not touch — while the editor's unit switcher is gated on the property
 *     type and closes. So those findings stay on the report and become
 *     unreachable for editing. That asymmetry is the reason this modal exists
 *     rather than a silent save.
 *
 * The confirm is a DS Modal, never `window.confirm`, and mirrors the lossy
 * `per_unit → tagged` switch in `UnitsManager` — the established precedent for a
 * scope change the inspector cannot undo by hand.
 */
export function PropertyTypeControl({
  inspectionId,
  propertyType,
  commercialSubtype,
  reportTier,
  perUnitMode,
  hasPcaNarrative,
}: PropertyTypeControlProps) {
  const { submit, busy } = useGuardedSubmit();
  // A second, read-only fetcher: the cost-item count is not in the editor loader
  // (the drawer self-loads), and it is the number the inspector most needs before
  // agreeing — money already entered. Loaded only when the modal opens, through
  // the existing BFF resource route (never a client fetch to /api/...).
  const costs = useFetcher<{ items?: unknown[] }>();
  const [pending, setPending] = useState<string | null>(null);

  const current = propertyType ?? "";

  const options: SelectOption[] = [
    { value: "", label: m.editor_property_type_unclassified() },
    ...INSPECTION_PROPERTY_TYPES.map((value) => ({ value, label: LABELS[value]() })),
  ];

  /**
   * Write it. `null` rather than `''` for unclassified: the settings sanitizer
   * treats an empty string as "field unchanged" and would drop the key, so
   * clearing the classification would silently do nothing.
   */
  function save(next: string) {
    submit(
      {
        // Reuses the inspection-metadata PATCH relay deliberately. This IS a
        // metadata patch on the same endpoint the settings sheet uses, and a
        // second intent issuing the identical PATCH would be duplication.
        intent: "save-settings",
        payload: JSON.stringify({ propertyType: next === "" ? null : next }),
      },
      { method: "POST" },
    );
  }

  function onPick(next: string) {
    if (next === current) return;
    // Only the direction that closes surfaces asks. Arriving AT commercial opens
    // them and loses nothing, so it writes straight through.
    if (current === "commercial") {
      setPending(next);
      costs.load(`/resources/cost-items?inspectionId=${encodeURIComponent(inspectionId)}`);
      return;
    }
    save(next);
  }

  // Close the confirm once the write lands; the editor revalidates and this
  // component re-renders on the new classification.
  useEffect(() => {
    if (pending !== null && !busy && propertyType === (pending === "" ? null : pending)) {
      setPending(null);
    }
  }, [pending, busy, propertyType]);

  const costCount = costs.data?.items?.length ?? 0;
  const counting = costs.state !== "idle";

  return (
    <>
      <Select
        label={m.editor_property_type_label()}
        hint={m.editor_property_type_hint()}
        value={current}
        disabled={busy}
        options={options}
        onChange={(e) => onPick(e.target.value)}
        className="max-w-sm"
        data-testid="property-type-select"
      />

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={m.editor_property_type_lossy_title()}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {m.common_cancel()}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              data-testid="property-type-confirm"
              onClick={() => pending !== null && save(pending)}
            >
              {m.editor_property_type_lossy_confirm()}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[13px] text-ih-fg-2">
          <div>
            <p className="font-bold">{m.editor_property_type_lossy_report_heading()}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {/* Only what actually exists is listed. Naming a category that is
                  empty teaches the reader to skim the warning next time. */}
              {counting ? (
                <li>{m.editor_property_type_lossy_counting()}</li>
              ) : costCount > 0 ? (
                <li data-testid="lossy-cost-items">
                  {costCount === 1
                    ? m.editor_property_type_lossy_cost_one({ count: costCount })
                    : m.editor_property_type_lossy_cost_many({ count: costCount })}
                </li>
              ) : null}
              {hasPcaNarrative ? <li>{m.editor_property_type_lossy_narrative()}</li> : null}
              {commercialSubtype ? (
                <li>{m.editor_property_type_lossy_subtype({ subtype: commercialSubtype })}</li>
              ) : null}
              {reportTier ? <li>{m.editor_property_type_lossy_tier({ tier: reportTier })}</li> : null}
            </ul>
          </div>

          {perUnitMode ? (
            <div>
              <p className="font-bold">{m.editor_property_type_lossy_editor_heading()}</p>
              <p className="mt-1" data-testid="lossy-units">{m.editor_property_type_lossy_units()}</p>
            </div>
          ) : null}

          <p className="text-ih-fg-3">{m.editor_property_type_lossy_kept()}</p>
        </div>
      </Modal>
    </>
  );
}
