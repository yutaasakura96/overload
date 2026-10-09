/** The IANA time zone names the app offers, and the search over them. */

const fallback = ['UTC'];

/** The device's own IANA time zone name. */
export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Every IANA zone the browser knows, plus `extra` (the saved zone and the device's own): an engine
 * may spell a zone differently from its list, or leave `UTC` out, and neither may drop from view.
 */
export function timezoneList(extra: readonly string[] = []): string[] {
  const known =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : fallback;
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

/** `America/Argentina/Buenos_Aires` as `Buenos Aires`, the part a person looks for. */
export const timezoneCity = (zone: string) => (zone.split('/').at(-1) ?? zone).replaceAll('_', ' ');

/** The zone's UTC offset now, `UTC+09:00`, or `''` where the engine cannot say. */
export function timezoneOffset(zone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    if (part === undefined) return '';
    return part === 'GMT' ? 'UTC+00:00' : part.replace('GMT', 'UTC');
  } catch {
    return '';
  }
}
