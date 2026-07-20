// Appearance-profile engine constants. Phase 1 = built-in only; a Phase-2
// style_profiles table will resolve after these (see resolve.ts).

// Internal — bump when the token schema changes shape (stamped onto each profile).
const PROFILE_SCHEMA_VERSION = 1;
export const DEFAULT_PROFILE_ID = 'signature';

/** All optional — a profile carries a sparse overlay; missing keys fall back to BASE_TOKENS. */
export interface StyleTokens {
  headingFontFamily?: string;
  headingWeight?: string;
  headingSpacing?: string;
  headingTransform?: string;
  coverHeight?: string;
  coverOverlay?: string;
  coverInk?: string;
  bandColor?: string;
  radius?: string;
  frame?: string;
  bodyFontFamily?: string;
  bodyScale?: string;
  sectionFill?: string;
  cardFill?: string;
  sectionBreak?: string;
  density?: string;
  paper?: string;
  paper2?: string;
  ink?: string;
  muted?: string;
  hair?: string;
}

export interface StyleProfile {
  id: string;
  name: string;
  schemaVersion: number;
  colour: string | null; // null = inherit tenant brand primaryColor
  badgeLayout: 'strip' | 'inline';
  photoColumns: number; // 1-4
  tokens: StyleTokens; // sparse overlay over BASE_TOKENS
}

// The full default token set. `bandColor: var(--ih-primary)` tracks the brand
// accent; structural colours (cover overlay, paper) are neutral, never a brand hue.
// Exact hex/fonts may be tuned during 1b visual polish.
export const BASE_TOKENS: Required<StyleTokens> = {
  headingFontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  headingWeight: '800',
  headingSpacing: '-0.01em',
  headingTransform: 'none',
  coverHeight: '150px',
  coverOverlay: 'linear-gradient(180deg, rgba(20,16,12,0) 30%, rgba(20,16,12,0.55))',
  coverInk: '#ffffff',
  bandColor: 'var(--ih-primary)',
  radius: '5px',
  frame: 'none',
  bodyFontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  bodyScale: '1',
  sectionFill: 'transparent',
  cardFill: '#ffffff',
  sectionBreak: 'auto',
  density: 'comfortable',
  paper: '#ffffff',
  paper2: '#faf7f3',
  ink: '#22201d',
  muted: '#5f584f',
  hair: '#e8e1d8',
};

export const BUILTIN_PROFILES: Record<string, StyleProfile> = {
  signature: {
    id: 'signature',
    name: 'Signature',
    schemaVersion: PROFILE_SCHEMA_VERSION,
    colour: null,
    badgeLayout: 'strip',
    photoColumns: 2,
    tokens: {}, // signature == BASE_TOKENS
  },
  meridian: {
    id: 'meridian',
    name: 'Meridian',
    schemaVersion: PROFILE_SCHEMA_VERSION,
    colour: null,
    badgeLayout: 'strip',
    photoColumns: 2,
    tokens: {
      headingTransform: 'uppercase',
      headingWeight: '700',
      headingSpacing: '0.02em',
      coverOverlay: 'linear-gradient(180deg, rgba(15,23,42,0.15) 0%, rgba(15,23,42,0.82))',
      coverHeight: '158px',
      bandColor: '#0f172a', // structural navy, intentionally NOT the brand hue
      radius: '3px',
    },
  },
  terra: {
    id: 'terra',
    name: 'Terra',
    schemaVersion: PROFILE_SCHEMA_VERSION,
    colour: null,
    badgeLayout: 'strip',
    photoColumns: 2,
    tokens: {
      headingFontFamily: 'Georgia, "Times New Roman", serif',
      headingWeight: '700',
      headingSpacing: '0',
      coverOverlay: 'linear-gradient(180deg, rgba(44,36,24,0) 30%, rgba(44,36,24,0.5))',
      frame: '3px double var(--ih-primary)',
      radius: '3px',
      bodyFontFamily: 'Georgia, "Times New Roman", serif',
      paper: '#fffdf7',
      paper2: '#f8f1e2',
      ink: '#2c2418',
      muted: '#6b5d47',
      hair: '#e6dcc8',
    },
  },
};
