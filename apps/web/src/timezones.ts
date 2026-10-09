/** The IANA time zone names the app offers, and the search over them. */

/** The device's own IANA time zone name. */
export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Every IANA zone the browser knows, plus `extra` (the saved zone and the device's own): an engine
 * may spell a zone differently from its list, or leave `UTC` out, and neither may drop from view.
 */
export function timezoneList(extra: readonly string[] = []): string[] {
  const known = Intl.supportedValuesOf('timeZone');
  return [...new Set([...known, ...extra])].toSorted((a, b) => a.localeCompare(b, 'en'));
}

const words = (text: string) => text.toLowerCase().replaceAll('_', ' ').replaceAll('/', ' ');

/** The zones whose name holds every word typed, `new york` finding `America/New_York`. */
export function searchTimezones(zones: readonly string[], query: string): string[] {
  const terms = words(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...zones];
  return zones.filter((zone) => {
    const name = words(zone);
    return terms.every((term) => name.includes(term));
  });
}
