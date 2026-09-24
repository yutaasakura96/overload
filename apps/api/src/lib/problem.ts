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
  validation_failed: { status: 422, title: 'Request body failed validation' },
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
  })
  .openapi('Problem');

export type ProblemBody = z.infer<typeof Problem>;

/** An OpenAPI response entry for a problem, for a route's `responses`. */
export function problemResponse(description: string) {
  return { description, content: { 'application/problem+json': { schema: Problem } } };
}

export function problem(
  c: Context,
  code: ProblemCode,
  extra: { detail?: string; errors?: ProblemBody['errors'] } = {},
) {
  const { status, title } = problemCodes[code];
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
  return c.body(JSON.stringify(body), status, { 'Content-Type': 'application/problem+json' });
}
