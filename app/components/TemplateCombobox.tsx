import { useState, useEffect, useRef, useCallback } from "react";
import { useFetcher } from "react-router";

interface TemplateSummary {
    id: string;
    name: string;
}

interface SearchResult {
    templates?: TemplateSummary[];
    hasMore?: boolean;
    page?: number;
    totalPages?: number;
}

interface TemplateComboboxProps {
    value: string;
    onChange: (id: string) => void;
    initialTemplates?: TemplateSummary[];
    className?: string;
    placeholder?: string;
}

export function TemplateCombobox({
    value,
    onChange,
    initialTemplates = [],
    className = "",
    placeholder = "--- Select template ---",
}: TemplateComboboxProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<TemplateSummary[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [page, setPage] = useState(1);
    const [activeIdx, setActiveIdx] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fetcher = useFetcher<SearchResult>();
    const loadMoreFetcher = useFetcher<SearchResult>();

    const selectedName = [...initialTemplates, ...results].find(t => t.id === value)?.name ?? "";

    const doSearch = useCallback((q: string, pg: number) => {
        const params = new URLSearchParams({ page: String(pg) });
        if (q) params.set("q", q);
        fetcher.load(`/resources/template-search?${params}`);
    }, [fetcher]);

    // When dropdown opens: seed with initial templates or fetch page 1
    useEffect(() => {
        if (!open) return;
        if (initialTemplates.length > 0 && !query) {
            setResults(initialTemplates);
            setHasMore(false);
            setPage(1);
        } else {
            doSearch(query, 1);
        }
        setActiveIdx(-1);
        setTimeout(() => inputRef.current?.focus(), 0);
    }, [open]); // intentionally omits doSearch/query — open-trigger re-seeds from initialTemplates

    // Debounce query changes
    useEffect(() => {
        if (!open) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setPage(1);
            setHasMore(false);
            doSearch(query, 1);
        }, 300);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query, open]); // doSearch is stable (useCallback); omitting it is safe

    // Apply fetcher results (main search)
    useEffect(() => {
        if (fetcher.state !== "idle" || !fetcher.data) return;
        const d = fetcher.data;
        setResults(d.templates ?? []);
        setHasMore(d.hasMore ?? false);
        setPage(d.page ?? 1);
        setActiveIdx(-1);
    }, [fetcher.state, fetcher.data]);

    // Apply load-more results (append)
    useEffect(() => {
        if (loadMoreFetcher.state !== "idle" || !loadMoreFetcher.data) return;
        const d = loadMoreFetcher.data;
        if (!d.templates?.length) return;
        setResults(prev => {
            const ids = new Set(prev.map(t => t.id));
            return [...prev, ...d.templates!.filter(t => !ids.has(t.id))];
        });
        setHasMore(d.hasMore ?? false);
        setPage(d.page ?? 1);
    }, [loadMoreFetcher.state, loadMoreFetcher.data]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const handleSelect = (t: TemplateSummary) => {
        onChange(t.id);
        setOpen(false);
        setQuery("");
    };

    const handleLoadMore = () => {
        const next = page + 1;
        const params = new URLSearchParams({ page: String(next) });
        if (query) params.set("q", query);
        loadMoreFetcher.load(`/resources/template-search?${params}`);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") { setOpen(false); setQuery(""); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return; }
        if (e.key === "Enter" && activeIdx >= 0 && results[activeIdx]) {
            e.preventDefault();
            handleSelect(results[activeIdx]);
        }
    };

    const isLoading = fetcher.state !== "idle";
    const isLoadingMore = loadMoreFetcher.state !== "idle";

    const baseInputClass = `mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none ${className}`;

    return (
        <div ref={containerRef} className="relative">
            {/* Trigger */}
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`${baseInputClass} flex items-center justify-between cursor-pointer text-left w-full`}
            >
                <span className={selectedName ? "text-ih-fg-1" : "text-ih-fg-4"}>
                    {selectedName || placeholder}
                </span>
                <svg className={`w-4 h-4 text-ih-fg-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Dropdown */}
            {open && (
                <div className="absolute z-50 top-[calc(100%+4px)] left-0 right-0 bg-ih-bg-card border border-ih-border rounded-md shadow-ih-popover overflow-hidden">
                    {/* Search input */}
                    <div className="p-2 border-b border-ih-border">
                        <div className="relative">
                            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ih-fg-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                            </svg>
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Search templates..."
                                className="w-full h-8 pl-8 pr-3 text-[13px] bg-ih-bg-muted rounded border border-ih-border outline-none focus:border-ih-primary text-ih-fg-1 placeholder:text-ih-fg-4"
                            />
                        </div>
                    </div>

                    {/* List */}
                    <div className="max-h-52 overflow-y-auto">
                        {isLoading ? (
                            <div className="py-6 text-center text-[12px] text-ih-fg-4">Loading…</div>
                        ) : results.length === 0 ? (
                            <div className="py-6 text-center text-[12px] text-ih-fg-4">
                                {query ? "No templates match your search" : "No templates found"}
                            </div>
                        ) : (
                            <>
                                {/* Clear selection option */}
                                {value && (
                                    <button
                                        type="button"
                                        onClick={() => { onChange(""); setOpen(false); setQuery(""); }}
                                        className="w-full px-3 py-2 text-left text-[12px] text-ih-fg-4 hover:bg-ih-bg-muted italic"
                                    >
                                        --- Clear selection ---
                                    </button>
                                )}
                                {results.map((t, i) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => handleSelect(t)}
                                        className={`w-full px-3 py-2 text-left text-[13px] font-medium hover:bg-ih-bg-muted transition-colors ${
                                            t.id === value ? "text-ih-primary bg-ih-primary-tint" :
                                            i === activeIdx ? "bg-ih-bg-muted text-ih-fg-1" :
                                            "text-ih-fg-1"
                                        }`}
                                    >
                                        {t.name}
                                    </button>
                                ))}
                            </>
                        )}
                    </div>

                    {/* Load more */}
                    {hasMore && !isLoading && (
                        <div className="p-2 border-t border-ih-border">
                            <button
                                type="button"
                                onClick={handleLoadMore}
                                disabled={isLoadingMore}
                                className="w-full h-7 rounded text-[12px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted disabled:opacity-50 transition-colors"
                            >
                                {isLoadingMore ? "Loading…" : "Load more"}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
