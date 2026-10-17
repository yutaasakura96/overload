import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import {
  createRotationGroup,
  deleteRotationGroup,
  listRotationGroups,
  updateRotationGroup,
} from '../db/rotation-groups.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse } from '../lib/problem.js';
import {
  IdParam,
  RotationGroup,
  RotationGroupCreate,
  RotationGroupList,
  RotationGroupPatch,
  jsonBody,
} from './schemas.js';

// Rotation groups (S12, docs/07 §4): foods that stand in for each other, okra ↔ broccoli, rice ↔
// potato. The planner varies the week within a group. A food is in one group at most.

const groupResponse = (description: string) => ({
  description,
  headers: accountHeaders,
  content: { 'application/json': { schema: RotationGroup } },
});

const getGroups = createRoute({
  method: 'get',
  path: '/api/rotation-groups',
  summary: 'The rotation groups, by name, with their foods',
  responses: {
    200: {
      description: 'Every group, by name',
      headers: accountHeaders,
      content: { 'application/json': { schema: RotationGroupList } },
    },
    401: problemResponse('No session'),
  },
});

const postGroup = createRoute({
  method: 'post',
  path: '/api/rotation-groups',
  summary: 'Make a group of foods that stand in for each other',
  request: { body: jsonBody(RotationGroupCreate) },
  responses: {
    201: groupResponse('Created'),
    200: groupResponse('A repeat of the same create: the stored group'),
    401: problemResponse('No session'),
    409: problemResponse('`id_conflict`: the id is in use with other content'),
    422: problemResponse('`validation_failed`, including a food that is not on the caller’s list'),
  },
});

const patchGroup = createRoute({
  method: 'patch',
  path: '/api/rotation-groups/{id}',
  summary: 'Rename a group, or replace its foods',
  request: { params: IdParam, body: jsonBody(RotationGroupPatch) },
  responses: {
    200: groupResponse('The group as it now stands'),
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    404: problemResponse('The caller has no group with that id'),
    422: problemResponse('`validation_failed`, including a food that is not on the caller’s list'),
  },
});

const deleteGroup = createRoute({
  method: 'delete',
  path: '/api/rotation-groups/{id}',
  summary: 'Delete a group. Its foods stay, ungrouped',
  request: { params: IdParam },
  responses: {
    204: { description: 'The caller has no group with that id', headers: accountHeaders },
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
  },
});

const unknownFoods = (indexes: number[]) =>
  indexes.map((index) => ({ path: `foodIds.${index}`, message: 'Not a food on your list' }));

export function rotationGroupRoutes({ db }: RouteDeps) {
  return [
    defineOpenAPIRoute<typeof getGroups, AppEnv>({
      route: getGroups,
      handler: async (c) => c.json({ items: await listRotationGroups(db, c.get('user').id) }, 200),
    }),
    defineOpenAPIRoute<typeof postGroup, AppEnv>({
      route: postGroup,
      handler: async (c) => {
        const result = await createRotationGroup(db, c.get('user').id, c.req.valid('json'));
        if (result.kind === 'created') return c.json(result.group, 201);
        if (result.kind === 'existing') return c.json(result.group, 200);
        if (result.kind === 'unknown_foods') {
          return problem(c, 'validation_failed', { errors: unknownFoods(result.indexes) });
        }
        return problem(c, result.kind);
      },
    }),
    defineOpenAPIRoute<typeof patchGroup, AppEnv>({
      route: patchGroup,
      handler: async (c) => {
        const result = await updateRotationGroup(
          db,
          c.get('user').id,
          c.req.valid('param').id,
          c.req.valid('json'),
        );
        if (result.kind === 'updated') return c.json(result.group, 200);
        if (result.kind === 'unknown_foods') {
          return problem(c, 'validation_failed', { errors: unknownFoods(result.indexes) });
        }
        return problem(c, result.kind);
      },
    }),
    defineOpenAPIRoute<typeof deleteGroup, AppEnv>({
      route: deleteGroup,
      handler: async (c) => {
        await deleteRotationGroup(db, c.get('user').id, c.req.valid('param').id);
        return c.body(null, 204);
      },
    }),
  ] as const;
}
