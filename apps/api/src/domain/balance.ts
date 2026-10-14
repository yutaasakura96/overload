import type { LoggedSet } from './e1rm.js';

// Muscle balance (docs/07 §3, docs/06 2026-10-10 Q13 and Q14): working sets a week for each muscle
// group, against one range for every group. A set counts whole for the group its exercise is filed
// under and half for each group it also trains. The default view is the average of the last four
// weeks, because a week in progress always reads low.

export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const BALANCE_VIEWS = ['4w', 'week'] as const;
export type BalanceView = (typeof BALANCE_VIEWS)[number];

/** Ten to twenty working sets a week, the same for every group, rated moderate (Q13). */
export const WEEKLY_SETS_RANGE = { low: 10, high: 20 } as const;
/** What one set is worth to a group the exercise trains indirectly. */
export const INDIRECT_SHARE = 0.5;

export const MUSCLE_STATUSES = ['in_range', 'low', 'none', 'high'] as const;
export type MuscleStatus = (typeof MUSCLE_STATUSES)[number];

/** One exercise in one workout: its local date, its groups and every set of it. */
export type LoggedExercise = {
  date: string;
  exerciseId: string;
  name: string;
  /** Null on a custom exercise filed under no group: its sets count whole nowhere. */
  muscleGroup: MuscleGroup | null;
  secondaryMuscleGroups: MuscleGroup[];
  sets: LoggedSet[];
};

/** Where a group's sets came from: one exercise, whole or half. */
export type MuscleSource = {
  exerciseId: string;
  name: string;
  indirect: boolean;
  /** Its sets a week for this group, to the tenth. */
  sets: number;
};

export type MuscleBalance = {
  muscleGroup: MuscleGroup;
  /** Every set a week, whole and half, to the tenth. The status reads this figure. */
  sets: number;
  /** The whole sets a week, to the tenth. */
  directSets: number;
  status: MuscleStatus;
  /** Oldest first, by when each first came up in the view. */
  sources: MuscleSource[];
};

export type Balance = {
  view: BalanceView;
  /** The view's first local date. */
  from: string;
  to: string;
  /** What the sets are divided by: four for the average, one for this week. */
  weeks: number;
  range: { low: number; high: number };
  /** Every group, in `MUSCLE_GROUPS` order, trained or not. */
  groups: MuscleBalance[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The view's first local date and its weeks: the last 28 days, or this week from Monday. */
export function balanceWindow(view: BalanceView, today: string) {
  const day = Date.parse(`${today}T00:00:00Z`);
  if (view === '4w') return { from: toDate(day - 27 * DAY_MS), weeks: 4 };
  const sinceMonday = (new Date(day).getUTCDay() + 6) % 7;
  return { from: toDate(day - sinceMonday * DAY_MS), weeks: 1 };
}

/**
 * Sets a week to the tenth, halves rounded up. The count is kept in half sets, a whole number, so
 * a quarter (a half set over two weeks, a set over four) rounds the same way every time.
 */
const perWeek = (halfSets: number, weeks: number) => Math.round((halfSets * 10) / (2 * weeks)) / 10;

/** The status a figure reads as. Both ends of the range are in it. */
export function muscleStatus(sets: number): MuscleStatus {
  if (sets === 0) return 'none';
  if (sets < WEEKLY_SETS_RANGE.low) return 'low';
  if (sets > WEEKLY_SETS_RANGE.high) return 'high';
  return 'in_range';
}

/**
 * Weekly working sets for every muscle group over a view ending on `today`. A warm-up is not a
 * working set (S6), so it counts nowhere. The figure is rounded to the tenth before it is judged,
 * so the status never disagrees with the number beside it.
 */
export function weeklySets(view: BalanceView, today: string, logged: LoggedExercise[]): Balance {
  const { from, weeks } = balanceWindow(view, today);
  const tally = new Map(
    MUSCLE_GROUPS.map((group) => [
      group,
      {
        direct: 0,
        half: 0,
        sources: new Map<string, Omit<MuscleSource, 'sets'> & { half: number }>(),
      },
    ]),
  );
  const add = (group: MuscleGroup, entry: LoggedExercise, working: number, indirect: boolean) => {
    const row = tally.get(group);
    if (row === undefined) return;
    // In half sets: a whole set is two, an indirect one is one.
    const halves = indirect ? working * INDIRECT_SHARE * 2 : working * 2;
    if (indirect) row.half += halves;
    else row.direct += halves;
    const key = `${entry.exerciseId}:${indirect ? 'half' : 'whole'}`;
    const source = row.sources.get(key) ?? {
      exerciseId: entry.exerciseId,
      name: entry.name,
      indirect,
      half: 0,
    };
    source.half += halves;
    row.sources.set(key, source);
  };

  for (const entry of logged.toSorted((a, b) => a.date.localeCompare(b.date))) {
    if (entry.date < from || entry.date > today) continue;
    const working = entry.sets.filter((set) => !set.isWarmup).length;
    if (working === 0) continue;
    if (entry.muscleGroup !== null) add(entry.muscleGroup, entry, working, false);
    for (const group of new Set(entry.secondaryMuscleGroups)) {
      if (group !== entry.muscleGroup) add(group, entry, working, true);
    }
  }

  return {
    view,
    from,
    to: today,
    weeks,
    range: { low: WEEKLY_SETS_RANGE.low, high: WEEKLY_SETS_RANGE.high },
    groups: MUSCLE_GROUPS.map((group) => {
      const row = tally.get(group) ?? { direct: 0, half: 0, sources: new Map() };
      const sets = perWeek(row.direct + row.half, weeks);
      return {
        muscleGroup: group,
        sets,
        directSets: perWeek(row.direct, weeks),
        status: muscleStatus(sets),
        sources: [...row.sources.values()].map((source) => ({
          exerciseId: source.exerciseId,
          name: source.name,
          indirect: source.indirect,
          sets: perWeek(source.half, weeks),
        })),
      };
    }),
  };
}
