import {
  TIMEZONE_OPTIONS,
  timeZoneOffsetMinutes,
  timeZoneLabel,
  formatUtcOffset,
} from './timezones';

/**
 * The timezone list for PUBLIC, unauthenticated pages (#99).
 *
 * ── Why a separate module and not an export of the full one ──
 * Importing any binding from a module evaluates ALL of it. That is precisely the
 * defect this replaces: `viewer-timezone` imported two cheap helpers from
 * `timezones.ts` and thereby built the 419-zone table at module scope on every
 * public page — including for a visitor whose link was invalid and who never saw
 * the control. Putting the curated list beside the full one would recreate that
 * exactly, so `timezone-options.ts` (full, for Settings) and this file are
 * deliberately separate entry points and must stay that way. Guarded by
 * `timezone-module-boundaries.test.ts`.
 *
 * ── Why curated rather than complete ──
 * A report viewer is confirming which clock a timestamp is on. They recognise
 * "Central Time", not "America/Indiana/Tell_City". Mainstream pickers ship
 * roughly this many hand-picked zones with human labels for that reason.
 *
 * Measured at a 6x CPU throttle, cold: the full 419-zone table costs ~450ms to
 * build, ~86 zones costs ~160-230ms. The difference is not proportional because
 * ~110ms of it is ICU's one-time initialisation, which no shortening removes.
 *
 * ── Why Settings keeps the complete list ──
 * Curation has a real cost, and it is not hypothetical: cal.com shipped a
 * shortened list and had to reopen it as a high-priority issue to put the
 * missing cities back. A tenant configuring their company's zone needs to find
 * their actual zone. A viewer correcting a browser guess on a public report does
 * not — and if their zone is genuinely absent, `publicTimezoneOptions` adds it.
 */

/** Curated zones, IANA id → the name a reader would recognise. */
const CURATED: Record<string, string> = {
  UTC: 'UTC',
  // North America
  'America/New_York': 'Eastern Time',
  'America/Detroit': 'Eastern Time — Detroit',
  'America/Toronto': 'Eastern Time — Toronto',
  'America/Chicago': 'Central Time',
  'America/Winnipeg': 'Central Time — Winnipeg',
  'America/Mexico_City': 'Central Time — Mexico City',
  'America/Denver': 'Mountain Time',
  'America/Edmonton': 'Mountain Time — Edmonton',
  'America/Phoenix': 'Arizona (no DST)',
  'America/Los_Angeles': 'Pacific Time',
  'America/Vancouver': 'Pacific Time — Vancouver',
  'America/Anchorage': 'Alaska Time',
  'Pacific/Honolulu': 'Hawaii Time',
  'America/Puerto_Rico': 'Atlantic Time — Puerto Rico',
  'America/Halifax': 'Atlantic Time — Halifax',
  'America/St_Johns': 'Newfoundland Time',
  // Central & South America
  'America/Guatemala': 'Guatemala, San Salvador',
  'America/Panama': 'Panama',
  'America/Bogota': 'Bogota, Lima, Quito',
  'America/Caracas': 'Caracas',
  'America/Santiago': 'Santiago',
  'America/Sao_Paulo': 'Brasilia, Sao Paulo',
  'America/Argentina/Buenos_Aires': 'Buenos Aires',
  'America/Montevideo': 'Montevideo',
  // Atlantic & Europe
  'Atlantic/Reykjavik': 'Reykjavik',
  'Europe/London': 'London, Dublin, Edinburgh',
  'Europe/Lisbon': 'Lisbon',
  'Europe/Madrid': 'Madrid',
  'Europe/Paris': 'Paris',
  'Europe/Brussels': 'Brussels, Amsterdam',
  'Europe/Amsterdam': 'Amsterdam',
  'Europe/Berlin': 'Berlin, Frankfurt, Munich',
  'Europe/Zurich': 'Zurich, Bern',
  'Europe/Vienna': 'Vienna',
  'Europe/Prague': 'Prague, Bratislava',
  'Europe/Rome': 'Rome, Milan',
  'Europe/Stockholm': 'Stockholm',
  'Europe/Oslo': 'Oslo',
  'Europe/Copenhagen': 'Copenhagen',
  'Europe/Warsaw': 'Warsaw',
  'Europe/Budapest': 'Budapest',
  'Europe/Athens': 'Athens',
  'Europe/Helsinki': 'Helsinki',
  'Europe/Bucharest': 'Bucharest',
  'Europe/Kyiv': 'Kyiv',
  'Europe/Istanbul': 'Istanbul',
  'Europe/Moscow': 'Moscow, St. Petersburg',
  // Africa & Middle East
  'Africa/Casablanca': 'Casablanca',
  'Africa/Lagos': 'Lagos, Kinshasa',
  'Africa/Cairo': 'Cairo',
  'Africa/Johannesburg': 'Johannesburg, Harare',
  'Africa/Nairobi': 'Nairobi, Addis Ababa',
  'Asia/Jerusalem': 'Jerusalem, Tel Aviv',
  'Asia/Beirut': 'Beirut',
  'Asia/Riyadh': 'Riyadh, Kuwait',
  'Asia/Tehran': 'Tehran',
  'Asia/Dubai': 'Dubai, Abu Dhabi',
  // Asia
  'Asia/Karachi': 'Karachi, Islamabad',
  'Asia/Kolkata': 'Mumbai, New Delhi, Kolkata',
  'Asia/Kathmandu': 'Kathmandu',
  'Asia/Dhaka': 'Dhaka',
  'Asia/Colombo': 'Colombo',
  'Asia/Yangon': 'Yangon',
  'Asia/Bangkok': 'Bangkok, Hanoi, Jakarta',
  'Asia/Jakarta': 'Jakarta',
  'Asia/Shanghai': 'Beijing, Shanghai',
  'Asia/Hong_Kong': 'Hong Kong',
  'Asia/Taipei': 'Taipei',
  'Asia/Singapore': 'Singapore, Kuala Lumpur',
  'Asia/Manila': 'Manila',
  'Asia/Seoul': 'Seoul',
  'Asia/Tokyo': 'Osaka, Sapporo, Tokyo',
  'Asia/Almaty': 'Almaty',
  'Asia/Tashkent': 'Tashkent',
  'Asia/Yekaterinburg': 'Yekaterinburg',
  'Asia/Novosibirsk': 'Novosibirsk',
  'Asia/Vladivostok': 'Vladivostok',
  // Oceania
  'Australia/Perth': 'Perth',
  'Australia/Adelaide': 'Adelaide',
  'Australia/Darwin': 'Darwin',
  'Australia/Brisbane': 'Brisbane',
  'Australia/Sydney': 'Sydney, Melbourne',
  'Australia/Hobart': 'Hobart',
  'Pacific/Auckland': 'Auckland, Wellington',
  'Pacific/Fiji': 'Fiji',
  'Pacific/Guam': 'Guam, Port Moresby',
  'Pacific/Midway': 'Midway Island, Samoa',
};

/**
 * Zones that have been RENAMED, modern id → the older spelling.
 *
 * `Intl.supportedValuesOf('timeZone')` reports canonical ids and omits aliases,
 * and which spelling is canonical depends on how old the runtime's ICU is: this
 * repo's Node still answers `Asia/Calcutta` where current browsers answer
 * `Asia/Kolkata`. Hard-coding either spelling is therefore wrong somewhere.
 *
 * The failure is silent, which is why this map exists rather than a comment.
 * `Intl.DateTimeFormat` ACCEPTS both spellings, so an entry the runtime does not
 * list still produces a correct offset and a correct label — nothing throws and
 * nothing looks wrong. But `viewer-timezone` decides whether to adopt the
 * browser's zone with `TIMEZONE_OPTIONS.includes(...)`, so a mismatch shows the
 * viewer two options for the one zone they are actually in.
 */
const RENAMED: Record<string, string> = {
  'Asia/Kolkata': 'Asia/Calcutta',
  'Asia/Kathmandu': 'Asia/Katmandu',
  'Asia/Yangon': 'Asia/Rangoon',
  'Europe/Kyiv': 'Europe/Kiev',
  'America/Argentina/Buenos_Aires': 'America/Buenos_Aires',
};

export interface TimeZoneOption {
  value: string;
  label: string;
}

/** The spelling THIS runtime lists, or null if it knows neither. */
function resolveId(id: string): string | null {
  if (TIMEZONE_OPTIONS.includes(id)) return id;
  const older = RENAMED[id];
  if (older && TIMEZONE_OPTIONS.includes(older)) return older;
  return null;
}

const build = (ids: [string, string][]): TimeZoneOption[] =>
  ids
    .map(([id, name]) => ({ id: resolveId(id), name }))
    // Dropping is right where a runtime genuinely cannot represent a zone: a
    // value with no matching entry in TIMEZONE_OPTIONS is one viewer-timezone
    // would refuse to adopt anyway. `curatedZoneCount` is asserted against a
    // floor so a runtime that resolved almost nothing fails loudly instead of
    // quietly serving a three-entry picker.
    .filter((z): z is { id: string; name: string } => z.id !== null)
    .map(({ id, name }) => ({ id, name, offset: timeZoneOffsetMinutes(id) }))
    .sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name))
    .map(({ id, name, offset }) => ({
      value: id,
      // Same `(UTC±HH:MM) …` shape the Settings picker uses, so the two surfaces
      // read alike; only the trailing name differs (recognisable vs canonical).
      label: `(${formatUtcOffset(offset)}) ${name}`,
    }));

const CURATED_OPTIONS = build(Object.entries(CURATED));
const CURATED_VALUES = new Set(CURATED_OPTIONS.map((o) => o.value));

/**
 * Options for the public viewer's zone picker.
 *
 * `current` is added when it is not one of the curated zones, and that is not a
 * nicety. A `<select>` whose `value` matches no `<option>` silently displays the
 * FIRST option instead — so a viewer in an uncurated zone would be told their
 * times are in some other zone entirely, with no error anywhere. The extra entry
 * is labelled with its canonical id, because for a zone nobody curated that is
 * the only honest name available.
 */
export function publicTimezoneOptions(current: string | null | undefined): TimeZoneOption[] {
  // Membership is tested against the RESOLVED values, not the authored keys —
  // otherwise a viewer whose runtime says `Asia/Calcutta` would be handed a
  // second entry for the zone already in the list under that same spelling.
  if (!current || CURATED_VALUES.has(current)) return CURATED_OPTIONS;
  const extra: TimeZoneOption = { value: current, label: timeZoneLabel(current) };
  const offset = timeZoneOffsetMinutes(current);
  const at = CURATED_OPTIONS.findIndex((o) => timeZoneOffsetMinutes(o.value) > offset);
  return at === -1
    ? [...CURATED_OPTIONS, extra]
    : [...CURATED_OPTIONS.slice(0, at), extra, ...CURATED_OPTIONS.slice(at)];
}

/** The zone ids actually offered on this runtime (post alias resolution).
 *  Exposed for the coverage tests, not for rendering. */
export const CURATED_ZONE_IDS = CURATED_OPTIONS.map((o) => o.value);

/** How many authored entries this runtime could not represent at all. A non-zero
 *  value means `RENAMED` needs an entry — see the tests. */
export const CURATED_DROPPED = Object.keys(CURATED).length - CURATED_OPTIONS.length;
