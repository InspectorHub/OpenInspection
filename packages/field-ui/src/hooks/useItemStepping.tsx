import { useCallback, useMemo, type MutableRefObject } from "react";
import { ItemStepper } from "../components/editor/ItemStepper";
import { itemNeighbours, type NavSection } from "../editor/item-neighbours";
import { useEditorResume } from "./useEditorResume";

interface SteppingState {
  inspection: { id: string | number };
  sections: ReadonlyArray<NavSection>;
  currentSection?: { id: string } | undefined;
  activeItemId: string | null;
  activeView: string;
  selectSectionById(id: string): void;
  setActiveItemId(id: string | null): void;
}

/**
 * Where the editor opens (the item last used in this inspection, or the first) and the Previous / Next stepper that moves
 * between items across sections. `notesFlush` commits a half-typed note before the item changes under it.
 */
export function useItemStepping(state: SteppingState, notesFlush: MutableRefObject<(() => void) | null>) {
  const { selectSectionById, setActiveItemId } = state;
  const sectionId = state.currentSection?.id;
  const openPlace = useCallback((place: { sectionId: string; itemId: string }) => {
    selectSectionById(place.sectionId);
    setActiveItemId(place.itemId);
  }, [selectSectionById, setActiveItemId]);
  useEditorResume({ inspectionId: String(state.inspection.id), sections: state.sections, activeItemId: state.activeItemId, activeSectionId: sectionId, openPlace });

  const neighbours = useMemo(() => itemNeighbours(state.sections, sectionId, state.activeItemId), [state.sections, sectionId, state.activeItemId]);
  const stepTo = useCallback((stop: { sectionId: string; itemId: string } | null) => {
    if (!stop) return;
    notesFlush.current?.();
    selectSectionById(stop.sectionId);
    setActiveItemId(stop.itemId);
    window.scrollTo?.({ top: 0 });
  }, [notesFlush, selectSectionById, setActiveItemId]);

  const shown = state.activeView !== "property" && state.activeItemId !== null;
  const make = (className: string) => shown ? <ItemStepper neighbours={neighbours} onPrev={() => stepTo(neighbours.prev)} onNext={() => stepTo(neighbours.next)} className={className} /> : null;
  /** `phone` sits above the bottom tab bar; `pane` ends the tablet's editor pane. */
  return { phone: make("sticky bottom-[var(--ih-mobile-nav-h)] z-10"), pane: make("sticky bottom-0 z-10") };
}
