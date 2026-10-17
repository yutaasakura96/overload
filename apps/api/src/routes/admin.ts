import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import { createInvite, listInvites, restoreInvite, revokeInvite } from '../db/invites.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse } from '../lib/problem.js';
import { IdParam, Invite, InviteCreate, InviteList, jsonBody } from './schemas.js';

// S9, the admin's side of the gate (docs/07 §2, docs/08 §8). Every route here answers the admin
// only: the guard in create-app.ts turns a member away with 404 before any of them runs.

const inviteResponse = (description: string) => ({
  description,
  headers: accountHeaders,
  content: { 'application/json': { schema: Invite } },
});

const notAdmin = problemResponse('A member: the admin routes are not found for them');

const getInvites = createRoute({
  method: 'get',
  path: '/api/admin/invites',
  summary: 'Every invite, newest first',
  responses: {
    200: {
      description: 'The invites',
      headers: accountHeaders,
      content: { 'application/json': { schema: InviteList } },
    },
    401: problemResponse('No session'),
    404: notAdmin,
  },
});

const postInvite = createRoute({
  method: 'post',
  path: '/api/admin/invites',
  summary: 'Invite a Google email',
  request: { body: jsonBody(InviteCreate) },
  responses: {
    201: inviteResponse('Invited'),
    200: inviteResponse('A repeat of the same create: the stored invite'),
    401: problemResponse('No session'),
    404: notAdmin,
    409: problemResponse(
      '`invite_exists`: the email already has an invite; restore it instead. `id_conflict`: the id is in use with another email or note',
    ),
    422: problemResponse('`validation_failed`'),
  },
});

const revokeRoute = createRoute({
  method: 'post',
  path: '/api/admin/invites/{id}/revoke',
  summary:
    'Revoke: sign the member out everywhere and refuse their next sign-in. Their data stays. A revoked invite is returned unchanged',
  request: { params: IdParam },
  responses: {
    200: inviteResponse('The invite, revoked'),
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    404: problemResponse('No invite with that id, or a member calling'),
    409: problemResponse('`admin_account`: the admin’s own invite'),
  },
});

const restoreRoute = createRoute({
  method: 'post',
  path: '/api/admin/invites/{id}/restore',
  summary:
    'Restore: the member can sign in again. Their ingest tokens stay revoked. An invite that is not revoked is returned unchanged',
  request: { params: IdParam },
  responses: {
    200: inviteResponse('The invite, admitting them again'),
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    404: problemResponse('No invite with that id, or a member calling'),
  },
});

export function adminRoutes({ config, db }: RouteDeps) {
  return [
    defineOpenAPIRoute<typeof getInvites, AppEnv>({
      route: getInvites,
      handler: async (c) => c.json({ items: await listInvites(db, c.get('user').id) }, 200),
    }),
    defineOpenAPIRoute<typeof postInvite, AppEnv>({
      route: postInvite,
      handler: async (c) => {
        const { id, email, note } = c.req.valid('json');
        const result = await createInvite(db, c.get('user').id, {
          id,
          email,
          // An empty note is no note.
          note: note === undefined || note === null || note === '' ? null : note,
        });
        if (result.kind === 'created') return c.json(result.invite, 201);
        if (result.kind === 'existing') return c.json(result.invite, 200);
        return problem(c, result.kind);
      },
    }),
    defineOpenAPIRoute<typeof revokeRoute, AppEnv>({
      route: revokeRoute,
      handler: async (c) => {
        const { id } = c.req.valid('param');
        const result = await revokeInvite(db, c.get('user').id, config.adminEmail, id);
        if (result.kind === 'revoked') return c.json(result.invite, 200);
        return problem(c, result.kind);
      },
    }),
    defineOpenAPIRoute<typeof restoreRoute, AppEnv>({
      route: restoreRoute,
      handler: async (c) => {
        const { id } = c.req.valid('param');
        const restored = await restoreInvite(db, c.get('user').id, id);
        if (restored === undefined) return problem(c, 'not_found');
        return c.json(restored, 200);
      },
    }),
  ] as const;
}
