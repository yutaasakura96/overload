import type { paths } from '@overload/api-contract';
import createClient from 'openapi-fetch';

// The API, typed from the generated contract only (CLAUDE.md: never from apps/api). Same origin:
// /api/* reaches the API through the rewrite, so the session cookie is first-party.
export const api = createClient<paths>({ baseUrl: '' });

/** A failed call, carrying the HTTP status and our problem `code` (docs/07 §1.3). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`API ${status}${code === undefined ? '' : ` ${code}`}`);
    this.name = 'ApiError';
  }
}

export const isUnauthenticated = (error: unknown) =>
  error instanceof ApiError && error.status === 401;

/** Unwraps an openapi-fetch result: the data, or an ApiError. */
export function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): NonNullable<T> {
  if (result.data !== undefined && result.data !== null) return result.data;
  const problem = result.error;
  const code =
    typeof problem === 'object' && problem !== null && 'code' in problem
      ? String(problem.code)
      : undefined;
  throw new ApiError(result.response.status, code);
}
