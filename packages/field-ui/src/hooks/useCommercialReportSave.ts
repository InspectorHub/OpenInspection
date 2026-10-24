import { useFieldCommand } from '../context';

export type CommercialReportTier = 'light_commercial' | 'full_pca';

export interface CommercialReportSave {
  /** True while either write is out: the controls' `saving`. */
  saving: boolean;
  changeSubtype(subtype: string | null): void;
  changeTier(tier: CommercialReportTier): void;
}

/**
 * The commercial subtype and report-tier selectors. Each persists through `save-property-facts` with its own
 * one-key payload.
 *
 * One command EACH, never one shared: a command refuses a second call while one is in flight, so a shared
 * instance would let a tier click be swallowed by an in-flight subtype save (the two sit side by side).
 *
 * `onOptimistic` moves the local copy, and it is called ONLY when the write was accepted: an optimistic update
 * on a dropped call is the silent divergence between screen and server this guard exists to stop. The
 * acceptance is read from the guard itself (`isBusy`) before `run` starts, because `run` answers on a later
 * tick. A write the server refuses leaves the optimistic copy on screen, as it always did.
 */
export function useCommercialReportSave(
  inspectionId: string,
  onOptimistic: (patch: { commercialSubtype: string | null } | { reportTier: CommercialReportTier }) => void,
): CommercialReportSave {
  const subtype = useFieldCommand(inspectionId);
  const tier = useFieldCommand(inspectionId);
  return {
    saving: subtype.busy || tier.busy,
    changeSubtype(next) {
      if (subtype.isBusy()) return;
      onOptimistic({ commercialSubtype: next });
      void subtype.run({ type: 'save-property-facts', payload: { commercialSubtype: next } });
    },
    changeTier(next) {
      if (tier.isBusy()) return;
      onOptimistic({ reportTier: next });
      void tier.run({ type: 'save-property-facts', payload: { reportTier: next } });
    },
  };
}
