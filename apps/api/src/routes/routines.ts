import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv, RouteDeps } from '../app-env.js';
import {
  createRoutine,
  deleteRoutine,
  listRoutines,
  replaceRoutineExercises,
  updateRoutine,
} from '../db/routines.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse } from '../lib/problem.js';
import {
  Routine,
  RoutineCreate,
  RoutineExercisesPut,
  RoutineList,
  RoutinePatch,
  IdParam,
  jsonBody,
} from './schemas.js';

// S4 (docs/07 §3.3). Routines are not queued offline; only the open workout is (docs/09 F2).

const routineResponse = (description: string) => ({
  description,
  headers: accountHeaders,
  content: { 'application/json': { schema: Routine } },
});

const getRoutines = createRoute({
  method: 'get',
  path: '/api/routines',
  summary: 'Every routine the caller has, in list order, each with its slots in order',
  responses: {
    200: {
      description: 'The routines',
      headers: accountHeaders,
      content: { 'application/json': { schema: RoutineList } },
    },
    401: problemResponse('No session'),
  },
});

const postRoutine = createRoute({
  method: 'post',
  path: '/api/routines',
  summary: 'Create a routine at the end of the list, optionally with its slots',
  request: { body: jsonBody(RoutineCreate) },
  responses: {
    201: routineResponse('Created'),
    200: routineResponse('A repeat of the same create: the stored routine'),
    401: problemResponse('No session'),
    409: problemResponse('`id_conflict`: the routine or a slot id is in use with other content'),
    422: problemResponse('`validation_failed`, including an unknown or hidden exercise'),
  },
});

const patchRoutine = createRoute({
  method: 'patch',
  path: '/api/routines/{id}',
  summary: 'Rename a routine, or move it in the list',
  request: { params: IdParam, body: jsonBody(RoutinePatch) },
  responses: {
    200: routineResponse('The routine'),
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    404: problemResponse('No routine with that id belongs to the caller'),
    422: problemResponse('`validation_failed`'),
  },
});

const putRoutineExercises = createRoute({
  method: 'put',
  path: '/api/routines/{id}/exercises',
  summary: 'Replace the whole slot list. Order is array order, so a reorder is one call',
  request: { params: IdParam, body: jsonBody(RoutineExercisesPut) },
  responses: {
    200: routineResponse('The routine with its new slots'),
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    404: problemResponse('No routine with that id belongs to the caller'),
    409: problemResponse('`id_conflict`: a slot id belongs to another routine'),
    422: problemResponse('`validation_failed`, including an unknown or hidden exercise'),
  },
});

const deleteRoutineRoute = createRoute({
  method: 'delete',
  path: '/api/routines/{id}',
  summary: 'Delete a routine. 204 whenever the caller has no such routine afterwards',
  request: { params: IdParam },
  responses: {
    204: { description: 'The caller has no routine with that id', headers: accountHeaders },
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
  },
});

/** Another user's exercise is refused exactly like one that does not exist (docs/07 §1.3). */
const unusableExercises = (c: Context<AppEnv>, indexes: number[]) =>
  problem(c, 'validation_failed', {
    errors: indexes.map((index) => ({
      path: `exercises.${index}.exerciseId`,
      message: 'No such exercise, or it is hidden',
    })),
  });

export function routineRoutes({ db }: RouteDeps) {
  return [
    defineOpenAPIRoute<typeof getRoutines, AppEnv>({
      route: getRoutines,
      handler: async (c) => c.json({ items: await listRoutines(db, c.get('user').id) }, 200),
    }),
    defineOpenAPIRoute<typeof postRoutine, AppEnv>({
      route: postRoutine,
      handler: async (c) => {
        const { id, name, exercises = [] } = c.req.valid('json');
        const result = await createRoutine(db, c.get('user').id, { id, name, exercises });
        if (result.kind === 'created') return c.json(result.routine, 201);
        if (result.kind === 'existing') return c.json(result.routine, 200);
        if (result.kind === 'id_conflict') return problem(c, 'id_conflict');
        return unusableExercises(c, result.indexes);
      },
    }),
    defineOpenAPIRoute<typeof patchRoutine, AppEnv>({
      route: patchRoutine,
      handler: async (c) => {
        const { id } = c.req.valid('param');
        const result = await updateRoutine(db, c.get('user').id, id, c.req.valid('json'));
        if (result.kind === 'not_found') return problem(c, 'not_found');
        return c.json(result.routine, 200);
      },
    }),
    defineOpenAPIRoute<typeof putRoutineExercises, AppEnv>({
      route: putRoutineExercises,
      handler: async (c) => {
        const { id } = c.req.valid('param');
        const { exercises } = c.req.valid('json');
        const result = await replaceRoutineExercises(db, c.get('user').id, id, exercises);
        if (result.kind === 'updated') return c.json(result.routine, 200);
        if (result.kind === 'not_found') return problem(c, 'not_found');
        if (result.kind === 'id_conflict') return problem(c, 'id_conflict');
        return unusableExercises(c, result.indexes);
      },
    }),
    defineOpenAPIRoute<typeof deleteRoutineRoute, AppEnv>({
      route: deleteRoutineRoute,
      handler: async (c) => {
        const { id } = c.req.valid('param');
        await deleteRoutine(db, c.get('user').id, id);
        return c.body(null, 204);
      },
    }),
  ] as const;
}
