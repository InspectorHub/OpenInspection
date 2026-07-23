/**
 * Single source of truth for reading one template item's stored result entry
 * out of `inspection_results.data`.
 *
 * Entries are keyed by the composite `findingKey(_default, sectionId, itemId)`
 * (`"_default:{sectionId}:{itemId}"`), with a bare-`itemId` fallback for any
 * pre-composite-key rows. Getting either half wrong reads nothing: the report
 * service had this right, but the agent-recommendations path keyed by bare
 * itemId AND skipped the `.tabs` layer, so `/agent-recommendations` came back
 * empty for every agent regardless of how many defects existed (IA-31). Both
 * sides now go through here so the read cannot drift apart again.
 */
import { findingKey, DEFAULT_UNIT } from './finding-key';
import type { ItemEntry, DefectState, ResultsProjection } from './collab/results-doc.types';

/** The stored entry for one item, or an empty entry when nothing is recorded. */
export function readItemEntry(
    resultData: ResultsProjection,
    sectionId: string,
    itemId: string,
): ItemEntry {
    return resultData[findingKey(DEFAULT_UNIT, sectionId, itemId)] || resultData[itemId] || {};
}

/** The per-defect field states for one item — the `.tabs.defects` list. */
export function readItemDefectStates(
    resultData: ResultsProjection,
    sectionId: string,
    itemId: string,
): DefectState[] {
    return readItemEntry(resultData, sectionId, itemId).tabs?.defects ?? [];
}
