/**
 * Persistence queue for the Repair Request Builder's per-item mutations.
 *
 * Extracted from <RepairBuilderSection> (pure movement — same refs, same
 * effects, same ordering). It is the only stateful concern in that component
 * that is not rendering, and it is the one with the invariants worth reading in
 * isolation:
 *
 * Item operations (add / remove / update) are serialized through ONE
 * mutationFetcher so concurrent rapid clicks don't clobber each other's
 * in-flight submission (useFetcher is single-flight). Each queued op is a plain
 * FormData; we drain the queue head whenever the fetcher is idle AND a list id
 * exists. List creation is lazy but GUARDED so rapid toggles before the
 * round-trip returns create exactly one list (no double-create race).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

interface RepairOpQueue {
  /** Server id of the caller's repair-request list, once it exists. */
  rrId: string | null;
  /** Queue a FormData op; creates the list first if there isn't one yet. */
  enqueueOp: (fd: FormData) => void;
  /** Error text from the last settled item op, if it failed. */
  mutationError: string | undefined;
}

export function useRepairOpQueue({
  initialRrId,
  initialItemIds,
  token,
  actionPath,
}: {
  initialRrId: string | null;
  /** findingKey → server item id, from the items the loader already returned. */
  initialItemIds: Record<string, string>;
  token: string | null;
  actionPath: string;
}): RepairOpQueue {
  const [rrId, setRrId] = useState<string | null>(initialRrId);

  const createFetcher = useFetcher<{ ok?: boolean; error?: string; data?: unknown }>();
  const mutationFetcher = useFetcher<{ ok?: boolean; error?: string; data?: unknown }>();

  // findingKey → server item id. Kept in a ref (not state) because reads must see
  // the freshest map synchronously inside queued ops, and updates from add-item
  // responses must not depend on a stale render closure.
  const itemIdsRef = useRef<Record<string, string>>(initialItemIds);
  const rrIdRef = useRef<string | null>(initialRrId);
  rrIdRef.current = rrId;
  const opQueueRef = useRef<FormData[]>([]);
  const creatingRef = useRef(false);
  // Tracks the findingKey of an in-flight add-item so we can record its server
  // id from the response (the response also echoes findingKey, used as backup).
  const inFlightAddKeyRef = useRef<string | null>(null);

  const drainQueue = useCallback(() => {
    if (mutationFetcher.state !== "idle") return;
    if (!rrIdRef.current) return;
    let next = opQueueRef.current.shift();
    while (next) {
      const intent = next.get("_intent");
      // For ops keyed by findingKey (remove / update), resolve the server item id
      // at DRAIN time so an add that completed earlier in the queue is visible.
      if (intent === "remove-item" || intent === "update-item") {
        const fk = String(next.get("_findingKey") ?? "");
        const itemId = fk ? itemIdsRef.current[fk] : (next.get("itemId") as string | null);
        if (!itemId) {
          // ⚠️ TWO DIFFERENT SITUATIONS LOOK IDENTICAL HERE, and treating them the
          // same lost the client's edits.
          //
          // This branch used to drop the op unconditionally, justified by one
          // case — "added and removed before its add resolved". But it also
          // caught the case where the add is STILL IN FLIGHT and about to
          // succeed, which is the ordinary path: tick a defect, then immediately
          // choose an action or type a note. The op was discarded with the row
          // still showing the choice, no error, and the column left NULL.
          //
          // It is reachable because `drainQueue`'s own `state !== "idle"` guard
          // reads a value CAPTURED at render, while a click handler can hold a
          // closure from before the add was submitted. `inFlightAddKeyRef` is a
          // ref, so it reads the truth at call time — which is why the check
          // below uses it rather than the fetcher state.
          const addPending =
            inFlightAddKeyRef.current === fk ||
            opQueueRef.current.some(
              (op) => op.get("_intent") === "add-item" && String(op.get("findingKey") ?? "") === fk,
            );
          if (addPending) {
            // Put it back at the FRONT and stop draining. The settle effect
            // drains again once the add resolves, and by then the id is known.
            // Order matters: a later update for the same item must not overtake
            // this one.
            opQueueRef.current.unshift(next);
            return;
          }
          // No add pending, so this item will never exist on the server —
          // genuinely nothing to do. This also bounds the deferral: a FAILED add
          // clears the ref, so the next drain reaches here and drops instead of
          // requeueing forever.
          next = opQueueRef.current.shift();
          continue;
        }
        next.set("itemId", itemId);
      }
      // Stamp the resolved rrId at submit time (it may not have existed when the
      // op was enqueued).
      next.set("rrId", rrIdRef.current);
      inFlightAddKeyRef.current =
        intent === "add-item" ? String(next.get("findingKey") ?? "") : null;
      mutationFetcher.submit(next, { method: "post", action: actionPath });
      return;
    }
  }, [mutationFetcher, actionPath]);

  const enqueueOp = useCallback(
    (fd: FormData) => {
      opQueueRef.current.push(fd);
      // Lazily create the list once if it doesn't exist yet. Guarded so a burst
      // of selections fires a single create-list, not one per click.
      if (!rrIdRef.current && !creatingRef.current) {
        creatingRef.current = true;
        const createFd = new FormData();
        createFd.append("_token", token ?? "");
        createFd.append("_intent", "create-list");
        createFetcher.submit(createFd, { method: "post", action: actionPath });
      }
      drainQueue();
    },
    [token, createFetcher, drainQueue, actionPath],
  );

  // Capture the new rrId from create-list, then drain any queued ops.
  useEffect(() => {
    if (
      createFetcher.state === "idle" &&
      createFetcher.data?.ok &&
      createFetcher.data?.data
    ) {
      const newRr = createFetcher.data.data as { id?: string };
      creatingRef.current = false;
      if (newRr?.id && !rrIdRef.current) {
        rrIdRef.current = newRr.id;
        setRrId(newRr.id);
      }
      drainQueue();
    } else if (createFetcher.state === "idle" && createFetcher.data && !createFetcher.data.ok) {
      // Create failed — release the guard so a later toggle can retry.
      creatingRef.current = false;
    }
  }, [createFetcher.state, createFetcher.data, drainQueue]);

  // After each item op settles: record add-item ids, then drain the next op.
  useEffect(() => {
    if (mutationFetcher.state !== "idle") return;
    const data = mutationFetcher.data;
    if (data?.ok && inFlightAddKeyRef.current && data.data) {
      const item = data.data as { id?: string; findingKey?: string };
      const key = item.findingKey ?? inFlightAddKeyRef.current;
      if (item.id && key) {
        itemIdsRef.current = { ...itemIdsRef.current, [key]: item.id };
      }
    }
    inFlightAddKeyRef.current = null;
    drainQueue();
  }, [mutationFetcher.state, mutationFetcher.data, drainQueue]);

  return { rrId, enqueueOp, mutationError: mutationFetcher.data?.error };
}
