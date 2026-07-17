import { useRef } from "react";
import { Drawer, IconButton, SegmentedControl } from "@core/shared-ui";
import { CommentLibraryList } from "./CommentLibraryList";
import { m } from "~/paraglide/messages";

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
 <Drawer open={open} onClose={onClose} title={m.editor_comment_library_title()} wide initialFocusRef={searchRef}>
 {/* -m-4 cancels the Drawer body padding so the sub-headers keep their
     full-bleed borders and the list scrolls independently under the pinned
     search/filter header (h-full flex column). */}
 <div className="flex flex-col h-full -m-4">

 {/* Sort + Filter mode header */}
 <div className="flex items-center gap-3 px-3 py-2 border-b border-ih-border">
 <div className="flex items-center gap-1.5">
 <span className="text-[10px] uppercase tracking-[0.1em] text-ih-fg-4">{m.editor_comment_library_filter_label()}</span>
 <select
 value={comments.filterMode}
 onChange={e => comments.setFilterMode(e.target.value as 'auto' | 'all')}
 className="px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-[11px]"
 >
 <option value="auto">{m.editor_comment_library_filter_auto()}</option>
 <option value="all">{m.editor_comment_library_all()}</option>
 </select>
 </div>
 <div className="flex items-center gap-1.5 ml-auto">
 <span className="text-[10px] uppercase tracking-[0.1em] text-ih-fg-4">{m.editor_comment_library_sort_label()}</span>
 <select
 value={comments.sort}
 onChange={e => comments.setSort(e.target.value)}
 className="px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-[11px]"
 >
 <option value="relevance">{m.editor_comment_library_sort_relevance()}</option>
 <option value="recent">{m.editor_comment_library_sort_recent()}</option>
 <option value="created">{m.editor_comment_library_sort_created()}</option>
 <option value="frequent">{m.editor_comment_library_sort_frequent()}</option>
 <option value="alpha">{m.editor_comment_library_sort_alpha()}</option>
 </select>
 </div>
 </div>

 {/* Context strip (auto mode + active item) */}
 {comments.filterMode === 'auto' && state.activeItem && (
 <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] bg-ih-bg-muted border-b border-ih-border">
 <span className="text-ih-fg-4">{m.editor_comment_library_context()}</span>
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
 aria-label={m.editor_comment_library_clear_filter_aria()}
 size="sm"
 >×</IconButton>
 </div>
 )}

 {/* Filter chips */}
 <div className="px-4 py-2 border-b border-ih-border">
 <SegmentedControl
 options={[
 { value: "all", label: m.editor_comment_library_all() },
 { value: "good", label: m.editor_comment_library_sev_satisfactory() },
 { value: "marginal", label: m.editor_comment_library_sev_monitor() },
 { value: "significant", label: m.editor_comment_library_sev_defect() },
 { value: "my-snippets", label: m.editor_comment_library_sev_my_snippets() },
 ]}
 value={state.commentLibraryFilter}
 onChange={(id) => {
 state.setCommentLibraryFilter(id);
 state.setCommentLibrarySelectedIdx(0);
 }}
 ariaLabel={m.editor_comment_library_sev_aria()}
 className="flex-wrap"
 />
 </div>

 {/* Search */}
 <div className="px-4 py-2">
 <input
 ref={searchRef}
 id="comment-library-search"
 type="text"
 placeholder={m.editor_comment_library_search_placeholder()}
 value={state.commentLibrarySearch}
 onChange={(e) => {
 state.setCommentLibrarySearch(e.target.value);
 state.setCommentLibrarySelectedIdx(0);
 }}
 className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[12px]"
 />
 <p className="text-[10px] text-ih-fg-4 mt-1">
 {m.editor_comment_library_count({ count: serverComments.length })}
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
