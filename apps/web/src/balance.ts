import type { Balance, Exercise, MuscleBalance, MuscleGroup } from '@overload/api-contract';
import { localDate } from './dates';
import type { SetRecord, StoreRecord } from './set-store';

// This week's balance as the device sees it (docs/10 §9), the way History is (history.ts): the
// server's figures, with the set store's rows laid over them. A set counts as soon as it is logged,
// as the prototype's week does, and once only: the server already counts a set it has stored, and
// still counts one deleted here until it is told. Each set counts as the API counts it (docs/07
// §3): whole for its exercise's group, half for each group it also trains, warm-ups nowhere, by the
// local date its workout started.

type Source = MuscleBalance['sources'][number];

/**
 * The server holds a version of this record. One kept before `stored` was carried says so by its
 * state.
 */
const onServer = (record: StoreRecord) => record.stored === true || record.state === 'acknowledged';

/** The status a figure reads as against the range, both ends in it, as the API judges it. */
function statusOf(sets: number, range: Balance['range']): MuscleBalance['status'] {
  if (sets === 0) return 'none';
  if (sets < range.low) return 'low';
  if (sets > range.high) return 'high';
  return 'in_range';
}

const tenth = (sets: number) => Math.max(0, Math.round(sets * 10) / 10);

/**
 * The server's week with the device's sets laid over it: each set the device holds and the server
 * does not added, each the server holds and the device has deleted taken away. The four-week
 * average is the server's alone.
 */
export function balanceOnDevice(
  server: Balance,
  records: StoreRecord[],
  exercises: Exercise[],
  timeZone: string,
): Balance {
  if (server.view !== 'week') return server;
  const byId = new Map(records.map((record) => [record.id, record]));
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  // Per group, each source's change in sets: a whole set is 1, a half set 0.5.
  const changes = new Map<MuscleGroup, Map<string, Source>>();
  const change = (group: MuscleGroup, exercise: Exercise, indirect: boolean, sets: number) => {
    const sources = changes.get(group) ?? new Map<string, Source>();
    const key = `${exercise.id}:${indirect ? 'half' : 'whole'}`;
    const source = sources.get(key) ?? {
      exerciseId: exercise.id,
      name: exercise.name,
      indirect,
      sets: 0,
    };
    sources.set(key, { ...source, sets: source.sets + sets });
    changes.set(group, sources);
  };

  for (const set of records.filter((record): record is SetRecord => record.table === 'sets')) {
    if (set.row.isWarmup) continue;
    const slot = byId.get(set.row.workoutExerciseId);
    const workout = byId.get(set.workoutId);
    if (slot?.table !== 'workoutExercises' || workout?.table !== 'workouts') continue;
    const date = localDate(workout.row.startedAt, timeZone);
    if (date < server.from || date > server.to) continue;
    const exercise = exerciseById.get(slot.row.exerciseId);
    if (exercise === undefined) continue;
    const here = [set, slot, workout].every((record) => record.deletedAt === undefined) ? 1 : 0;
    const counted = here - (onServer(set) ? 1 : 0);
    if (counted === 0) continue;
    if (exercise.muscleGroup !== null) change(exercise.muscleGroup, exercise, false, counted);
    for (const group of new Set(exercise.secondaryMuscleGroups)) {
      if (group !== exercise.muscleGroup) change(group, exercise, true, counted / 2);
    }
  }
  if (changes.size === 0) return server;

  return {
    ...server,
    groups: server.groups.map((group) => {
      const added = changes.get(group.muscleGroup);
      if (added === undefined) return group;
      const sources = new Map(
        group.sources.map((source) => [
          `${source.exerciseId}:${source.indirect ? 'half' : 'whole'}`,
          source,
        ]),
      );
      let { sets, directSets } = group;
      for (const [key, each] of added) {
        sets += each.sets;
        if (!each.indirect) directSets += each.sets;
        const was = sources.get(key);
        sources.set(key, was === undefined ? each : { ...was, sets: was.sets + each.sets });
      }
      sets = tenth(sets);
      return {
        ...group,
        sets,
        directSets: tenth(directSets),
        status: statusOf(sets, server.range),
        sources: [...sources.values()]
          .map((source) => ({ ...source, sets: tenth(source.sets) }))
          .filter((source) => source.sets > 0),
      };
    }),
  };
}
