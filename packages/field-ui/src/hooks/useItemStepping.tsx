import { useCallback, useMemo, type MutableRefObject } from "react";
import { ItemStepper } from "../components/editor/ItemStepper";
import { itemNeighbours, type ItemVisible, type NavSection } from "../editor/item-neighbours";
import { useEditorResume } from "./useEditorResume";

/** S and I are the editor's own section and item types: the filter and the search are typed on them, not on the bare shapes. */
interface SteppingState<S extends NavSection, I extends { id: string }> {
  inspection: { id: string | number };
  sections: ReadonlyArray<S>;
  searchNeedle?: string | undefined;
  itemPassesFilter(item: I, sectionId?: string): boolean;
  itemMatchesSearch(section: S | null, item: I): boolean;
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
export function useItemStepping<S extends NavSection, I extends { id: string }>(state: SteppingState<S, I>, notesFlush: MutableRefObject<(() => void) | null>) {
  const { selectSectionById, setActiveItemId } = state;
  const sectionId = state.currentSection?.id;
  const openPlace = useCallback((place: { sectionId: string; itemId: string }) => {
    selectSectionById(place.sectionId);
    setActiveItemId(place.itemId);
  }, [selectSectionById, setActiveItemId]);
  useEditorResume({ inspectionId: String(state.inspection.id), sections: state.sections, activeItemId: state.activeItemId, activeSectionId: sectionId, openPlace });

  const { itemPassesFilter, itemMatchesSearch, searchNeedle } = state;
  const isVisible = useCallback<ItemVisible>(
    (section, item) => itemPassesFilter(item as I, section.id) && (!searchNeedle || itemMatchesSearch(section as S, item as I)),
    [itemPassesFilter, itemMatchesSearch, searchNeedle],
  );
  const neighbours = useMemo(() => itemNeighbours(state.sections, sectionId, state.activeItemId, isVisible), [state.sections, sectionId, state.activeItemId, isVisible]);
  const stepTo = useCallback((stop: { sectionId: string; itemId: string } | null) => {
    if (!stop) return;
    notesFlush.current?.();
    // Choosing a section also ends batch mode and drops its selection: only do it when the walk really changes section.
    if (stop.sectionId !== sectionId) selectSectionById(stop.sectionId);
    setActiveItemId(stop.itemId);
    window.scrollTo?.({ top: 0 });
  }, [notesFlush, sectionId, selectSectionById, setActiveItemId]);

  const shown = state.activeView !== "property" && state.activeItemId !== null;
  const make = (className: string) => {
    if (!shown) return null;
    return <ItemStepper neighbours={neighbours} onPrev={() => stepTo(neighbours.prev)} onNext={() => stepTo(neighbours.next)} className={className} />;
  };
  /** `phone` sits above the bottom tab bar; `pane` ends the tablet's editor pane. */
  return { phone: make("sticky bottom-[var(--ih-mobile-nav-h)] z-10"), pane: make("sticky bottom-0 z-10") };
}
