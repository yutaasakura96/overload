import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DatabaseError } from 'pg';

// What an unhandled error puts in the log (docs/03 §7): its stack and, for a failed query, the SQL
// and Postgres's reason. Never a query parameter or a row value: Drizzle's own message appends the
// parameters, which can be an email or an IP, so its stack is rebuilt without them.

export type ErrorLine = {
  error: string;
  stack: string | undefined;
  cause?: Record<string, string>;
};

// Postgres's messages name objects, except in these classes, where they can quote the value that
// failed: 22 (data exception) and 23 (integrity constraint violation).
const VALUE_QUOTING_CLASSES = new Set(['22', '23']);

export function describeError(error: Error): ErrorLine {
  if (!(error instanceof DrizzleQueryError)) {
    return { error: error.name, stack: error.stack };
  }
  const framesStart = error.stack?.indexOf('\n    at ') ?? -1;
  const frames = framesStart === -1 ? '' : error.stack?.slice(framesStart);
  return {
    error: 'DrizzleQueryError',
    stack: `DrizzleQueryError: Failed query: ${error.query}${frames}`,
    ...(error.cause instanceof Error && { cause: describeCause(error.cause) }),
  };
}

function describeCause(cause: Error): Record<string, string> {
  if (!(cause instanceof DatabaseError)) {
    // A connection-level failure: refused, timed out, a TLS error. Its message names a host at most.
    const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;
    return omitUndefined({ name: cause.name, message: cause.message, code });
  }
  const { code, schema, table, column, constraint } = cause;
  const quotesValues = code === undefined || VALUE_QUOTING_CLASSES.has(code.slice(0, 2));
  return omitUndefined({
    code,
    message: quotesValues ? undefined : cause.message,
    schema,
    table,
    column,
    constraint,
  });
}

function omitUndefined(record: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
