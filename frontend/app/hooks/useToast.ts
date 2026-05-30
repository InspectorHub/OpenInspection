import { useCallback, useEffect, useState } from 'react';

export interface ToastEntry {
    id:           string;
    message:      string;
    actionLabel?: string;
    onAction?:    () => void;
    durationMs:   number;
}

let toastListeners: Array<(t: ToastEntry) => void> = [];

export function pushToast(t: Omit<ToastEntry, 'id'>) {
    const full: ToastEntry = { ...t, id: crypto.randomUUID() };
    toastListeners.forEach(fn => fn(full));
}

export function useToastQueue(): ToastEntry[] {
    const [queue, setQueue] = useState<ToastEntry[]>([]);

    useEffect(() => {
        const fn = (t: ToastEntry) => {
            setQueue(prev => [...prev, t]);
            setTimeout(() => {
                setQueue(prev => prev.filter(p => p.id !== t.id));
            }, t.durationMs);
        };
        toastListeners.push(fn);
        return () => { toastListeners = toastListeners.filter(l => l !== fn); };
    }, []);

    // Unused helper kept for future use by callers that want to dismiss early.
    void useCallback((id: string) => {
        setQueue(prev => prev.filter(p => p.id !== id));
    }, []);

    return queue;
}
