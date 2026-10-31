import { useState, useEffect, useCallback, useRef } from "react";
import { useFieldDataSource } from "../context";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PresenceUser {
  userId: string;
  name: string;
  photoUrl?: string | null;
  focusItemId?: string | null;
}

/**
 * FE-5 — so the UI can distinguish "still connecting" from "lost". `unavailable` is a host that cannot say who the
 * viewer is (`session().userId` is null): no socket is opened and nothing is announced.
 */
export type PresenceStatus = "connecting" | "connected" | "reconnecting" | "unavailable";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF = 30_000;

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * React-side presence client. Connects to the WebSocket presence channel
 * for multi-inspector collaboration. The socket URL and the user id come from the
 * host's data source (`urls.presenceSocket`, `session().userId`). Reconnects with exponential backoff,
 * sends heartbeat every 30s, exposes a reactive roster.
 */
export function usePresence(options: {
  inspectionId: string;
  userName: string;
  photoUrl?: string | null;
  enabled?: boolean;
}) {
  const { inspectionId, userName, photoUrl, enabled = true } = options;
  const dataSource = useFieldDataSource();
  const [roster, setRoster] = useState<PresenceUser[]>([]);
  const [connected, setConnected] = useState(false);
  // FE-5: a fresh page used to flash "Disconnected" until the first WS open —
  // read as data loss by field users. Track connecting/connected/reconnecting.
  const [status, setStatus] = useState<PresenceStatus>("connecting");
  const everConnectedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffRef = useRef(400);
  const closedRef = useRef(false);
  // The one pending reconnect, so a close (or a switch to another inspection) can cancel it instead of letting a stale
  // closure open a socket for the old inspection.
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (closedRef.current || !enabled) return;
    if (!inspectionId) return;

    const wsUrl = dataSource.urls.presenceSocket(inspectionId);
    const { userId } = dataSource.session();
    if (userId === null) {
      setStatus("unavailable");
      setConnected(false);
      return;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // Only the CURRENT socket may act: after a close() or a switch to another inspection, an older socket's late events
      // belong to a connection nobody is waiting for.
      const isCurrent = () => wsRef.current === ws && !closedRef.current;

      ws.addEventListener("open", () => {
        if (!isCurrent()) return;
        backoffRef.current = 400;
        everConnectedRef.current = true;
        setStatus("connected");
        setConnected(true);
        send({
          type: "hello",
          userId,
          name: userName,
          photoUrl: photoUrl ?? null,
        });
        heartbeatRef.current = setInterval(() => {
          send({ type: "heartbeat" });
        }, HEARTBEAT_MS);
      });

      ws.addEventListener("message", (ev) => {
        try {
          const m = JSON.parse(ev.data) as Record<string, unknown>;
          if (m.type === "roster") {
            setRoster((m.users as PresenceUser[]) || []);
          }
        } catch {
          /* malformed message */
        }
      });

      ws.addEventListener("close", () => {
        // A close the hook asked for (unmount or close()) has nothing left to report and nothing to reconnect, and
        // neither has a socket that has since been replaced. Updating state here would also be wrong when the event
        // arrives late, after the component and its environment are gone. The heartbeat belongs to the current socket,
        // so a stale socket leaves it alone.
        if (!isCurrent()) return;
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
        setConnected(false);
        setStatus(everConnectedRef.current ? "reconnecting" : "connecting");
        // Schedule reconnect
        reconnectTimerRef.current = setTimeout(() => connect(), backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF);
      });

      ws.addEventListener("error", () => {
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      });
    } catch {
      // URL malformed or network blocked
      if (!closedRef.current) {
        reconnectTimerRef.current = setTimeout(() => connect(), backoffRef.current);
        backoffRef.current = Math.min(
          backoffRef.current * 2,
          MAX_BACKOFF,
        );
      }
    }
  }, [dataSource, inspectionId, userName, photoUrl, enabled, send]);

  const setFocus = useCallback(
    (itemId: string | null) => {
      send({ type: "focus", itemId });
    },
    [send],
  );

  const close = useCallback(() => {
    closedRef.current = true;
    try {
      send({ type: "bye" });
    } catch {
      /* swallow */
    }
    try {
      wsRef.current?.close();
    } catch {
      /* already closing */
    }
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    setConnected(false);
    // No socket and none coming: the same word the footer already shows for "presence is not available", rather than
    // a stale "connected" next to connected=false.
    setStatus("unavailable");
  }, [send]);

  // Auto-connect on mount, disconnect on unmount
  useEffect(() => {
    if (!enabled) return;
    closedRef.current = false;
    // A previous run's close() left "unavailable" and its connection history behind; this run starts fresh.
    everConnectedRef.current = false;
    setStatus("connecting");
    connect();
    return () => {
      close();
    };
  }, [enabled, inspectionId]);

  // Update focus when active item changes (caller passes this in)
  // This is exposed so the route can call setFocus(activeItemId)

  return {
    roster,
    connected,
    status,
    setFocus,
    close,
  };
}
