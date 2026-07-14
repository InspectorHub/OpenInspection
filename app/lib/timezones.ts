/** IANA timezone ids for the settings pickers. Runtime built-in — no library.
 *  `supportedValuesOf` exists in the Workers/V8 runtime and modern browsers;
 *  the fallback keeps SSR safe if it is ever unavailable. */
export const TIMEZONE_OPTIONS: string[] = (() => {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.('timeZone');
    if (list && list.length) return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    /* fall through */
  }
  return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
})();
