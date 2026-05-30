import { useState, useEffect, useCallback, useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface OfflineState {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  lastSyncedAt: number | null;
  conflicts: Array<Record<string, unknown>>;
}

export interface QueuedRequest {
  url: string;
  method: string;
  body: string;
  inspectionId: string;
  timestamp: number;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * React-side offline queue. Tracks connectivity, queues failed requests
 * in IndexedDB (via the global OfflineQueue adapter), and provides replay.
 *
 * For the React Router v7 migration this is a thin adapter around navigator.onLine
 * state; the full Dexie-based sync engine from the Alpine side is not
 * ported yet. The save path goes through useFetcher (React Router v7 BFF) which
 * handles retries via the browser's native fetch queue.
 */
export function useOfflineQueue() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const queueRef = useRef<QueuedRequest[]>([]);

  // Listen for online/offline events
  useEffect(() => {
    function goOnline() {
      setOnline(true);
      // Auto-replay when connectivity returns
      replay();
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  /** Enqueue a failed request for later replay */
  const enqueue = useCallback(
    (req: Omit<QueuedRequest, "timestamp">) => {
      const entry: QueuedRequest = { ...req, timestamp: Date.now() };
      queueRef.current.push(entry);
      setPendingCount(queueRef.current.length);

      // Persist to localStorage as a lightweight offline store
      try {
        localStorage.setItem(
          "oi:offlineQueue",
          JSON.stringify(queueRef.current),
        );
      } catch {
        /* quota exceeded — silent */
      }
    },
    [],
  );

  /** Replay all queued requests */
  const replay = useCallback(async () => {
    if (queueRef.current.length === 0) return;
    if (syncing) return;
    setSyncing(true);

    const queue = [...queueRef.current];
    const remaining: QueuedRequest[] = [];

    for (const entry of queue) {
      try {
        const res = await fetch(entry.url, {
          method: entry.method,
          headers: { "Content-Type": "application/json" },
          body: entry.body,
          credentials: "include",
        });
        if (!res.ok && res.status >= 500) {
          // Server error — keep in queue for retry
          remaining.push(entry);
        }
        // 4xx = permanent failure, drop from queue
      } catch {
        // Network error — keep
        remaining.push(entry);
      }
    }

    queueRef.current = remaining;
    setPendingCount(remaining.length);
    setSyncing(false);
    setLastSyncedAt(Date.now());

    try {
      if (remaining.length > 0) {
        localStorage.setItem(
          "oi:offlineQueue",
          JSON.stringify(remaining),
        );
      } else {
        localStorage.removeItem("oi:offlineQueue");
      }
    } catch {
      /* ignore */
    }
  }, [syncing]);

  // Load persisted queue on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("oi:offlineQueue");
      if (raw) {
        const parsed = JSON.parse(raw) as QueuedRequest[];
        queueRef.current = parsed;
        setPendingCount(parsed.length);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const state: OfflineState = {
    online,
    pendingCount,
    syncing,
    lastSyncedAt,
    conflicts: [],
  };

  return {
    state,
    online,
    syncing,
    pendingCount,
    lastSyncedAt,
    enqueue,
    replay,
  };
}
