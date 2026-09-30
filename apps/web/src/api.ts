import type { paths, Problem } from '@overload/api-contract';
import createClient from 'openapi-fetch';

// The API, typed from the generated contract only (CLAUDE.md: never from apps/api). Same origin:
// /api/* reaches the API through the rewrite, so the session cookie is first-party.
export const api = createClient<paths>({ baseUrl: '' });

/** A failed call, carrying the HTTP status, our problem `code` and the problem itself (docs/07 §1.3). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly problem?: Partial<Problem>,
  ) {
    super(`API ${status}${code === undefined ? '' : ` ${code}`}`);
    this.name = 'ApiError';
  }

  /** The field paths a 422 refused, each with the server's message (`errors[]`). */
  get fieldErrors(): Map<string, string> {
    return new Map((this.problem?.errors ?? []).map((error) => [error.path, error.message]));
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
  throw toApiError(result);
}

/** For a call answered with an empty 204: nothing, or an ApiError. */
export function expectOk(result: { error?: unknown; response: Response }): void {
  if (result.response.ok) return;
  throw toApiError(result);
}

function toApiError(result: { error?: unknown; response: Response }) {
  const problem = result.error;
  if (typeof problem !== 'object' || problem === null || !('code' in problem)) {
    return new ApiError(result.response.status, undefined);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our API answers with a Problem
  return new ApiError(result.response.status, String(problem.code), problem as Partial<Problem>);
}
