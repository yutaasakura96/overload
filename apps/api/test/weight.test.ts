import { describe, expect, it } from 'vitest';
import {
  dailyWeights,
  weekChangeKg,
  weightSection,
  weightTrend,
  type WeighInReading,
} from '../src/domain/weight';

// S11's derived values (docs/11 §2, issue #76): the day's weight by the before-10:00 rule in the
// profile's time zone, and the trend, an EWMA at 10% a day (docs/03 §8.3).

let next = 0;
const reading = (measuredAt: string, weightKg: number): WeighInReading => ({
  id: `w${String(++next).padStart(3, '0')}`,
  measuredAt: new Date(measuredAt),
  weightKg,
});

describe('dailyWeights', () => {
  it('takes the first reading before 10:00 local as the day’s, even when an earlier one is later in the list', () => {
    const late = reading('2026-10-05T00:30:00Z', 82.9); // 09:30 in Tokyo
    const early = reading('2026-10-04T22:10:00Z', 82.4); // 07:10 in Tokyo
    const evening = reading('2026-10-05T11:00:00Z', 83.5); // 20:00 in Tokyo
    expect(dailyWeights([late, evening, early], 'Asia/Tokyo')).toEqual([
      { date: '2026-10-05', weighInId: early.id, weightKg: 82.4, morning: true },
    ]);
  });

  it('counts 09:59 as morning and 10:00 as not', () => {
    const before = reading('2026-10-05T00:59:59Z', 82); // 09:59:59 in Tokyo
    const at = reading('2026-10-06T01:00:00Z', 82); // 10:00:00 in Tokyo
    expect(dailyWeights([before, at], 'Asia/Tokyo')).toEqual([
      { date: '2026-10-05', weighInId: before.id, weightKg: 82, morning: true },
      { date: '2026-10-06', weighInId: at.id, weightKg: 82, morning: false },
    ]);
  });

  it('falls back to the day’s first reading, flagged as not a morning weigh-in', () => {
    const noon = reading('2026-10-05T03:00:00Z', 83.1); // 12:00 in Tokyo
    const night = reading('2026-10-05T12:00:00Z', 83.6); // 21:00 in Tokyo
    expect(dailyWeights([night, noon], 'Asia/Tokyo')).toEqual([
      { date: '2026-10-05', weighInId: noon.id, weightKg: 83.1, morning: false },
    ]);
  });

  it('reads the day and the hour in the profile’s time zone', () => {
    // 23:30 UTC on the 4th: 08:30 on the 5th in Tokyo, 19:30 on the 4th in New York.
    const one = reading('2026-10-04T23:30:00Z', 80);
    expect(dailyWeights([one], 'Asia/Tokyo')).toEqual([
      { date: '2026-10-05', weighInId: one.id, weightKg: 80, morning: true },
    ]);
    expect(dailyWeights([one], 'America/New_York')).toEqual([
      { date: '2026-10-04', weighInId: one.id, weightKg: 80, morning: false },
    ]);
  });

  it('reads a reading in the repeated hour of a DST change by its wall clock', () => {
    // 1 November 2026, New York: 01:30 happens twice. Both are before 10:00 and the first counts.
    const firstPass = reading('2026-11-01T05:30:00Z', 80); // 01:30 EDT
    const secondPass = reading('2026-11-01T06:30:00Z', 81); // 01:30 EST
    expect(dailyWeights([secondPass, firstPass], 'America/New_York')).toEqual([
      { date: '2026-11-01', weighInId: firstPass.id, weightKg: 80, morning: true },
    ]);
  });

  it('returns the days oldest first and nothing for no readings', () => {
    const b = reading('2026-10-07T22:00:00Z', 81);
    const a = reading('2026-10-02T22:00:00Z', 82);
    expect(dailyWeights([b, a], 'Asia/Tokyo').map((day) => day.date)).toEqual([
      '2026-10-03',
      '2026-10-08',
    ]);
    expect(dailyWeights([], 'Asia/Tokyo')).toEqual([]);
  });
});

const day = (date: string, weightKg: number) => ({
  date,
  weighInId: date,
  weightKg,
  morning: true,
});

describe('weightTrend', () => {
  it('has no trend with fewer than 3 weighed days', () => {
    const two = weightTrend([day('2026-10-01', 82), day('2026-10-02', 81)]);
    expect(two.trendAvailable).toBe(false);
    expect(two.days.map((d) => d.trendKg)).toEqual([null, null]);
    expect(weightTrend([]).trendAvailable).toBe(false);
  });

  it('starts at the first weight and moves 10% of the way on consecutive days', () => {
    const { days, trendAvailable } = weightTrend([
      day('2026-10-01', 80),
      day('2026-10-02', 90),
      day('2026-10-03', 90),
    ]);
    expect(trendAvailable).toBe(true);
    // 80, then 80 + 0.1 × 10 = 81, then 81 + 0.1 × 9 = 81.9.
    expect(days.map((d) => d.trendKg)).toEqual([80, 81, 81.9]);
  });

  it('weights a gap by its days, 1 − 0.9^Δd, rather than as one step', () => {
    const { days } = weightTrend([
      day('2026-10-01', 80),
      day('2026-10-02', 80),
      day('2026-10-06', 90),
    ]);
    // Four days on: a = 1 − 0.9⁴ = 0.3439, so 80 + 3.439.
    expect(days[2]?.trendKg).toBe(83.44);
  });

  it('carries the daily weights through unchanged', () => {
    const { days } = weightTrend([
      { date: '2026-10-01', weighInId: 'a', weightKg: 80, morning: false },
      day('2026-10-02', 81),
      day('2026-10-03', 82),
    ]);
    expect(days[0]).toEqual({
      date: '2026-10-01',
      weighInId: 'a',
      weightKg: 80,
      morning: false,
      trendKg: 80,
    });
  });
});

describe('weekChangeKg', () => {
  const trended = weightTrend([
    day('2026-10-01', 84),
    day('2026-10-05', 83),
    day('2026-10-09', 82),
    day('2026-10-12', 82),
  ]).days;

  it('is the latest trend less the trend at the latest weighed day a week or more ago', () => {
    const latest = trended[3]?.trendKg ?? 0;
    const weekAgo = trended[1]?.trendKg ?? 0; // 5 Oct is the latest on or before 12 − 7 = 5 Oct.
    expect(weekChangeKg(trended, '2026-10-12')).toBe(Math.round((latest - weekAgo) * 100) / 100);
  });

  it('is null without a weighed day a week before today, or without a trend', () => {
    expect(weekChangeKg(trended, '2026-10-07')).toBeNull();
    expect(weekChangeKg(weightTrend([day('2026-10-01', 80)]).days, '2026-10-30')).toBeNull();
  });

  it('is null when the latest weighed day is on or before the week boundary', () => {
    const stale = weightTrend([
      day('2026-10-01', 84),
      day('2026-10-02', 83),
      day('2026-10-03', 82),
    ]);
    expect(weekChangeKg(stale.days, '2026-10-16')).toBeNull();
    expect(weekChangeKg(stale.days, '2026-10-10')).toBeNull(); // 3 Oct is the boundary itself
    expect(weekChangeKg(stale.days, '2026-10-09')).not.toBeNull();
  });
});

describe('weightSection', () => {
  it('lists the range’s weigh-ins newest first and its days newest first, trended from all history', () => {
    const readings = [
      reading('2026-09-01T22:00:00Z', 90),
      reading('2026-10-01T22:00:00Z', 80),
      reading('2026-10-02T22:00:00Z', 80),
      reading('2026-10-03T05:00:00Z', 81), // 14:00 on the 3rd: stored, not the day's weight
    ];
    const section = weightSection(readings, 'Asia/Tokyo', {
      from: '2026-10-02',
      to: '2026-10-03',
      today: '2026-10-03',
    });
    expect(section.weighIns.map((w) => w.id)).toEqual([
      readings[3]?.id,
      readings[2]?.id,
      readings[1]?.id,
    ]);
    expect(section.days.map((d) => d.date)).toEqual(['2026-10-03', '2026-10-02']);
    // The September reading started the trend, so it is available inside a two-day range.
    expect(section.trendAvailable).toBe(true);
    expect(section.days[0]?.weighInId).toBe(readings[2]?.id);
  });

  it('leaves out days after `to`, from the trend too', () => {
    const readings = [
      reading('2026-10-01T22:00:00Z', 80),
      reading('2026-10-02T22:00:00Z', 80),
      reading('2026-10-03T22:00:00Z', 80),
    ];
    const section = weightSection(readings, 'Asia/Tokyo', {
      to: '2026-10-03',
      today: '2026-10-04',
    });
    expect(section.days.map((d) => d.date)).toEqual(['2026-10-03', '2026-10-02']);
    expect(section.trendAvailable).toBe(false);
  });
});
