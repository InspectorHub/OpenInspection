import { useRef, useState } from "react";
import { useFetcher } from "react-router";

/**
 * A debounced Contacts typeahead, driven through the /inspections action.
 *
 * The People step now runs two of these — the agent (IA-1) and the client
 * (Batch D) — and they were written the same way twice: set the text, open the
 * dropdown at two characters, clear the pending timer, submit the intent 300 ms
 * later. Written twice, the second copy is the one that misses the next fix.
 *
 * Each search gets its OWN fetcher (B-17 convention): a shared one cancels its
 * own in-flight request, so typing in one field would blank the other's results.
 */
export function useContactSearch<D>(
    intent: "search-agents" | "search-clients",
    /** Called with every keystroke, before the debounce — the caller owns the text. */
    onText: (value: string) => void,
) {
    const fetcher = useFetcher<D>();
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [dropdownOpen, setDropdownOpen] = useState(false);

    function onQueryChange(value: string) {
        onText(value);
        const q = value.trim();
        setDropdownOpen(q.length >= 2);
        if (timer.current) clearTimeout(timer.current);
        if (q.length >= 2) {
            timer.current = setTimeout(() => {
                fetcher.submit({ intent, search: q }, { method: "post", action: "/inspections" });
            }, 300);
        }
    }

    return { fetcher, dropdownOpen, setDropdownOpen, onQueryChange };
}
