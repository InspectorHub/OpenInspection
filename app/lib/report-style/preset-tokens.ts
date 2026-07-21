// Injects a profile's typography/layout tokens as inline CSS variables, exactly
// like brandTokens injects --ih-primary*. Consumed by report components as
// var(--report-*). App-side re-declaration of the server StyleTokens shape
// (app/ must not import server/lib). Colour is NOT here — that's brandTokens.
import type { CSSProperties } from 'react';

export interface PresetTokenMap {
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

// key -> [css-var name, base default]. Mirrors server BASE_TOKENS; kept here so
// the app renders a complete var set even for a sparse/empty profile.
const TOKEN_MAP: Record<keyof PresetTokenMap, [string, string]> = {
  headingFontFamily: ['--report-heading-font', 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'],
  headingWeight: ['--report-heading-weight', '800'],
  headingSpacing: ['--report-heading-spacing', '-0.01em'],
  headingTransform: ['--report-heading-transform', 'none'],
  coverHeight: ['--report-cover-height', '150px'],
  coverOverlay: ['--report-cover-overlay', 'linear-gradient(180deg, rgba(20,16,12,0) 30%, rgba(20,16,12,0.55))'],
  coverInk: ['--report-cover-ink', '#ffffff'],
  bandColor: ['--report-band', 'var(--ih-primary)'],
  radius: ['--report-radius', '5px'],
  frame: ['--report-frame', 'none'],
  bodyFontFamily: ['--report-body-font', 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'],
  bodyScale: ['--report-body-scale', '1'],
  sectionFill: ['--report-section-fill', 'transparent'],
  cardFill: ['--report-card-fill', '#ffffff'],
  sectionBreak: ['--report-section-break', 'auto'],
  density: ['--report-density', 'comfortable'],
  paper: ['--report-paper', '#ffffff'],
  paper2: ['--report-paper-2', '#faf7f3'],
  ink: ['--report-ink', '#22201d'],
  muted: ['--report-muted', '#5f584f'],
  hair: ['--report-hair', '#e8e1d8'],
};

export function presetTokens(tokens: PresetTokenMap | null | undefined): CSSProperties {
  const out: Record<string, string> = {};
  const t = (tokens ?? {}) as Record<string, string>;
  for (const key of Object.keys(TOKEN_MAP) as (keyof PresetTokenMap)[]) {
    const [cssVar, base] = TOKEN_MAP[key];
    out[cssVar] = t[key] ?? base;
  }
  return out as CSSProperties;
}
