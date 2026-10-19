import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import type { Database, Queryable } from '../db/connection.js';
import { listDayRoutines, putDayRoutine } from '../db/day-routines.js';
import {
  createGoalPhase,
  listGoalPhases,
  openGoalPhase,
  updateGoalPhase,
  type GoalPhase,
} from '../db/goal-phases.js';
import {
  confirmedDates,
  listPlanDays,
  planFoods,
  replacePlanDays,
  withPlanLock,
  type StoredPlanDay,
} from '../db/plans.js';
import { getProfile } from '../db/profile.js';
import { localDateIn } from '../db/training.js';
import { listWeighIns } from '../db/weigh-ins.js';
import { PROTEIN_PER_MEAL_G_PER_KG, recommendMeals } from '../domain/meals.js';
import { datesBetween, dayTotals, missingSetup, planDates } from '../domain/planning.js';
import {
  ageOn,
  bodyweightForTargets,
  macroTargets,
  phaseDefaults,
  provisionalCalories,
} from '../domain/targets.js';
import { dailyWeights, weightTrend } from '../domain/weight.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse } from '../lib/problem.js';
import {
  CurrentTargets,
  DayRoutine,
  DayRoutineList,
  DayRoutinePut,
  DayType,
  GoalPhase as GoalPhaseSchema,
  GoalPhaseCreate,
  GoalPhaseList,
  GoalPhasePatch,
  GoalPhaseType,
  IdParam,
  LocalTime,
  MealRecommendation,
  PhaseDefaults,
  PlanDays,
  PlanRange,
  jsonBody,
} from './schemas.js';

// S14 to S16 (docs/07 §4, Phase, routine and targets; Plan days): the goal phase and its defaults
// with their sources, the day's routine and its meals, the targets in force, and the generated plan.
// Every figure here is the domain's (docs/03 §8.2); this file reads its inputs and writes its days.
// A food, weight or target value never reaches a log or a problem detail (docs/03 §7).

/** The most days one plan read or generation covers. */
export const PLAN_RANGE_MAX_DAYS = 31;

/** What the plan routes read: the profile, the bodyweight targets are set at, and the setup. */
async function planContext(db: Queryable, userId: string) {
  const profile = await getProfile(db, userId);
  const timezone = profile?.timezone ?? 'Asia/Tokyo';
  const today = localDateIn(timezone)(new Date());
  const days = weightTrend(dailyWeights(await listWeighIns(db, userId), timezone)).days;
  const bodyweight = bodyweightForTargets(days, today);
  const phase = await openGoalPhase(db, userId);
  const routines = await listDayRoutines(db, userId);
  const foods = await planFoods(db, userId);
  const profileComplete =
    profile !== null &&
    profile.heightCm !== null &&
    profile.sex !== null &&
    profile.birthDate !== null &&
    bodyweight !== null;
  const trainingWeekdays = profile?.trainingWeekdays ?? [];
  const missing = missingSetup({
    profileComplete,
    foodCount: foods.length,
    hasOpenPhase: phase !== undefined,
    trainingWeekdays,
    routineDayTypes: routines.map((routine) => routine.dayType),
  });
  return { profile, today, bodyweight, phase, routines, foods, trainingWeekdays, missing };
}

export const phaseJson = (phase: GoalPhase) => ({
  ...phase,
  calorieTargetSetAt: phase.calorieTargetSetAt.toISOString(),
});

/** Carbohydrate is moved towards training on its evidence (S16). */
const CARB_TIMING = {
  claim: 'carbohydrate around training',
  strength: 'moderate',
  sourceKey: 'carb_timing_training',
} as const;

export const planDayJson = (day: StoredPlanDay) => {
  const totals = dayTotals(day.meals);
  return {
    id: day.id,
    date: day.date,
    dayType: day.dayType,
    goalPhaseId: day.goalPhaseId,
    complete: day.meals.length > 0 && day.meals.every((meal) => meal.status !== 'planned'),
    targets: day.targets,
    ...totals,
    shortfalls: day.shortfalls,
    generatedAt: day.generatedAt.toISOString(),
    meals: day.meals.map((meal) => ({
      ...meal,
      confirmedAt: meal.confirmedAt?.toISOString() ?? null,
      evidence: meal.isPreTraining || meal.isPostTraining ? [CARB_TIMING] : [],
    })),
  };
};

/** A range that is in order and no longer than 31 days, or the parameter that is wrong. */
function rangeProblem(range: { from: string; to: string }) {
  if (range.from > range.to) return 'from';
  return datesBetween(range.from, range.to).length > PLAN_RANGE_MAX_DAYS ? 'to' : undefined;
}

// Phase, routine and targets.

const getPhases = createRoute({
  method: 'get',
  path: '/api/goal-phases',
  summary: 'Every goal phase, newest first',
  responses: {
    200: {
      description: 'The open one has `endedOn: null`',
      headers: accountHeaders,
      content: { 'application/json': { schema: GoalPhaseList } },
    },
    401: problemResponse('No session'),
  },
});

const phaseResponse = (description: string) => ({
  description,
  headers: accountHeaders,
  content: { 'application/json': { schema: GoalPhaseSchema } },
});

const postPhase = createRoute({
  method: 'post',
  path: '/api/goal-phases',
  summary: 'Open a goal phase',
  request: { body: jsonBody(GoalPhaseCreate) },
  responses: {
    201: phaseResponse('Opened'),
    200: phaseResponse('A repeat of the same create: the stored phase'),
    401: problemResponse('No session'),
    409: problemResponse(
      '`phase_already_open` without `endPrevious`; `id_conflict`: the id is in use with other content',
    ),
    422: problemResponse('`validation_failed`'),
  },
});

const patchPhase = createRoute({
  method: 'patch',
  path: '/api/goal-phases/{id}',
  summary: 'Edit a phase’s targets, or apply the maintenance check by hand',
  request: { params: IdParam, body: jsonBody(GoalPhasePatch) },
  responses: {
    200: phaseResponse('The phase'),
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    404: problemResponse('No such phase of the caller’s'),
    422: problemResponse('`validation_failed`, including a rate on maintenance or none on a cut'),
  },
});

const getDefaults = createRoute({
  method: 'get',
  path: '/api/goal-phases/defaults',
  summary: 'The defaults of a new phase, each with its source (S14)',
  request: {
    query: z.object({
      type: GoalPhaseType,
      targetRatePctPerWeek: z.coerce
        .number()
        .min(0.05)
        .max(2)
        .optional()
        .openapi({ description: 'The rate the calories are worked out for. Default: the type’s.' }),
    }),
  },
  responses: {
    200: {
      description: 'Rate, protein, fat and provisional calories',
      headers: accountHeaders,
      content: { 'application/json': { schema: PhaseDefaults } },
    },
    400: problemResponse('An unknown type or a rate out of range'),
    401: problemResponse('No session'),
    422: problemResponse(
      '`setup_incomplete` with `missing: ["profile"]`: height, sex, birth date and a weigh-in first',
    ),
  },
});

const getRoutines = createRoute({
  method: 'get',
  path: '/api/day-routines',
  summary: 'Both day types with their meals',
  responses: {
    200: {
      description: 'The day types set so far, training first',
      headers: accountHeaders,
      content: { 'application/json': { schema: DayRoutineList } },
    },
    401: problemResponse('No session'),
  },
});

const DayTypeParam = z.object({
  dayType: DayType.openapi({ param: { name: 'dayType', in: 'path' } }),
});

const putRoutine = createRoute({
  method: 'put',
  path: '/api/day-routines/{dayType}',
  summary: 'Replace one day type’s routine and its meals',
  request: { params: DayTypeParam, body: jsonBody(DayRoutinePut) },
  responses: {
    200: {
      description: 'The routine as stored',
      headers: accountHeaders,
      content: { 'application/json': { schema: DayRoutine } },
    },
    400: problemResponse('An unknown day type'),
    401: problemResponse('No session'),
    422: problemResponse(
      '`validation_failed`, including a training day without a training time or a rest day with one',
    ),
  },
});

const getRecommendation = createRoute({
  method: 'get',
  path: '/api/day-routines/{dayType}/recommendation',
  summary:
    'The recommended meal count and times for a day, with the protein each meal carries (S15)',
  request: {
    params: DayTypeParam,
    query: z.object({
      wakeTime: LocalTime,
      bedTime: LocalTime,
      trainingTime: LocalTime.optional().openapi({ description: 'A training day’s.' }),
      mealCount: z.coerce.number().int().min(1).max(8).optional().openapi({
        description: 'The count to give times for. Default: the recommendation.',
      }),
    }),
  },
  responses: {
    200: {
      description: 'The recommendation, for the day as given',
      headers: accountHeaders,
      content: { 'application/json': { schema: MealRecommendation } },
    },
    400: problemResponse('A malformed time or count'),
    401: problemResponse('No session'),
    422: problemResponse(
      '`setup_incomplete` with `missing`: protein per meal needs the profile and the goal phase',
    ),
  },
});

const getTargets = createRoute({
  method: 'get',
  path: '/api/targets/current',
  summary: 'The targets in force today, and where they came from',
  responses: {
    200: {
      description: 'Today’s targets',
      headers: accountHeaders,
      content: { 'application/json': { schema: CurrentTargets } },
    },
    401: problemResponse('No session'),
    422: problemResponse('`setup_incomplete` with `missing`: the profile or the goal phase'),
  },
});

// Plan days.

const getPlanDays = createRoute({
  method: 'get',
  path: '/api/plan-days',
  summary: 'The plan days in a range, meals and items included. Read-only',
  request: { query: PlanRange },
  responses: {
    200: {
      description: 'The days, and the dates with no plan in `missing`',
      headers: accountHeaders,
      content: { 'application/json': { schema: PlanDays } },
    },
    400: problemResponse('A malformed date, `from` after `to`, or more than 31 days'),
    401: problemResponse('No session'),
  },
});

const generatePlanDays = createRoute({
  method: 'post',
  path: '/api/plan-days/generate',
  summary:
    'Generate a range: each day with no confirmed meal is made again from current inputs. Past days already planned are left',
  request: { body: jsonBody(PlanRange) },
  responses: {
    200: {
      description: 'The range’s days after generating',
      headers: accountHeaders,
      content: { 'application/json': { schema: PlanDays } },
    },
    401: problemResponse('No session'),
    422: problemResponse(
      '`setup_incomplete` with `missing`; `validation_failed` for `from` after `to` or more than 31 days',
    ),
  },
});

async function readRange(db: Database, userId: string, range: { from: string; to: string }) {
  const days = await listPlanDays(db, userId, range);
  const planned = new Set(days.map((day) => day.date));
  return {
    missing: datesBetween(range.from, range.to).filter((date) => !planned.has(date)),
    days: days.map(planDayJson),
  };
}

export function planRoutes({ db }: RouteDeps) {
  return [
    defineOpenAPIRoute<typeof getPhases, AppEnv>({
      route: getPhases,
      handler: async (c) =>
        c.json({ items: (await listGoalPhases(db, c.get('user').id)).map(phaseJson) }, 200),
    }),
    defineOpenAPIRoute<typeof postPhase, AppEnv>({
      route: postPhase,
      handler: async (c) => {
        const { endPrevious, ...input } = c.req.valid('json');
        const result = await createGoalPhase(db, c.get('user').id, input, endPrevious === true);
        if (result.kind === 'created') return c.json(phaseJson(result.phase), 201);
        if (result.kind === 'existing') return c.json(phaseJson(result.phase), 200);
        if (result.kind === 'phase_start_not_after_open') {
          return problem(c, 'validation_failed', {
            errors: [{ path: 'startedOn', message: 'Start after the open phase began' }],
          });
        }
        return problem(c, result.kind);
      },
    }),
    defineOpenAPIRoute<typeof patchPhase, AppEnv>({
      route: patchPhase,
      handler: async (c) => {
        const userId = c.get('user').id;
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        if (patch.targetRatePctPerWeek !== undefined) {
          const stored = (await listGoalPhases(db, userId)).find((phase) => phase.id === id);
          if (stored === undefined) return problem(c, 'not_found');
          if ((patch.targetRatePctPerWeek === null) !== (stored.type === 'maintain')) {
            return problem(c, 'validation_failed', {
              errors: [
                {
                  path: 'targetRatePctPerWeek',
                  message:
                    stored.type === 'maintain'
                      ? 'Maintenance has no rate'
                      : 'A cut or bulk needs a rate',
                },
              ],
            });
          }
        }
        const updated = await updateGoalPhase(db, userId, id, patch);
        if (updated === undefined) return problem(c, 'not_found');
        return c.json(phaseJson(updated), 200);
      },
    }),
    defineOpenAPIRoute<typeof getDefaults, AppEnv>({
      route: getDefaults,
      handler: async (c) => {
        const { type, targetRatePctPerWeek } = c.req.valid('query');
        const context = await planContext(db, c.get('user').id);
        const { profile, bodyweight } = context;
        if (
          profile === null ||
          profile.heightCm === null ||
          profile.sex === null ||
          profile.birthDate === null ||
          bodyweight === null
        ) {
          return problem(c, 'setup_incomplete', { missing: ['profile'] });
        }
        const defaults = phaseDefaults(type);
        const rate =
          type === 'maintain'
            ? null
            : (targetRatePctPerWeek ?? defaults.targetRatePctPerWeek?.value ?? null);
        const age = ageOn(profile.birthDate, context.today);
        const trainingDaysPerWeek = new Set(profile.trainingWeekdays).size;
        const calories = provisionalCalories({
          type,
          targetRatePctPerWeek: rate,
          weightKg: bodyweight.weightKg,
          heightCm: profile.heightCm,
          age,
          sex: profile.sex,
          trainingDaysPerWeek,
        });
        return c.json(
          {
            type,
            bodyweight,
            ...defaults,
            calories: {
              value: calories.kcal,
              basis: 'provisional_formula' as const,
              formula: 'mifflin_st_jeor' as const,
              restingKcal: calories.restingKcal,
              activityLevel: calories.activityLevel,
              trainingDaysPerWeek,
              adjustmentKcal: calories.adjustmentKcal,
              age,
              sourceKey: 'provisional_calories' as const,
            },
          },
          200,
        );
      },
    }),
    defineOpenAPIRoute<typeof getRoutines, AppEnv>({
      route: getRoutines,
      handler: async (c) => c.json({ items: await listDayRoutines(db, c.get('user').id) }, 200),
    }),
    defineOpenAPIRoute<typeof putRoutine, AppEnv>({
      route: putRoutine,
      handler: async (c) => {
        const { dayType } = c.req.valid('param');
        const body = c.req.valid('json');
        if ((dayType === 'training') !== (body.trainingTime !== null)) {
          return problem(c, 'validation_failed', {
            errors: [
              {
                path: 'trainingTime',
                message:
                  dayType === 'training'
                    ? 'A training day needs a training time'
                    : 'A rest day has no training time',
              },
            ],
          });
        }
        return c.json(await putDayRoutine(db, c.get('user').id, dayType, body), 200);
      },
    }),
    defineOpenAPIRoute<typeof getRecommendation, AppEnv>({
      route: getRecommendation,
      handler: async (c) => {
        const { dayType } = c.req.valid('param');
        const query = c.req.valid('query');
        const context = await planContext(db, c.get('user').id);
        const missing = context.missing.filter(
          (step) => step === 'profile' || step === 'goal_phase',
        );
        if (context.bodyweight === null || context.phase === undefined || missing.length > 0) {
          return problem(c, 'setup_incomplete', {
            missing: missing.length > 0 ? missing : ['profile'],
          });
        }
        const weightKg = context.bodyweight.weightKg;
        const { proteinG } = macroTargets(context.phase, weightKg);
        const recommendation = recommendMeals(
          {
            dayType,
            wakeTime: query.wakeTime,
            bedTime: query.bedTime,
            trainingTime: dayType === 'training' ? (query.trainingTime ?? null) : null,
          },
          proteinG,
          weightKg,
          query.mealCount,
        );
        return c.json(
          {
            dayType,
            ...recommendation,
            proteinG,
            weightKg,
            perMealRange: PROTEIN_PER_MEAL_G_PER_KG,
            sourceKey: 'protein_per_meal' as const,
          },
          200,
        );
      },
    }),
    defineOpenAPIRoute<typeof getTargets, AppEnv>({
      route: getTargets,
      handler: async (c) => {
        const context = await planContext(db, c.get('user').id);
        const { phase, bodyweight } = context;
        if (phase === undefined || bodyweight === null) {
          const missing = context.missing.filter(
            (step) => step === 'profile' || step === 'goal_phase',
          );
          return problem(c, 'setup_incomplete', {
            missing: missing.length > 0 ? missing : ['profile'],
          });
        }
        return c.json(
          {
            date: context.today,
            goalPhaseId: phase.id,
            ...macroTargets(phase, bodyweight.weightKg),
            bodyweightKg: bodyweight.weightKg,
            source: {
              kind:
                phase.calorieBasis === 'provisional_formula'
                  ? ('provisional_formula' as const)
                  : ('goal_phase' as const),
            },
          },
          200,
        );
      },
    }),
    defineOpenAPIRoute<typeof getPlanDays, AppEnv>({
      route: getPlanDays,
      handler: async (c) => {
        const range = c.req.valid('query');
        const wrong = rangeProblem(range);
        if (wrong !== undefined) {
          return problem(c, 'bad_request', { detail: `Invalid parameter: ${wrong}` });
        }
        return c.json(await readRange(db, c.get('user').id, range), 200);
      },
    }),
    defineOpenAPIRoute<typeof generatePlanDays, AppEnv>({
      route: generatePlanDays,
      handler: async (c) => {
        const userId = c.get('user').id;
        const range = c.req.valid('json');
        const wrong = rangeProblem(range);
        if (wrong !== undefined) {
          return problem(c, 'validation_failed', {
            errors: [
              {
                path: wrong,
                message: wrong === 'from' ? 'After `to`' : `More than ${PLAN_RANGE_MAX_DAYS} days`,
              },
            ],
          });
        }
        const missing = await withPlanLock(db, userId, async (tx) => {
          const context = await planContext(tx, userId);
          const { phase, bodyweight } = context;
          if (context.missing.length > 0 || phase === undefined || bodyweight === null) {
            return context.missing;
          }
          const planned = planDates({
            dates: datesBetween(range.from, range.to),
            trainingWeekdays: context.trainingWeekdays,
            routines: Object.fromEntries(
              context.routines.map((routine) => [routine.dayType, routine]),
            ),
            targets: macroTargets(phase, bodyweight.weightKg),
            goalPhaseId: phase.id,
            foods: context.foods,
          });
          // A day with a confirmed meal is never made again, nor a past day already planned: what
          // it aimed for stays what it aimed for.
          const kept = await confirmedDates(tx, userId, range);
          for (const day of await listPlanDays(tx, userId, range)) {
            if (day.date < context.today) kept.add(day.date);
          }
          await replacePlanDays(tx, userId, planned, kept);
          return undefined;
        });
        if (missing !== undefined) return problem(c, 'setup_incomplete', { missing });
        return c.json(await readRange(db, userId, range), 200);
      },
    }),
  ] as const;
}
