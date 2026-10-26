import { describe, expect, it } from 'vitest';
import {
  appliedCalories,
  maintenanceCheck,
  windowExpenditure,
  type CompleteDay,
} from '../src/domain/maintenance';
import { trendSeries, type DailyWeight } from '../src/domain/weight';

// S18a's estimate and its gates (docs/03 §8.3, docs/07 §5, issue #82): 14 complete days in total,
// 3 weighed days in the trailing 14 with one in the newest 7, the low-recent-logging label below 5
// of the newest 7, and what applying it sets on a cut, a bulk and maintenance.

const TODAY = '2026-11-09';
const DAY_MS = 86_400_000;
const daysAgo = (days: number, from = TODAY) =>
  new Date(Date.parse(`${from}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

const weight = (ago: number, weightKg: number): DailyWeight => ({
  date: daysAgo(ago),
  weighInId: `w${ago}`,
  weightKg,
  morning: true,
});

/** Complete days `ago` days back, each eating `energyKcal`. */
const eaten = (agos: number[], energyKcal = 2450): CompleteDay[] =>
  agos.map((ago) => ({ date: daysAgo(ago), energyKcal }));

const range = (from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, index) => from - index);

/** A weigh-in every day from `from` days ago to today, falling `perDay` kg a day from 83. */
const daily = (from: number, perDay = 0) =>
  range(from, 0).map((ago) => weight(ago, Math.round((83 - (from - ago) * perDay) * 100) / 100));

const ready = (check: ReturnType<typeof maintenanceCheck>) => {
  if (check.status !== 'ready') throw new Error(`Expected ready, got ${check.status}`);
  return check;
};

describe('maintenanceCheck: the gates', () => {
  const weights = daily(30);
  const days = eaten(range(13, 0));

  it('collects until 14 complete days in total, saying how many remain', () => {
    expect(
      maintenanceCheck({ today: TODAY, completeDaysTotal: 13, completeDays: days, weights }),
    ).toEqual({
      status: 'collecting',
      completeDaysTotal: 13,
      remaining: 1,
      method: 'weight_trend_balance_v1',
    });
    expect(
      maintenanceCheck({ today: TODAY, completeDaysTotal: 14, completeDays: days, weights }).status,
    ).toBe('ready');
  });

  it('reads the trailing 14 calendar days, today included', () => {
    const check = ready(
      maintenanceCheck({ today: TODAY, completeDaysTotal: 40, completeDays: days, weights }),
    );
    expect(check.from).toBe('2026-10-27');
    expect(check.to).toBe(TODAY);
    expect(check.completeDaysInWindow).toBe(14);
    // A complete day the day before the window counts towards the total, never the mean.
    const outside = maintenanceCheck({
      today: TODAY,
      completeDaysTotal: 40,
      completeDays: [...eaten([14], 9000), ...days],
      weights,
    });
    expect(ready(outside).meanIntakeKcal).toBe(2450);
  });

  it('needs a weigh-in with 2 weighed days in the window, and is ready with 3', () => {
    const two = [weight(20, 84), weight(18, 83.8), weight(9, 83.5), weight(2, 83.2)];
    const twoCheck = maintenanceCheck({
      today: TODAY,
      completeDaysTotal: 20,
      completeDays: days,
      weights: two,
    });
    expect(twoCheck).toMatchObject({
      status: 'needs_weigh_in',
      weighInsInWindow: 2,
      lastWeighedOn: daysAgo(2),
      completeDaysInWindow: 14,
      lowRecentLogging: false,
    });
    expect(twoCheck).not.toHaveProperty('maintenanceKcal');
    const three = [...two, weight(5, 83.3)].toSorted((a, b) => (a.date < b.date ? -1 : 1));
    expect(
      maintenanceCheck({ today: TODAY, completeDaysTotal: 20, completeDays: days, weights: three })
        .status,
    ).toBe('ready');
  });

  it('needs a weigh-in with none in the newest 7 days, and is ready with one on the 7th', () => {
    const stale = [weight(13, 83.6), weight(10, 83.4), weight(7, 83.3)];
    expect(
      maintenanceCheck({ today: TODAY, completeDaysTotal: 20, completeDays: days, weights: stale }),
    ).toMatchObject({ status: 'needs_weigh_in', weighInsInWindow: 3, lastWeighedOn: daysAgo(7) });
    const recent = [weight(13, 83.6), weight(10, 83.4), weight(6, 83.3)];
    expect(
      maintenanceCheck({ today: TODAY, completeDaysTotal: 20, completeDays: days, weights: recent })
        .status,
    ).toBe('ready');
  });

  it('labels the figure with 4 of the newest 7 days complete, and not with 5', () => {
    const four = eaten([13, 12, 11, 10, 9, 8, 7, 6, 4, 2, 0]);
    const low = ready(
      maintenanceCheck({ today: TODAY, completeDaysTotal: 30, completeDays: four, weights }),
    );
    expect(low).toMatchObject({ recentCompleteDays: 4, lowRecentLogging: true });
    const five = eaten([13, 12, 11, 10, 9, 8, 7, 6, 4, 3, 2, 0]);
    expect(
      ready(maintenanceCheck({ today: TODAY, completeDaysTotal: 30, completeDays: five, weights })),
    ).toMatchObject({ recentCompleteDays: 5, lowRecentLogging: false });
  });

  it('needs logging when no day in the window is complete', () => {
    expect(
      maintenanceCheck({
        today: TODAY,
        completeDaysTotal: 30,
        completeDays: eaten([20, 15]),
        weights,
      }),
    ).toMatchObject({ status: 'needs_logging', completeDaysInWindow: 0, lowRecentLogging: true });
  });
});

describe('maintenanceCheck: the estimate', () => {
  it('is mean intake less the trend’s rate × 7,700 when the weight holds', () => {
    const check = ready(
      maintenanceCheck({
        today: TODAY,
        completeDaysTotal: 14,
        completeDays: eaten(range(13, 0)),
        weights: daily(40),
      }),
    );
    expect(check).toMatchObject({
      meanIntakeKcal: 2450,
      trendChangeKgPerWeek: 0,
      maintenanceKcal: 2450,
    });
  });

  it('adds the energy of the weight lost, over the 14 days from the day before the window', () => {
    const weights = daily(60, 0.02);
    const series = trendSeries(weights);
    const end = series.at(-1)?.trendKg ?? 0;
    const start = series.find((day) => day.date === daysAgo(14))?.trendKg ?? 0;
    const perDay = (end - start) / 14;
    const check = ready(
      maintenanceCheck({
        today: TODAY,
        completeDaysTotal: 14,
        completeDays: eaten(range(13, 0)),
        weights,
      }),
    );
    expect(check.trendChangeKgPerWeek).toBe(Math.round(perDay * 7 * 100) / 100);
    expect(check.maintenanceKcal).toBe(Math.round((2450 - perDay * 7700) / 10) * 10);
    expect(check.maintenanceKcal).toBeGreaterThan(2450);
  });

  it('averages complete days only', () => {
    const check = ready(
      maintenanceCheck({
        today: TODAY,
        completeDaysTotal: 20,
        completeDays: [...eaten([13, 11, 9], 2000), ...eaten([7, 5, 3, 1], 3000)],
        weights: daily(40),
      }),
    );
    expect(check.meanIntakeKcal).toBe(Math.round((3 * 2000 + 4 * 3000) / 7));
  });

  it('ends on the window’s last weigh-in when the window ends on an unweighed day', () => {
    // Weighed to 3 days ago, then not: the span is 11 days, from the day before the window.
    const weights = daily(40, 0.03).filter((day) => day.date <= daysAgo(3));
    const series = trendSeries(weights);
    const start = series.find((day) => day.date === daysAgo(14))?.trendKg ?? 0;
    const end = series.at(-1)?.trendKg ?? 0;
    const estimate = windowExpenditure({
      window: { from: daysAgo(13), to: TODAY },
      completeDays: eaten(range(13, 0)),
      weights,
    });
    expect(estimate?.rateKgPerDay).toBeCloseTo((end - start) / 11, 10);
  });

  it('starts at the window’s first weigh-in for a new user who first weighed in inside it', () => {
    const weights = [weight(10, 84), weight(6, 83.6), weight(2, 83.2)];
    const series = trendSeries(weights);
    const estimate = windowExpenditure({
      window: { from: daysAgo(13), to: TODAY },
      completeDays: eaten(range(13, 0)),
      weights,
    });
    const [first, , last] = series;
    expect(estimate?.rateKgPerDay).toBeCloseTo(
      ((last?.trendKg ?? 0) - (first?.trendKg ?? 0)) / 8,
      10,
    );
  });

  it('takes the day before the window at the trend of the latest weigh-in on or before it', () => {
    // Nothing weighed for 5 days before the window: the start is the trend 19 days ago.
    const weights = [
      weight(30, 85),
      weight(25, 84.5),
      weight(19, 84),
      weight(10, 83.5),
      weight(6, 83.2),
      weight(1, 83),
    ];
    const series = trendSeries(weights);
    const start = series.find((day) => day.date === daysAgo(19))?.trendKg ?? 0;
    const end = series.at(-1)?.trendKg ?? 0;
    const estimate = windowExpenditure({
      window: { from: daysAgo(13), to: TODAY },
      completeDays: eaten(range(13, 0)),
      weights,
    });
    expect(estimate?.rateKgPerDay).toBeCloseTo((end - start) / 13, 10);
  });

  it('gives no estimate from two weighed days, or none in the newest 7', () => {
    const window = { from: daysAgo(13), to: TODAY };
    const completeDays = eaten(range(13, 0));
    expect(
      windowExpenditure({ window, completeDays, weights: [weight(9, 83), weight(2, 82)] }),
    ).toBeNull();
    expect(
      windowExpenditure({
        window,
        completeDays,
        weights: [weight(12, 84), weight(10, 83), weight(8, 82)],
      }),
    ).toBeNull();
  });
});

describe('appliedCalories', () => {
  it('takes the deficit for a cut’s rate off the estimate', () => {
    // 0.5% of 82.4 kg a week at 7,700 kcal per kg: 453 a day, to the nearest 10.
    expect(
      appliedCalories({
        maintenanceKcal: 2700,
        type: 'cut',
        targetRatePctPerWeek: 0.5,
        weightKg: 82.4,
      }),
    ).toEqual({ adjustmentKcal: -450, calorieTargetKcal: 2250 });
  });

  it('adds the surplus for a bulk’s rate, and nothing on maintenance', () => {
    expect(
      appliedCalories({
        maintenanceKcal: 2700,
        type: 'bulk',
        targetRatePctPerWeek: 0.25,
        weightKg: 70,
      }),
    ).toEqual({ adjustmentKcal: 190, calorieTargetKcal: 2890 });
    expect(
      appliedCalories({
        maintenanceKcal: 2700,
        type: 'maintain',
        targetRatePctPerWeek: null,
        weightKg: 70,
      }),
    ).toEqual({ adjustmentKcal: 0, calorieTargetKcal: 2700 });
  });

  it('holds the target to 1,000–6,000 kcal', () => {
    expect(
      appliedCalories({ maintenanceKcal: 1200, type: 'cut', targetRatePctPerWeek: 1, weightKg: 90 })
        .calorieTargetKcal,
    ).toBe(1000);
  });

  it('is carried on a ready check with the open phase, and null without one', () => {
    const input = {
      today: TODAY,
      completeDaysTotal: 14,
      completeDays: eaten(range(13, 0)),
      weights: daily(40),
    };
    expect(ready(maintenanceCheck(input)).apply).toBeNull();
    expect(
      ready(
        maintenanceCheck({
          ...input,
          phase: { id: 'p1', type: 'cut', targetRatePctPerWeek: 0.5, weightKg: 83 },
        }),
      ).apply,
    ).toEqual({ goalPhaseId: 'p1', adjustmentKcal: -460, calorieTargetKcal: 1990 });
  });
});
