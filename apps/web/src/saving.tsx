import { useEffect, useRef } from 'react';
import { ApiError } from './api';
import { Notice } from './components';
import { queryClient } from './query';

// What a failed save shows (docs/09 F2 and F5). Routines and exercises are not queued offline, so a
// save that does not arrive keeps the form as it is (docs/06, offline scope).

export type SaveProblem =
  | { kind: 'unreached' }
  | {
      kind: 'refused';
      code: string | undefined;
      fields: Map<string, string>;
      routines: { id: string; name: string }[];
    };

export function saveProblem(error: unknown): SaveProblem {
  // No answer, or the service failed: nothing was refused, so trying again may work (docs/03 §7).
  if (!(error instanceof ApiError) || error.status >= 500) return { kind: 'unreached' };
  // A 401 is not a refusal: asking /api/me again sends the app to sign-in (docs/09, rule 4).
  if (error.status === 401) void queryClient.invalidateQueries({ queryKey: ['me'] });
  const fields = new Map(
    [...error.fieldErrors].map(([path, message]) => [path, fieldMessage(path, message)]),
  );
  return { kind: 'refused', code: error.code, fields, routines: error.problem?.routines ?? [] };
}

/**
 * The ref for a form whose refused fields take focus: after a refusal the first marked field is the
 * next thing the user reads and types in. The notice above still announces the refusal.
 */
export function useFocusRefused(problem: SaveProblem | undefined) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (problem?.kind !== 'refused') return;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [problem]);
  return form;
}

/** The message for one refused field, by the field's name at the end of its path. */
function fieldMessage(path: string, serverMessage: string): string {
  const field = path.split('.').at(-1);
  if (field === 'name') {
    return serverMessage.includes('already') ? serverMessage : 'Enter a name, up to 80 characters';
  }
  if (field === 'repLow' || field === 'repHigh') {
    if (serverMessage.includes('exceed')) return 'The low end is above the high end';
    if (serverMessage.includes('neither')) return 'Set both ends of the range, or neither';
    return 'A whole number of reps, 1 to 100';
  }
  if (field === 'targetSets') return 'A whole number of sets, 1 to 20';
  if (field === 'incrementKg') return 'Kilograms from 0 to 100, to two decimals';
  if (field === 'restSeconds') return 'Whole seconds, 0 to 3600';
  if (field === 'exerciseId') return 'Hidden or no longer in your library. Remove it';
  return serverMessage;
}

/** The notice above a form whose save failed. Refused fields are also marked where they are. */
export function SaveNotice({ problem, what }: { problem: SaveProblem | undefined; what: string }) {
  if (problem === undefined) return null;
  if (problem.kind === 'unreached') {
    return (
      <Notice tone="flag" word="Not saved">
        Couldn’t reach Overload. The {what} is still here; save again when you have signal.
      </Notice>
    );
  }
  return (
    <Notice tone="error" word="Refused">
      {refusal(problem, what)}
    </Notice>
  );
}

function refusal(problem: Extract<SaveProblem, { kind: 'refused' }>, what: string) {
  if (problem.code === 'exercise_in_routine') {
    const names = problem.routines.map((routine) => routine.name).join(', ');
    return `Used by ${names}. Take it out of ${problem.routines.length === 1 ? 'that routine' : 'those routines'} first, or hide it instead.`;
  }
  if (problem.code === 'not_found') {
    return `This ${what} no longer exists. It may have been deleted on another device.`;
  }
  if (problem.code === 'id_conflict')
    return 'This was saved differently before. Go back and open it again.';
  if (problem.code === 'unauthenticated') return 'You were signed out. Sign in to save.';
  if (problem.fields.size > 0) return 'Nothing was saved. Fix the marked fields.';
  return 'Nothing was saved.';
}
