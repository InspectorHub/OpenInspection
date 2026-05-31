import { useState } from "react";

interface DuplicateGroup {
 marketplaceId: string;
 copies: Array<{ id: string; name: string; version?: string }>;
}

interface MarketplaceDuplicateBannerProps {
 groups: DuplicateGroup[];
 onCompare?: (group: DuplicateGroup) => void;
 onUseNew?: (group: DuplicateGroup) => void;
 onKeepBoth?: (group: DuplicateGroup) => void;
}

export function MarketplaceDuplicateBanner({ groups, onCompare, onUseNew, onKeepBoth }: MarketplaceDuplicateBannerProps) {
 const [dismissed, setDismissed] = useState(false);

 if (!groups.length || dismissed) return null;

 return (
 <div className="rounded-lg border border-ih-watch bg-ih-watch-bg p-4" role="status">
 {groups.map((g) => (
 <div key={g.marketplaceId} className="flex items-start gap-3">
 <svg className="w-5 h-5 text-ih-watch-fg flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
 <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
 </svg>
 <div className="flex-1 min-w-0">
 <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
 You have {g.copies.length} copies of <span className="font-bold">{g.copies[0]?.name}</span>.
 </p>
 <p className="text-[12px] text-ih-watch-fg mt-0.5">
 Older version <span className="font-mono">{g.copies[g.copies.length - 1]?.version ?? "?"}</span> may be outdated.
 </p>
 <div className="mt-2 flex items-center gap-2 flex-wrap">
 <button type="button" onClick={() => onCompare?.(g)} className="h-7 px-3 rounded-md bg-ih-bg-card border border-ih-watch text-ih-watch-fg text-[12px] font-bold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/30">
 Compare versions
 </button>
 <button type="button" onClick={() => onUseNew?.(g)} className="h-7 px-3 rounded-md bg-amber-600 text-white text-[12px] font-bold hover:bg-amber-700 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/30">
 Use new only
 </button>
 <button type="button" onClick={() => { onKeepBoth?.(g); setDismissed(true); }} className="h-7 px-3 rounded-md text-ih-watch-fg text-[12px] font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/20">
 Keep both
 </button>
 </div>
 </div>
 </div>
 ))}
 </div>
 );
}
