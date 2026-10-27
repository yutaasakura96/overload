import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import { openGoalPhase } from '../db/goal-phases.js';
import { completeDayCount, listPlanDays } from '../db/plans.js';
import { getProfile } from '../db/profile.js';
import { localDateIn } from '../db/training.js';
import { listWeighIns } from '../db/weigh-ins.js';
import { maintenanceCheck, WINDOW_DAYS } from '../domain/maintenance.js';
import { dayComplete, dayTotals } from '../domain/planning.js';
import { bodyweightForTargets } from '../domain/targets.js';
import { dailyWeights, weightTrend } from '../domain/weight.js';
import { accountHeaders } from '../lib/account.js';
import { problemResponse } from '../lib/problem.js';
import { MaintenanceCheck } from './schemas.js';

// S18a (docs/07 §5, docs/03 §8.3): the maintenance check, read-only. It never writes a target;
// `Apply to targets` is the client's own PATCH of the phase with `calorieBasis: "measured"`
// (docs/09 F13). No intake or weight value reaches a log (docs/03 §7).

const DAY_MS = 86_400_000;

const getMaintenanceCheck = createRoute({
  method: 'get',
  path: '/api/maintenance-check',
  summary: 'The maintenance check over the trailing 14 calendar days, complete days only',
  responses: {
    200: {
      description: 'One of four statuses; the figures only when `ready`',
      headers: accountHeaders,
      content: { 'application/json': { schema: MaintenanceCheck } },
    },
    401: problemResponse('No session'),
  },
});

export function maintenanceRoutes({ db }: RouteDeps) {
  return [
    defineOpenAPIRoute<typeof getMaintenanceCheck, AppEnv>({
      route: getMaintenanceCheck,
      handler: async (c) => {
        const userId = c.get('user').id;
        const profile = await getProfile(db, userId);
        // Without a profile there are no weigh-ins, and the plan's days are read in Tokyo's.
        const timezone = profile?.timezone ?? 'Asia/Tokyo';
        const today = localDateIn(timezone)(new Date());
        const from = new Date(Date.parse(`${today}T00:00:00Z`) - (WINDOW_DAYS - 1) * DAY_MS)
          .toISOString()
          .slice(0, 10);
        const completeDays = (await listPlanDays(db, userId, { from, to: today }))
          .filter((day) => dayComplete(day.meals))
          .map((day) => ({
            date: day.date,
            energyKcal: dayTotals(day.meals).confirmed.energyKcal,
          }));
        const weights = dailyWeights(await listWeighIns(db, userId), timezone);
        const phase = await openGoalPhase(db, userId);
        const bodyweight = bodyweightForTargets(weightTrend(weights).days, today);
        const check = maintenanceCheck({
          today,
          completeDaysTotal: await completeDayCount(db, userId, today),
          completeDays,
          weights,
          phase:
            phase === undefined || bodyweight === null
              ? undefined
              : {
                  id: phase.id,
                  type: phase.type,
                  targetRatePctPerWeek: phase.targetRatePctPerWeek,
                  weightKg: bodyweight.weightKg,
                },
        });
        return c.json(
          {
            from: null,
            to: null,
            completeDaysInWindow: null,
            recentCompleteDays: null,
            lowRecentLogging: null,
            weighInsInWindow: null,
            lastWeighedOn: null,
            meanIntakeKcal: null,
            trendChangeKgPerWeek: null,
            maintenanceKcal: null,
            apply: null,
            ...check,
          },
          200,
        );
      },
    }),
  ] as const;
}
