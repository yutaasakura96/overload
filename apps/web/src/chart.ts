// The geometry of docs/05 §5's e1RM chart: where a value and a date fall on the canvas, and what
// the axes say. Drawing only. What is plotted comes from the API (CLAUDE.md, binding rules).

/** The canvas of the e1RM chart, at any width: the plot ends 68px short, at the end-label gutter. */
export const E1RM_CHART = {
  height: 192,
  plotLeft: 24,
  endGutter: 68,
  gridlines: [26.7, 76.7, 126.7],
  gridGap: 50,
  baseline: 160,
  dateLabels: 178,
} as const;

const STEPS = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

/** How far under the lowest gridline a value may sit, in steps, and stay clear of the baseline. */
const BELOW_LOWEST = 0.5;

/**
 * The value scale: three gridlines a round step apart, the top one at or above the highest value,
 * with the smallest step that keeps the lowest value over the baseline.
 */
export function valueScale(values: number[]): { top: number; step: number } {
  const highest = Math.max(...values);
  const lowest = Math.min(...values);
  const lines = E1RM_CHART.gridlines.length - 1;
  for (const step of STEPS) {
    // No gridline under zero: a bodyweight exercise's e1RM is 0.
    const top = Math.max(Math.ceil(highest / step) * step, lines * step);
    if (top - (lines + BELOW_LOWEST) * step <= lowest) return { top, step };
  }
  const step = STEPS.at(-1) ?? 1;
  return { top: Math.ceil(highest / step) * step, step };
}

/** The y of a value on that scale. */
export const valueY = (value: number, scale: { top: number; step: number }) =>
  E1RM_CHART.gridlines[0] + ((scale.top - value) / scale.step) * E1RM_CHART.gridGap;

/** The three gridline values, top first, as the axis prints them. */
export function gridValues(scale: { top: number; step: number }): string[] {
  const values = E1RM_CHART.gridlines.map((_, index) => scale.top - index * scale.step);
  const whole = values.every((value) => Number.isInteger(value));
  return values.map((value) => (whole ? String(value) : value.toFixed(1)));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * The x of a local date on an axis that runs from `from` to a later `to`, in proportion to the
 * days between: a fortnight's gap is twice as wide as a week's.
 */
export function dateX(
  date: string,
  from: string,
  to: string,
  plot: { left: number; right: number },
) {
  const days = dayOf(to) - dayOf(from);
  return plot.left + ((dayOf(date) - dayOf(from)) / days) * (plot.right - plot.left);
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** `24 JUN`, or `24 JUN 2026` when asked for the year. */
export function dateLabel(date: string, withYear = false): string {
  const [year = '', month = '1', day = '1'] = date.split('-');
  const label = `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''}`;
  return withYear ? `${label} ${year}` : label;
}

/** The start, middle and end of the date axis. The year is printed only when the axis crosses one. */
export function axisDates(from: string, to: string): [string, string, string] {
  const withYear = from.slice(0, 4) !== to.slice(0, 4);
  const middle = dateOf(Math.floor((dayOf(from) + dayOf(to)) / 2));
  return [dateLabel(from, withYear), dateLabel(middle, withYear), dateLabel(to, withYear)];
}

/** The index of the x nearest to a pointer's. */
export function nearestIndex(xs: number[], x: number): number {
  let nearest = 0;
  xs.forEach((candidate, index) => {
    if (Math.abs(candidate - x) < Math.abs((xs[nearest] ?? 0) - x)) nearest = index;
  });
  return nearest;
}
