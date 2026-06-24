/**
 * Per-section icon lookup for the Section Rail (D10).
 *
 * Returns a small inline SVG keyed by a `data-icon` attribute so tests can
 * verify the correct category without pixel inspection. The icon inherits
 * `currentColor` from the surrounding text — no hardcoded colours.
 */

type IconCategory =
  | 'roof'
  | 'exterior'
  | 'electrical'
  | 'plumbing'
  | 'hvac'
  | 'interior'
  | 'structural'
  | 'foundation'
  | 'garage'
  | 'kitchen'
  | 'bathroom'
  | 'attic'
  | 'crawlspace'
  | 'fireplace'
  | 'insulation'
  | 'appliances'
  | 'grounds'
  | 'pool'
  | 'safety'
  | 'summary'
  | 'generic';

/** Order matters — more-specific keywords first. */
const KEYWORD_MAP: [string[], IconCategory][] = [
  [['crawl'], 'crawlspace'],
  [['attic'], 'attic'],
  [['fireplace', 'chimney', 'hearth'], 'fireplace'],
  [['roof', 'covering', 'flashing', 'gutter', 'drainage'], 'roof'],
  [['exterior', 'siding', 'facade', 'cladding', 'stucco', 'trim', 'wall'], 'exterior'],
  [['electric', 'panel', 'circuit', 'wiring', 'outlet', 'gfci', 'afci', 'breaker'], 'electrical'],
  [['plumb', 'water', 'drain', 'sewer', 'pipe', 'fixture', 'faucet', 'toilet', 'supply'], 'plumbing'],
  [['hvac', 'heat', 'cool', 'furnace', 'air', 'duct', 'thermostat', 'boiler', 'ac'], 'hvac'],
  [['insul', 'vapor', 'barrier'], 'insulation'],
  [['structur', 'beam', 'joist', 'column', 'load', 'frame'], 'structural'],
  [['foundation', 'footing', 'slab', 'basement'], 'foundation'],
  [['garage', 'carport', 'driveway', 'door opener'], 'garage'],
  [['kitchen', 'cook', 'cabinet', 'countertop', 'sink'], 'kitchen'],
  [['bath', 'shower', 'tub'], 'bathroom'],
  [['appli', 'dishwasher', 'refrigerator', 'washer', 'dryer', 'range', 'oven'], 'appliances'],
  [['pool', 'spa', 'hot tub', 'jacuzzi'], 'pool'],
  [['safety', 'smoke', 'carbon', 'co ', 'detector', 'alarm', 'egress', 'handrail', 'stair'], 'safety'],
  [['ground', 'landscape', 'yard', 'lawn', 'site', 'grading', 'walkway', 'patio', 'deck'], 'grounds'],
  [['summar', 'overview', 'general', 'introduction', 'report info', 'property info'], 'summary'],
  [['interior', 'room', 'ceiling', 'floor', 'window', 'door', 'hallway', 'living', 'bedroom'], 'interior'],
];

function resolveCategory(nameOrId: string): IconCategory {
  const lower = nameOrId.toLowerCase();
  for (const [keywords, category] of KEYWORD_MAP) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return category;
    }
  }
  return 'generic';
}

// ---------------------------------------------------------------------------
// SVG path data — one compact path per category.
// All icons: width=14 height=14 viewBox="0 0 24 24" stroke=currentColor
// ---------------------------------------------------------------------------

function SvgIcon({ category, path }: { category: IconCategory; path: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={category}
    >
      <path d={path} />
    </svg>
  );
}

const PATHS: Record<IconCategory, string> = {
  roof:        'M3 10l9-7 9 7v11H3z',
  exterior:    'M4 20V8l8-6 8 6v12M9 20v-6h6v6',
  electrical:  'M13 2L3 14h9l-1 8 10-12h-9z',
  plumbing:    'M8 2v4a4 4 0 004 4 4 4 0 004-4V2M6 22h12',
  hvac:        'M12 2v8m0 4v8M4 6l8 6 8-6M4 18l8-6 8 6',
  interior:    'M3 12h18M3 6h18M3 18h18',
  structural:  'M4 20V4h16v16M8 20V12h8v8',
  foundation:  'M2 20h20M5 20V10l7-6 7 6v10',
  garage:      'M3 11l9-7 9 7v11H3zM9 21V15h6v6',
  kitchen:     'M8 3v4a1 1 0 001 1h6a1 1 0 001-1V3M5 8h14v13H5z',
  bathroom:    'M4 20V8a4 4 0 014-4h8a4 4 0 014 4v12M4 14h16',
  attic:       'M3 9l9-6 9 6M5 9v2h14V9M7 11v9M17 11v9',
  crawlspace:  'M3 18l4-4h10l4 4M7 18v-6h10v6',
  fireplace:   'M5 21V9a7 7 0 0114 0v12M9 21v-5a3 3 0 016 0v5',
  insulation:  'M3 6h18M3 10h18M3 14h18M3 18h18',
  appliances:  'M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM9 7h6M9 11h6',
  grounds:     'M12 2C8 2 5 6 5 10c0 5 7 12 7 12s7-7 7-12c0-4-3-8-7-8z',
  pool:        'M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0M2 17c2-3 4-3 6 0s4 3 6 0 4-3 6 0',
  safety:      'M12 2l7 4v6c0 5-4 9-7 10C9 21 5 17 5 12V6z',
  summary:     'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  generic:     'M12 12m-4 0a4 4 0 108 0 4 4 0 10-8 0',
};

/**
 * Returns a small inline SVG icon for the given section name or id.
 * Matches case-insensitively by keyword; falls back to a neutral glyph.
 * The element always carries a stable `data-icon="<category>"` attribute.
 */
export function sectionIconFor(nameOrId: string): React.ReactElement {
  const category = resolveCategory(nameOrId);
  return <SvgIcon category={category} path={PATHS[category]} />;
}
