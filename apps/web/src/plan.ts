import type { GoalPhase } from '@overload/api-contract';
import { dayLabel } from './dates';

// How the plan screens name a phase and a day. Display only: every figure is the API's (docs/07 §4).

const DAY_MS = 24 * 60 * 60 * 1000;

const TYPE_NAME = { cut: 'Cut', bulk: 'Bulk', maintain: 'Maintenance' } as const;

/** `4 Sep`: a local date with no weekday. */
export const shortDate = (date: string) => dayLabel(`${date}T12:00:00Z`, 'UTC').slice(4);

/** `Cut since 4 Sep · week 7`. Week 1 is the phase's first seven days. */
export function phaseLine(phase: Pick<GoalPhase, 'type' | 'startedOn'>, today: string) {
  const days = Math.round((Date.parse(today) - Date.parse(phase.startedOn)) / DAY_MS);
  return `${TYPE_NAME[phase.type]} since ${shortDate(phase.startedOn)} · week ${Math.floor(days / 7) + 1}`;
}
