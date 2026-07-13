import { useRef } from "react";
import { Drawer, IconButton, SegmentedControl } from "@core/shared-ui";
import { CommentLibraryList } from "./CommentLibraryList";

export interface CommentLibraryDrawerProps {
 open: boolean;
 comments: {
  filterMode: "auto" | "all";
  setFilterMode: (m: "auto" | "all") => void;
  sort: string;
  setSort: (s: string) => void;
  touchSnippet: (id: string) => void;
 };
 state: {
  activeItem: { label?: unknown; name?: unknown } | null;
  currentSection: { id: string; title?: string } | null;
  activeItemId: string | null;
  getResult: (itemId: string, sectionId?: string) => Record<string, unknown>;
  getRatingLabel?: (ratingId: string | null | undefined) => string;
  commentLibraryFilter: string;
  setCommentLibraryFilter: (f: string) => void;
  setCommentLibrarySelectedIdx: (i: number) => void;
  commentLibrarySearch: string;
  setCommentLibrarySearch: (s: string) => void;
  commentLibrarySelectedIdx: number;
  setShowCommentLibrary: (open: boolean) => void;
 };
 serverComments: Array<{ id: string; text: string; useCount?: number; lastUsedAt?: number | null }>;
 onInsert: (sectionId: string, itemId: string, text: string) => void;
 onClose: () => void;
}

export function CommentLibraryDrawer({ open, comments, state, serverComments, onInsert, onClose }: CommentLibraryDrawerProps) {
 const searchRef = useRef<HTMLInputElement>(null);
 return (
 <Drawer open={open} onClose={onClose} title="Comment Library" wide initialFocusRef={searchRef}>
 {/* -m-4 cancels the Drawer body padding so the sub-headers keep their
     full-bleed borders and the list scrolls independently under the pinned
     search/filter header (h-full flex column). */}
 <div className="flex flex-col h-full -m-4">

 {/* Sort + Filter mode header */}
 <div className="flex items-center gap-3 px-3 py-2 border-b border-ih-border">
 <div className="flex items-center gap-1.5">
 <span className="text-[10px] uppercase tracking-[0.1em] text-ih-fg-4">Filter</span>
 <select
 value={comments.filterMode}
 onChange={e => comments.setFilterMode(e.target.value as 'auto' | 'all')}
 className="px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-[11px]"
 >
 <option value="auto">Auto</option>
 <option value="all">All</option>
 </select>
 </div>
 <div className="flex items-center gap-1.5 ml-auto">
 <span className="text-[10px] uppercase tracking-[0.1em] text-ih-fg-4">Sort</span>
 <select
 value={comments.sort}
 onChange={e => comments.setSort(e.target.value)}
 className="px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-[11px]"
 >
 <option value="relevance">Relevance</option>
 <option value="recent">Recent use</option>
 <option value="created">Recently added</option>
 <option value="frequent">Most used</option>
 <option value="alpha">A–Z</option>
 </select>
 </div>
 </div>

 {/* Context strip (auto mode + active item) */}
 {comments.filterMode === 'auto' && state.activeItem && (
 <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] bg-ih-bg-muted border-b border-ih-border">
 <span className="text-ih-fg-4">Context:</span>
 <span>
 {state.currentSection?.title} › {(state.activeItem.label || state.activeItem.name) as string}
 </span>
 {Boolean(state.activeItemId && state.getResult(state.activeItemId)?.rating) && (
 <>
 <span className="text-ih-fg-4">·</span>
 <span>
 {state.getRatingLabel?.(state.getResult(state.activeItemId as string)?.rating as string) ?? ''}
 </span>
 </>
 )}
 <IconButton
 onClick={() => comments.setFilterMode('all')}
 className="ml-auto text-ih-fg-4 hover:text-ih-fg-2"
 aria-label="Clear filter"
 size="sm"
 >×</IconButton>
 </div>
 )}

 {/* Filter chips */}
 <div className="px-4 py-2 border-b border-ih-border">
 <SegmentedControl
 options={[
 { value: "all", label: "All" },
 { value: "good", label: "Satisfactory" },
 { value: "marginal", label: "Monitor" },
 { value: "significant", label: "Defect" },
 { value: "my-snippets", label: "My Snippets" },
 ]}
 value={state.commentLibraryFilter}
 onChange={(id) => {
 state.setCommentLibraryFilter(id);
 state.setCommentLibrarySelectedIdx(0);
 }}
 ariaLabel="Comment severity filter"
 className="flex-wrap"
 />
 </div>

 {/* Search */}
 <div className="px-4 py-2">
 <input
 ref={searchRef}
 id="comment-library-search"
 type="text"
 placeholder="Search comments..."
 value={state.commentLibrarySearch}
 onChange={(e) => {
 state.setCommentLibrarySearch(e.target.value);
 state.setCommentLibrarySelectedIdx(0);
 }}
 className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[12px]"
 />
 <p className="text-[10px] text-ih-fg-4 mt-1">
 {serverComments.length} comments
 </p>
 </div>

 {/* Comment list (server-fetched, sort/filter aware) */}
 <div className="flex-1 overflow-y-auto pb-2">
 <CommentLibraryList
 serverComments={serverComments}
 selectedIndex={state.commentLibrarySelectedIdx}
 sort={comments.sort}
 onInsertText={(text, id) => {
 if (!state.currentSection || !state.activeItemId) return;
 onInsert(state.currentSection.id, state.activeItemId, text);
 comments.touchSnippet(id);
 state.setShowCommentLibrary(false);
 }}
 />
 </div>
 </div>
 </Drawer>
 );
}
