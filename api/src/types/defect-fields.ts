/**
 * Per-defect structured field vocabularies.
 *
 * Drives the dropdowns rendered under each included defect in the
 * inspection editor (location text + trade/deadline/timeframe enums).
 * The same labels are read out of {@link DEFECT_TRADE_LABELS} by the
 * Mustache renderer so prose like "recommend repair by {{trade}}"
 * substitutes to "recommend repair by licensed plumber".
 *
 * Vocabularies are append-only — never remove or renumber ids without a
 * data backfill of existing inspection_results rows. Adding a new id is
 * always safe (old data simply doesn't reference it).
 */

export const DEFECT_TRADES = [
    'general-contractor', 'licensed-electrician', 'licensed-plumber', 'licensed-roofer',
    'hvac-technician', 'structural-engineer', 'mold-remediation-specialist', 'septic-contractor',
    'chimney-sweep', 'pest-control', 'arborist', 'garage-door-technician',
    'appliance-technician', 'waterproofing-contractor', 'mason', 'landscaper',
    'painter', 'flooring-contractor', 'glazier', 'qualified-handyman',
] as const;
export type DefectTrade = typeof DEFECT_TRADES[number];

export const DEFECT_DEADLINES = [
    'immediate', 'before-closing', 'within-30-days',
    'within-90-days', 'next-maintenance', 'monitor',
] as const;
export type DefectDeadline = typeof DEFECT_DEADLINES[number];

export const DEFECT_TIMEFRAMES = [
    '0-1-year', '1-3-years', '3-5-years',
    '5-10-years', '10-plus-years', 'end-of-life',
] as const;
export type DefectTimeframe = typeof DEFECT_TIMEFRAMES[number];

export const DEFECT_TRADE_LABELS: Record<DefectTrade, string> = {
    'general-contractor':           'general contractor',
    'licensed-electrician':         'licensed electrician',
    'licensed-plumber':             'licensed plumber',
    'licensed-roofer':              'licensed roofer',
    'hvac-technician':              'HVAC technician',
    'structural-engineer':          'structural engineer',
    'mold-remediation-specialist':  'mold-remediation specialist',
    'septic-contractor':            'septic contractor',
    'chimney-sweep':                'chimney sweep',
    'pest-control':                 'pest-control professional',
    'arborist':                     'arborist',
    'garage-door-technician':       'garage-door technician',
    'appliance-technician':         'appliance technician',
    'waterproofing-contractor':     'waterproofing contractor',
    'mason':                        'qualified mason',
    'landscaper':                   'landscaper',
    'painter':                      'painter',
    'flooring-contractor':          'flooring contractor',
    'glazier':                      'glazier',
    'qualified-handyman':           'qualified handyman',
};

export const DEFECT_DEADLINE_LABELS: Record<DefectDeadline, string> = {
    'immediate':         'immediately',
    'before-closing':    'before closing',
    'within-30-days':    'within 30 days',
    'within-90-days':    'within 90 days',
    'next-maintenance':  'at next scheduled maintenance',
    'monitor':           'monitor for change',
};

export const DEFECT_TIMEFRAME_LABELS: Record<DefectTimeframe, string> = {
    '0-1-year':       'within the next year',
    '1-3-years':      '1 to 3 years',
    '3-5-years':      '3 to 5 years',
    '5-10-years':     '5 to 10 years',
    '10-plus-years':  '10 or more years',
    'end-of-life':    'at end of expected service life',
};

const TRADE_SET     = new Set<string>(DEFECT_TRADES);
const DEADLINE_SET  = new Set<string>(DEFECT_DEADLINES);
const TIMEFRAME_SET = new Set<string>(DEFECT_TIMEFRAMES);

export function isDefectTrade(v: unknown): v is DefectTrade {
    return typeof v === 'string' && TRADE_SET.has(v);
}
export function isDefectDeadline(v: unknown): v is DefectDeadline {
    return typeof v === 'string' && DEADLINE_SET.has(v);
}
export function isDefectTimeframe(v: unknown): v is DefectTimeframe {
    return typeof v === 'string' && TIMEFRAME_SET.has(v);
}
