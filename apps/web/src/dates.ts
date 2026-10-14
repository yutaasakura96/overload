// Dates as History prints them (docs/10 §9). An instant is read in the profile's time zone, which
// is the day boundary everywhere else (docs/06, 2026-09-23).

const DAY_MS = 24 * 60 * 60 * 1000;

const formats = new Map<string, Intl.DateTimeFormat>();

function format(options: Intl.DateTimeFormatOptions, locale: string, timeZone: string) {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let made = formats.get(key);
  if (made === undefined) {
    made = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    formats.set(key, made);
  }
  return made;
}

/**
 * `Fri 9 Oct`. Put together from parts, since every month is three letters here and `en-GB`
 * writes September as `Sept`.
 */
export function dayLabel(instant: string, timeZone: string): string {
  const parts = format(
    { weekday: 'short', day: 'numeric', month: 'short' },
    'en-US',
    timeZone,
  ).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((each) => each.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

/** `October 2026`: the month a workout is listed under. */
export const monthLabel = (instant: string, timeZone: string) =>
  format({ month: 'long', year: 'numeric' }, 'en-GB', timeZone).format(new Date(instant));

/** `18:30`. */
export const clockLabel = (instant: string, timeZone: string) =>
  format({ hour: '2-digit', minute: '2-digit' }, 'en-GB', timeZone).format(new Date(instant));

/** The local date of an instant, `YYYY-MM-DD`. */
export const localDate = (instant: string | number, timeZone: string) =>
  format({ year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA', timeZone).format(
    new Date(instant),
  );

/** How long ago a workout was, counted in local days: `today`, `yesterday`, `5 days ago`, `3 weeks ago`. */
export function agoLabel(instant: string, timeZone: string, now = Date.now()): string {
  const days = Math.round(
    (Date.parse(localDate(now, timeZone)) - Date.parse(localDate(instant, timeZone))) / DAY_MS,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < 14 ? `${days} days ago` : `${Math.round(days / 7)} weeks ago`;
}

/** A workout's length in whole minutes, and never none. */
export const minutesBetween = (startedAt: string, endedAt: string) =>
  Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000));
