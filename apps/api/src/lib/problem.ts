import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// RFC 9457 problem details with our `code` (docs/07 §1.3). Better Auth's own /api/auth/* routes
// answer in their own `{ code, message }` shape and never come through here.

export const problemCodes = {
  bad_request: { status: 400, title: 'Bad request' },
  unauthenticated: { status: 401, title: 'Not signed in' },
  cross_origin: { status: 403, title: 'Cross-origin request refused' },
  not_found: { status: 404, title: 'Not found' },
  id_conflict: { status: 409, title: 'Id already used for something else' },
  exercise_in_routine: { status: 409, title: 'Exercise is used by a routine' },
  exercise_has_history: { status: 409, title: 'Exercise has logged workouts' },
  payload_too_large: { status: 413, title: 'Too many rows in one request' },
  validation_failed: { status: 422, title: 'Request body failed validation' },
  setup_incomplete: { status: 422, title: 'A prerequisite is missing' },
  internal: { status: 500, title: 'Internal error' },
} as const satisfies Record<string, { status: ContentfulStatusCode; title: string }>;

export type ProblemCode = keyof typeof problemCodes;

export const Problem = z
  .object({
    type: z.string().openapi({ example: 'urn:overload:problem:unauthenticated' }),
    title: z.string(),
    status: z.int(),
    detail: z.string().optional(),
    code: z
      .string()
      .openapi({ description: 'Stable and machine-readable. Clients switch on this.' }),
    requestId: z.string(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .openapi({ description: 'Present only for `validation_failed`.' }),
    routines: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .optional()
      .openapi({ description: 'Present only for `exercise_in_routine`: the routines using it.' }),
    missing: z
      .array(z.enum(['profile', 'foods', 'day_routine', 'goal_phase']))
      .optional()
      .openapi({ description: 'Present only for `setup_incomplete`: the steps to finish first.' }),
  })
  .openapi('Problem');

export type ProblemBody = z.infer<typeof Problem>;

/** An OpenAPI response entry for a problem, for a route's `responses`. */
export function problemResponse(description: string) {
  return { description, content: { 'application/problem+json': { schema: Problem } } };
}

/**
 * The problem detail for `code`, typed with that code's status so a route's handler can return it
 * for a response it declares.
 */
export function problem<C extends ProblemCode>(
  c: Context,
  code: C,
  extra: Pick<ProblemBody, 'detail' | 'errors' | 'routines' | 'missing'> = {},
) {
  const { title } = problemCodes[code];
  const status: (typeof problemCodes)[C]['status'] = problemCodes[code].status;
  const body: ProblemBody = {
    type: `urn:overload:problem:${code}`,
    title,
    status,
    code,
    // Set by the request-id middleware on every request. The detail never carries a value the
    // user sent, only the field it concerns (docs/03 §7).
    requestId: c.get('requestId') ?? 'unknown',
    ...extra,
  };
  // c.json keeps a Content-Type it is given, so this is sent as application/problem+json.
  return c.json(body, status, { 'Content-Type': 'application/problem+json' });
}
