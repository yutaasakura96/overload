/** One logged set, as much of it as e1RM reads. */
export type LoggedSet = { weightKg: number; reps: number; isWarmup: boolean };

/** Epley's estimate for one set: weight × (1 + reps / 30) (CONTEXT.md, e1RM). */
export const epley = (weightKg: number, reps: number) => weightKg * (1 + reps / 30);

/**
 * A workout's e1RM for one exercise: Epley on its best working set (S7). Warm-ups are left out
 * (S6), so a workout of warm-ups alone has none.
 */
export function bestE1rmKg(sets: LoggedSet[]): number | undefined {
  const estimates = sets.filter((s) => !s.isWarmup).map((s) => epley(s.weightKg, s.reps));
  return estimates.length === 0 ? undefined : Math.max(...estimates);
}

/**
 * The top set (CONTEXT.md): the heaviest working set, with the most reps done at that weight. A
 * workout of warm-ups alone has none.
 */
export function topSet(sets: LoggedSet[]): { weightKg: number; reps: number } | undefined {
  const working = sets.filter((s) => !s.isWarmup);
  if (working.length === 0) return undefined;
  const weightKg = Math.max(...working.map((s) => s.weightKg));
  const reps = Math.max(...working.filter((s) => s.weightKg === weightKg).map((s) => s.reps));
  return { weightKg, reps };
}
