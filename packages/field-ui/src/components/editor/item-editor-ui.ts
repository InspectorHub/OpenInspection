import { useCallback, useState } from 'react';
import type { CustomDefectCategory } from '../../shared/custom-defects';
import type { DefectTrade } from '../../shared/defect-fields';
import type { CannedTabId } from './CannedCommentTabs';

/**
 * The item editor's own interface state: the open canned tab, the defect search box and the custom-defect form.
 * It is state about ONE item's editor, not about the inspection, but it must outlive the component instance: a
 * rotation across a layout breakpoint swaps the whole tree and mounts a new `ItemEditor`, and a half-typed
 * custom defect must not be lost with the old one.
 */
export interface ItemEditorUi {
  activeTab: CannedTabId;
  defectQuery: string;
  customFormOpen: boolean;
  customTitle: string;
  customComment: string;
  customCategory: CustomDefectCategory;
  /** "" means the inspector picked no trade; the defect is written without the key. */
  customTrade: DefectTrade | '';
  saveToLibrary: boolean;
}

const INITIAL_ITEM_EDITOR_UI: ItemEditorUi = {
  activeTab: 'information',
  defectQuery: '',
  customFormOpen: false,
  customTitle: '',
  customComment: '',
  customCategory: 'recommendation',
  customTrade: '',
  saveToLibrary: false,
};

/** Where an `ItemEditor` keeps its interface state. `patch` merges into the CURRENT state, so several calls in one handler all land. */
export interface ItemEditorUiControl {
  ui: ItemEditorUi;
  patch: (change: Partial<ItemEditorUi>) => void;
}

/** The owner's store (the editor shell holds it): one entry per item id, so each item keeps its own half-typed form. */
export function useItemEditorUiStore(): (itemId: string) => ItemEditorUiControl {
  const [byItem, setByItem] = useState<Record<string, ItemEditorUi>>({});
  return useCallback(
    (itemId: string) => ({
      ui: byItem[itemId] ?? INITIAL_ITEM_EDITOR_UI,
      patch: (change) => setByItem((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] ?? INITIAL_ITEM_EDITOR_UI), ...change } })),
    }),
    [byItem],
  );
}

/** The state values and their setters. Uses the owner's store when one is given, else the component's own state. */
export function useItemEditorUi(external?: ItemEditorUiControl) {
  const [own, setOwn] = useState<ItemEditorUi>(INITIAL_ITEM_EDITOR_UI);
  const ctl: ItemEditorUiControl = external ?? { ui: own, patch: (change) => setOwn((prev) => ({ ...prev, ...change })) };
  return {
    ...ctl.ui,
    setActiveTab: (activeTab: CannedTabId) => ctl.patch({ activeTab }),
    setDefectQuery: (defectQuery: string) => ctl.patch({ defectQuery }),
    setCustomFormOpen: (customFormOpen: boolean) => ctl.patch({ customFormOpen }),
    setCustomTitle: (customTitle: string) => ctl.patch({ customTitle }),
    setCustomComment: (customComment: string) => ctl.patch({ customComment }),
    setCustomCategory: (customCategory: CustomDefectCategory) => ctl.patch({ customCategory }),
    setCustomTrade: (customTrade: DefectTrade | '') => ctl.patch({ customTrade }),
    setSaveToLibrary: (saveToLibrary: boolean) => ctl.patch({ saveToLibrary }),
  };
}
