import { useSearchParams } from "react-router";
import { useMemo } from "react";

const DEFAULT_PAGE      = 1;
const DEFAULT_PAGE_SIZE = 50;
const ALLOWED           = new Set([12, 25, 50, 100]);

export interface UsePagination {
    page:        number;
    pageSize:    number;
    setPage:     (n: number) => void;
    setPageSize: (n: number) => void;
}

export function usePagination(): UsePagination {
    const [sp, setSp] = useSearchParams();

    const page = useMemo(() => {
        const raw = Number(sp.get("page"));
        return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_PAGE;
    }, [sp]);

    const pageSize = useMemo(() => {
        const raw = Number(sp.get("pageSize"));
        return ALLOWED.has(raw) ? raw : DEFAULT_PAGE_SIZE;
    }, [sp]);

    const setPage = (n: number) => {
        setSp((prev) => {
            const next = new URLSearchParams(prev);
            if (n <= 1) next.delete("page"); else next.set("page", String(n));
            return next;
        });
    };

    const setPageSize = (n: number) => {
        if (!ALLOWED.has(n)) return;
        setSp((prev) => {
            const next = new URLSearchParams(prev);
            if (n === DEFAULT_PAGE_SIZE) next.delete("pageSize"); else next.set("pageSize", String(n));
            next.delete("page");  // reset to page 1 when page-size changes
            return next;
        });
    };

    return { page, pageSize, setPage, setPageSize };
}
