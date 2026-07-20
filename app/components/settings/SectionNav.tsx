import React from "react";
import { TabStrip } from "@core/shared-ui";
import { useScrollSpy } from "~/hooks/useScrollSpy";

export interface NavSection {
  id: string;
  label: string;
  visible?: boolean;
}

/** Height (px) of the sticky bar; consumers set matching `scroll-mt` on sections. */
export const SECTION_NAV_BAR_HEIGHT = 52;

function nearestScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export function SectionNav({
  sections,
  className = "",
}: {
  sections: NavSection[];
  className?: string;
}): JSX.Element | null {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const visible = sections.filter((s) => s.visible !== false);
  const ids = visible.map((s) => s.id);

  const getRoot = React.useCallback(() => nearestScrollParent(rootRef.current), []);
  const activeId = useScrollSpy(ids, { getRoot, topOffset: SECTION_NAV_BAR_HEIGHT }) ?? ids[0];

  // Hooks must run unconditionally; bail out on render only.
  if (visible.length < 3) return null;

  function onChange(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  return (
    <div
      ref={rootRef}
      className={`sticky top-0 z-20 -mx-1 px-1 bg-ih-bg-app ${className}`}
    >
      <TabStrip
        tabs={visible.map((s) => ({ id: s.id, label: s.label }))}
        activeId={activeId}
        onChange={onChange}
      />
    </div>
  );
}
