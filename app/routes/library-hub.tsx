import { HubCard, HUB_GRID_CLASS } from "~/components/HubCard";

// SVG path `d` values mirror the icons previously used in Sidebar's
// LIBRARY_ITEMS so the hub tiles match each module's established glyph.
const TILES = [
  {
    to: "/library/templates",
    title: "Templates",
    desc: "Report templates and sections.",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    to: "/library/comments",
    title: "Canned Comments",
    desc: "Reusable narrative comments.",
    icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z",
  },
  {
    to: "/library/repair-items",
    title: "Repair Items",
    desc: "Saved repair recommendations.",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    to: "/library/tags",
    title: "Tags",
    desc: "Inspection and contact tags.",
    icon: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
  },
  {
    to: "/library/agreements",
    title: "Agreements",
    desc: "Pre-inspection agreement templates.",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    to: "/library/rating-systems",
    title: "Rating Systems",
    desc: "Condition rating scales.",
    icon: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z",
  },
  {
    to: "/library/defect-categories",
    title: "Defect Categories",
    desc: "Group defects for report summaries.",
    icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  },
  {
    to: "/library/marketplace",
    title: "Marketplace",
    desc: "Shared community content.",
    icon: "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z",
  },
];

export default function LibraryHub() {
  return (
    <div className={HUB_GRID_CLASS}>
      {TILES.map((t) => (
        <HubCard key={t.to} to={t.to} title={t.title} desc={t.desc} icon={t.icon} />
      ))}
    </div>
  );
}
