import { useCallback, useState } from "react";
import type { RepairActionTag } from "~/lib/repair-action-tag";
import {
  toggleSelected,
  type Defect,
  type RepairRequestItem,
} from "../RepairBuilderSection";

/**
 * The Repair Request Builder's per-item draft state and the four mutations that
 * write it.
 *
 * WHY IT IS A HOOK AND NOT PART OF THE SECTION. `RepairBuilderSection.tsx` sat
 * at exactly its file-size cap (527/527) when #275 needed a fifth field on every
 * item, so something had to move. This is the part that moves cleanly: draft
 * state plus the FormData each mutation enqueues, with no rendering and no
 * knowledge of the fetcher — the offline queue is injected as `enqueueOp`.
 *
 * ⚠️ `enqueueOp` is an ARGUMENT rather than something this hook builds, and that
 * is not a style choice. `useRepairOpQueue` needs `initialItemIds` derived from
 * the same `existingItems` this hook reads, so a hook that owned the queue would
 * have to derive that mapping too and the parent would have two sources for it.
 * The queue stays in the parent; the drafts come here.
 *
 * WHAT EVERY MUTATION HAS IN COMMON, and it is the invariant to preserve: the
 * local draft is updated FIRST and unconditionally, then an op is enqueued. The
 * builder is used on a phone in a driveway — the field has to reflect the tap
 * whether or not the request ever leaves.
 */

export interface ItemDraft {
  requestedCreditCents: number | null;
  note: string;
  /**
   * #275 — repair / replace / fund / other, or null for an untagged item.
   *
   * NULL is not "unset pending a default". The buyer chooses it or they do not,
   * and an item they never tagged must not be presented as though they had.
   */
  actionTag: RepairActionTag | null;
}

interface Args {
  existingItems: RepairRequestItem[];
  token: string | null;
  enqueueOp: (fd: FormData) => void;
}

export function useRepairItemDrafts({ existingItems, token, enqueueOp }: Args) {
  const initialSelected = new Set(existingItems.map((it) => it.findingKey));
  const initialDrafts: Record<string, ItemDraft> = {};
  for (const it of existingItems) {
    initialDrafts[it.findingKey] = {
      requestedCreditCents: it.requestedCreditCents,
      note: it.note ?? "",
      actionTag: it.repairActionTag ?? null,
    };
  }

  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>(initialDrafts);

  /** An empty draft, so a partial update never has to guess the other fields. */
  const blank = (): ItemDraft => ({ requestedCreditCents: null, note: "", actionTag: null });

  const toggleDefect = useCallback(
    (defect: Defect) => {
      const key = defect.findingKey;
      const nowSelected = !selected.has(key);

      setSelected((prev) => toggleSelected(prev, key));

      if (nowSelected) {
        // Selecting: enqueue an add-item. rrId is stamped at drain time, so this
        // works even before the list has been created.
        const fd = new FormData();
        fd.append("_token", token ?? "");
        fd.append("_intent", "add-item");
        fd.append("findingKey", key);
        fd.append("sectionTitle", defect.sectionTitle);
        fd.append("itemLabel", defect.itemLabel);
        fd.append("defectTitle", defect.defectTitle);
        if (defect.location) fd.append("location", defect.location);
        fd.append("category", defect.category);
        if (defect.trade) fd.append("trade", defect.trade);
        fd.append("commentSnapshot", defect.comment);
        const draft = drafts[key];
        if (draft?.requestedCreditCents != null) {
          fd.append("requestedCreditCents", String(draft.requestedCreditCents));
        }
        if (draft?.note) fd.append("note", draft.note);
        // Carried on the ADD as well as on its own update, because a defect can
        // be tagged, deselected and reselected — and the second add would
        // otherwise resurrect the item without the tag the buyer had chosen.
        if (draft?.actionTag) fd.append("repairActionTag", draft.actionTag);
        enqueueOp(fd);
      } else {
        // Deselecting: enqueue a remove-item. The server item id is resolved at
        // drain time via _findingKey so an add still in flight is handled.
        const fd = new FormData();
        fd.append("_token", token ?? "");
        fd.append("_intent", "remove-item");
        fd.append("_findingKey", key);
        enqueueOp(fd);
      }
    },
    [selected, token, drafts, enqueueOp],
  );

  const updateCredit = useCallback(
    (defect: Defect, cents: number | null) => {
      setDrafts((prev) => ({
        ...prev,
        [defect.findingKey]: { ...(prev[defect.findingKey] ?? blank()), requestedCreditCents: cents },
      }));
      if (cents !== null) {
        const fd = new FormData();
        fd.append("_token", token ?? "");
        fd.append("_intent", "update-item");
        fd.append("_findingKey", defect.findingKey);
        fd.append("requestedCreditCents", String(cents));
        enqueueOp(fd);
      }
    },
    [token, enqueueOp],
  );

  const updateNote = useCallback(
    (defect: Defect, note: string) => {
      setDrafts((prev) => ({
        ...prev,
        [defect.findingKey]: { ...(prev[defect.findingKey] ?? blank()), note },
      }));
      const fd = new FormData();
      fd.append("_token", token ?? "");
      fd.append("_intent", "update-item");
      fd.append("_findingKey", defect.findingKey);
      fd.append("note", note);
      enqueueOp(fd);
    },
    [token, enqueueOp],
  );

  /**
   * #275 — set or clear the action tag.
   *
   * ⚠️ Unlike `updateCredit`, this enqueues on a NULL too. Clearing a tag is a
   * real instruction — the buyer is withdrawing a stated intent — and the route
   * only forwards the field when the form carries it, so a cleared tag that was
   * never sent would stay set on the server while reading as cleared on screen.
   * `updateCredit` skips its null for the opposite reason: an empty money box is
   * the state a half-typed amount passes through, not a decision.
   */
  const updateTag = useCallback(
    (defect: Defect, tag: RepairActionTag | null) => {
      setDrafts((prev) => ({
        ...prev,
        [defect.findingKey]: { ...(prev[defect.findingKey] ?? blank()), actionTag: tag },
      }));
      const fd = new FormData();
      fd.append("_token", token ?? "");
      fd.append("_intent", "update-item");
      fd.append("_findingKey", defect.findingKey);
      fd.append("repairActionTag", tag ?? "");
      enqueueOp(fd);
    },
    [token, enqueueOp],
  );

  return { selected, setSelected, drafts, toggleDefect, updateCredit, updateNote, updateTag };
}
