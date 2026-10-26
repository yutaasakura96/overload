import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import {
  createBatch,
  deleteBatch,
  listBatches,
  listFoodBatches,
  newestBatches,
  type Batch as StoredBatch,
} from '../db/batches.js';
import { listFoods } from '../db/foods.js';
import { listPlanDays } from '../db/plans.js';
import { getProfile } from '../db/profile.js';
import { localDateIn } from '../db/training.js';
import { datesBetween } from '../domain/planning.js';
import {
  addDays,
  batchYield,
  cookDaysOf,
  isWeekStart,
  MAX_YIELD,
  MIN_YIELD,
  prepPlan,
  WEEK_DAYS,
  weighDue,
} from '../domain/prep.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse } from '../lib/problem.js';
import {
  Batch,
  BatchCreate,
  BatchList,
  IdParam,
  PrepPlan,
  PrepPlanQuery,
  jsonBody,
} from './schemas.js';

// Batches and the prep plan (S13, S17; docs/07 §4). A batch is one cook-up, weighed raw and cooked;
// the newest of a food is the one plans convert by. The prep plan and grocery list are derived from
// the week's plan days on every read, never stored (docs/04, What M2 derives). The figures are the
// domain's (domain/prep.ts); a weight never reaches a log or a problem detail (docs/03 §7).

export const batchJson = (batch: StoredBatch) => ({
  ...batch,
  yield: Math.round(batchYield(batch) * 1000) / 1000,
});

const batchResponse = (description: string) => ({
  description,
  headers: accountHeaders,
  content: { 'application/json': { schema: Batch } },
});

const listResponse = (description: string) => ({
  description,
  headers: accountHeaders,
  content: { 'application/json': { schema: BatchList } },
});

const getBatches = createRoute({
  method: 'get',
  path: '/api/batches',
  summary: 'Every batch, newest cook day first, each with its yield',
  responses: { 200: listResponse('Every batch'), 401: problemResponse('No session') },
});

const getFoodBatches = createRoute({
  method: 'get',
  path: '/api/foods/{id}/batches',
  summary: 'One food’s batches, newest cook day first, each with its yield',
  request: { params: IdParam },
  responses: {
    200: listResponse('The food’s batches'),
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    404: problemResponse('The caller has no food with that id'),
  },
});

const postBatch = createRoute({
  method: 'post',
  path: '/api/batches',
  summary: 'Record a batch. Plans made from now on use its yield; past ones keep theirs',
  request: { body: jsonBody(BatchCreate) },
  responses: {
    201: batchResponse('Created'),
    200: batchResponse('A repeat of the same batch: the stored row'),
    401: problemResponse('No session'),
    409: problemResponse('`id_conflict`: the id is in use with other content'),
    422: problemResponse(
      '`validation_failed`, including a food not on the caller’s list or a yield outside 0.1 to 10',
    ),
  },
});

const deleteBatchRoute = createRoute({
  method: 'delete',
  path: '/api/batches/{id}',
  summary: 'Delete a batch. Plan items that used it keep their values',
  request: { params: IdParam },
  responses: {
    204: { description: 'The caller has no batch with that id', headers: accountHeaders },
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
  },
});

const getPrepPlan = createRoute({
  method: 'get',
  path: '/api/prep-plan',
  summary: 'The week’s prep plan and grocery list, derived from its plan days',
  request: { query: PrepPlanQuery },
  responses: {
    200: {
      description: 'The cook days, the batch-cooked foods and the grocery list',
      headers: accountHeaders,
      content: { 'application/json': { schema: PrepPlan } },
    },
    401: problemResponse('No session'),
    422: problemResponse('`validation_failed`: `weekStart` is not a Monday'),
  },
});

export function prepRoutes({ db }: RouteDeps) {
  return [
    defineOpenAPIRoute<typeof getBatches, AppEnv>({
      route: getBatches,
      handler: async (c) =>
        c.json({ items: (await listBatches(db, c.get('user').id)).map(batchJson) }, 200),
    }),
    defineOpenAPIRoute<typeof getFoodBatches, AppEnv>({
      route: getFoodBatches,
      handler: async (c) => {
        const batches = await listFoodBatches(db, c.get('user').id, c.req.valid('param').id);
        if (batches === undefined) return problem(c, 'not_found');
        return c.json({ items: batches.map(batchJson) }, 200);
      },
    }),
    defineOpenAPIRoute<typeof postBatch, AppEnv>({
      route: postBatch,
      handler: async (c) => {
        const body = c.req.valid('json');
        const profile = await getProfile(db, c.get('user').id);
        const today = localDateIn(profile?.timezone ?? 'Asia/Tokyo')(new Date());
        if (body.cookedOn > today) {
          return problem(c, 'validation_failed', {
            errors: [{ path: 'cookedOn', message: 'A day up to today' }],
          });
        }
        const ratio = body.cookedWeightG / body.rawWeightG;
        if (ratio < MIN_YIELD || ratio > MAX_YIELD) {
          return problem(c, 'validation_failed', {
            errors: [
              {
                path: 'cookedWeightG',
                message: 'Between a tenth of the raw weight and ten times it',
              },
            ],
          });
        }
        const result = await createBatch(db, c.get('user').id, body);
        if (result.kind === 'created') return c.json(batchJson(result.batch), 201);
        if (result.kind === 'existing') return c.json(batchJson(result.batch), 200);
        if (result.kind === 'unknown_food') {
          return problem(c, 'validation_failed', {
            errors: [{ path: 'foodId', message: 'Not a food on your list' }],
          });
        }
        return problem(c, result.kind);
      },
    }),
    defineOpenAPIRoute<typeof deleteBatchRoute, AppEnv>({
      route: deleteBatchRoute,
      handler: async (c) => {
        await deleteBatch(db, c.get('user').id, c.req.valid('param').id);
        return c.body(null, 204);
      },
    }),
    defineOpenAPIRoute<typeof getPrepPlan, AppEnv>({
      route: getPrepPlan,
      handler: async (c) => {
        const userId = c.get('user').id;
        const { weekStart } = c.req.valid('query');
        if (!isWeekStart(weekStart)) {
          return problem(c, 'validation_failed', {
            errors: [{ path: 'weekStart', message: 'Not a Monday' }],
          });
        }
        const weekEnd = addDays(weekStart, WEEK_DAYS - 1);
        const profile = await getProfile(db, userId);
        const today = localDateIn(profile?.timezone ?? 'Asia/Tokyo')(new Date());
        const days = await listPlanDays(db, userId, { from: weekStart, to: weekEnd });
        const foods = await listFoods(db, userId, { includeArchived: true });
        const batches = await newestBatches(db, userId);
        const allBatches = await listBatches(db, userId);
        const listed = foods.flatMap((food) =>
          food.archivedAt === null && food.keepsDays !== null
            ? [{ id: food.id, name: food.name, keepsDays: food.keepsDays }]
            : [],
        );
        const cookDays = cookDaysOf(
          weekStart,
          listed.map((food) => food.keepsDays),
        );
        const plan = prepPlan({
          weekStart,
          cookDays,
          foods: foods.map((food) => ({
            id: food.id,
            name: food.name,
            state: food.state,
            keepsDays: food.keepsDays,
            pieceWeightG: food.pieceWeightG,
            energyKcalPer100g: food.energyKcal,
          })),
          batches: allBatches,
          newestBatches: batches,
          items: days.flatMap((day) =>
            day.meals.flatMap((meal) =>
              meal.items.flatMap((item) =>
                item.foodId === null || item.plannedGrams === null
                  ? []
                  : [
                      {
                        date: day.date,
                        foodId: item.foodId,
                        batchId: item.batchId,
                        plannedGrams: item.plannedGrams,
                        pieceCount: item.pieceCount,
                        cooked: item.cooked,
                        energyKcalPer100g: item.per100g.energyKcal,
                      },
                    ],
              ),
            ),
          ),
          listed,
        });
        const planned = new Set(days.map((day) => day.date));
        const newest = days.reduce<Date | null>(
          (latest, day) => (latest === null || day.generatedAt > latest ? day.generatedAt : latest),
          null,
        );
        const batchOf = new Map(batches.map((batch) => [batch.foodId, batch]));
        return c.json(
          {
            weekStart,
            missing: datesBetween(weekStart, weekEnd).filter((date) => !planned.has(date)),
            generatedAt: newest?.toISOString() ?? null,
            cookDays: plan.cookDays,
            foods: listed
              .toSorted((a, b) => a.name.localeCompare(b.name))
              .map((food) => {
                const batch = batchOf.get(food.id);
                return {
                  foodId: food.id,
                  name: food.name,
                  keepsDays: food.keepsDays,
                  batch: batch === undefined ? null : batchJson(batch),
                  weighDue: weighDue(batch?.cookedOn ?? null, today),
                };
              }),
            uncovered: plan.uncovered,
            grocery: plan.grocery,
          },
          200,
        );
      },
    }),
  ] as const;
}
