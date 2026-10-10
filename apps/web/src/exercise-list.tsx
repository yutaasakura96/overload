import type { Exercise, MuscleGroup } from '@overload/api-contract';
import { useId, type ReactNode } from 'react';
import { FieldLabel } from './components';

// How the library and the picker lay out a list too long to read flat (docs/10 §8.1): filed under
// muscle groups, in this order, and searched by name or alias (docs/06, 2026-10-08).
export const muscleGroupLabels: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  core: 'Core',
};

// A split is derived from the muscle group, never stored: it is a broader way to narrow the same
// list (docs/06, 2026-10-10). A group sits in one split, so a split's exercises are the union of
// its groups'.
export const splitLabels = { push: 'Push', pull: 'Pull', legs: 'Legs', core: 'Core' } as const;
export type Split = keyof typeof splitLabels;

export const splitGroups: Record<Split, MuscleGroup[]> = {
  push: ['chest', 'shoulders', 'triceps'],
  pull: ['back', 'biceps', 'forearms'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves'],
  core: ['core'],
};

/** What the filter narrows the list to: everything, one split or one muscle group. */
export type ExerciseFilter = 'all' | Split | MuscleGroup;

const isSplit = (filter: ExerciseFilter): filter is Split => filter in splitGroups;

/** A custom exercise the user has not filed under a group. */
const UNFILED = 'Other';

// A copy saved on the device before the list grew has neither field, until the next fetch lands.
const aliasesOf = (exercise: Exercise): string[] =>
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- absent in a copy saved by an older build
  exercise.aliases ?? [];

const wordsOf = (search: string) => search.toLowerCase().split(/\s+/).filter(Boolean);

/** The exercises whose name and aliases hold every word typed, in the order given. */
export function searchExercises(exercises: Exercise[], search: string): Exercise[] {
  const words = wordsOf(search);
  if (words.length === 0) return exercises;
  return exercises.filter((exercise) => {
    const text = [exercise.name, ...aliasesOf(exercise)].join(' ').toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** The exercises in the split or muscle group chosen. A custom one with no group is only in `all`. */
export function filterExercises(exercises: Exercise[], filter: ExerciseFilter): Exercise[] {
  if (filter === 'all') return exercises;
  const groups: string[] = isSplit(filter) ? splitGroups[filter] : [filter];
  return exercises.filter(
    (exercise) => exercise.muscleGroup != null && groups.includes(exercise.muscleGroup),
  );
}

type Group = { key: string; label: string; exercises: Exercise[] };

/** The groups that have an exercise, in `muscleGroupLabels` order, the unfiled last. */
export function groupExercises(exercises: Exercise[]): Group[] {
  const groups: Group[] = Object.entries(muscleGroupLabels).map(([key, label]) => ({
    key,
    label,
    exercises: exercises.filter((exercise) => exercise.muscleGroup === key),
  }));
  groups.push({
    key: 'none',
    label: UNFILED,
    // Loose equality: a copy saved by an older build has no `muscleGroup` at all.
    exercises: exercises.filter((exercise) => exercise.muscleGroup == null),
  });
  return groups.filter((group) => group.exercises.length > 0);
}

/** One labelled list per muscle group. `children` renders an exercise's `<li>`. */
export function ExerciseGroups({
  exercises,
  listClassName,
  children,
}: {
  exercises: Exercise[];
  listClassName: string;
  children: (exercise: Exercise) => ReactNode;
}) {
  const id = useId();
  return groupExercises(exercises).map((group) => (
    <section key={group.key} aria-labelledby={`${id}-${group.key}`}>
      <h3 id={`${id}-${group.key}`} className="section-label section-label--gutter group-label">
        {group.label}
      </h3>
      <ul className={listClassName}>{group.exercises.map(children)}</ul>
    </section>
  ));
}

/** The one control that narrows the list: all, a split, or a single muscle group. */
export function ExerciseFilterField({
  value,
  onChange,
}: {
  value: ExerciseFilter;
  onChange: (filter: ExerciseFilter) => void;
}) {
  const id = useId();
  return (
    <div className="field exercise-filter">
      <FieldLabel htmlFor={id} label="Show" />
      <select
        id={id}
        className="field__input field__select"
        value={value}
        onChange={(event) => {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the options are the ExerciseFilter values
          onChange(event.target.value as ExerciseFilter);
        }}
      >
        <option value="all">All exercises</option>
        <optgroup label="Split">
          {Object.entries(splitLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Muscle group">
          {Object.entries(muscleGroupLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}
