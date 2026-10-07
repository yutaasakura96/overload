import type { Exercise, MuscleGroup } from '@overload/api-contract';
import { useId, type ReactNode } from 'react';

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

/** The alias that made an exercise match, when its name alone would not have: "RDL". */
export function matchedAlias(exercise: Exercise, search: string): string | undefined {
  const name = exercise.name.toLowerCase();
  const missing = wordsOf(search).filter((word) => !name.includes(word));
  if (missing.length === 0) return undefined;
  return aliasesOf(exercise).find((alias) =>
    missing.some((word) => alias.toLowerCase().includes(word)),
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
        {/* The list under it already says how many it holds. */}
        <span className="group-label__count" aria-hidden="true">
          {group.exercises.length}
        </span>
      </h3>
      <ul className={listClassName}>{group.exercises.map(children)}</ul>
    </section>
  ));
}
