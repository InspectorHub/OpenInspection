// App-side mirror of the built-in appearance profiles' token overlays + labels.
// app/ cannot import server/lib, so the three profiles' sparse token maps are
// duplicated here for the settings picker + live preview. Keep in sync with
// server/lib/report-style/profiles.ts (BUILTIN_PROFILES). Same mirror pattern as
// report/types.ts. presetTokens() fills every unset token from BASE defaults, so
// only the overlay (what differs from Signature) lives here.
import type { PresetTokenMap } from './preset-tokens';

export interface ClientProfile {
  id: string;
  name: string;
  /** Describes the LOOK only — never a report type / use-case (that language
   *  belongs to the template-default picker). */
  hint: string;
  tokens: PresetTokenMap;
}

export const BUILTIN_PROFILES_CLIENT: Record<string, ClientProfile> = {
  signature: {
    id: 'signature',
    name: 'Signature',
    hint: 'Clean, modern sans.',
    tokens: {},
  },
  meridian: {
    id: 'meridian',
    name: 'Meridian',
    hint: 'Bold, uppercase, structured.',
    tokens: {
      headingTransform: 'uppercase',
      headingWeight: '700',
      headingSpacing: '0.02em',
      coverOverlay: 'linear-gradient(180deg, rgba(15,23,42,0.15) 0%, rgba(15,23,42,0.82))',
      coverHeight: '158px',
      bandColor: '#0f172a',
      radius: '3px',
    },
  },
  terra: {
    id: 'terra',
    name: 'Terra',
    hint: 'Traditional serif.',
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

export const CLIENT_PROFILE_LIST: ClientProfile[] = [
  BUILTIN_PROFILES_CLIENT.signature,
  BUILTIN_PROFILES_CLIENT.meridian,
  BUILTIN_PROFILES_CLIENT.terra,
];
