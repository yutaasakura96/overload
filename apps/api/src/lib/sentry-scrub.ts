import type { ErrorEvent, EventHint } from '@sentry/node';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DatabaseError } from 'pg';

// What an API event may carry to Sentry (docs/03 §7): no user, no request body, headers, cookies or
// query string, and no value from a row or a request. The client is set up to collect none of it
// (src/sentry.ts); this is the last check before an event leaves, and it keeps only what it knows.

// The contexts the Node SDK fills from the machine and the runtime. Anything else is dropped.
const MACHINE_CONTEXTS = new Set(['app', 'cloud_resource', 'culture', 'device', 'os', 'runtime']);

// Postgres's messages name objects, except in these SQLSTATE classes, where they can quote the value
// that failed: 22 (data exception) and 23 (integrity constraint violation).
const VALUE_QUOTING_CLASSES = new Set(['22', '23']);

export function scrubEvent(event: ErrorEvent, hint: EventHint): ErrorEvent {
  const replacements = safeMessages(hint.originalException);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value === undefined) continue;
    exception.value = replacements.get(exception.value) ?? withoutParams(exception.value);
  }

  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  if (event.request !== undefined) {
    const { method, url } = event.request;
    event.request = { method, url: url === undefined ? undefined : withoutQuery(url) };
  }
  if (event.transaction !== undefined) event.transaction = withoutQuery(event.transaction);
  if (event.contexts !== undefined) {
    event.contexts = Object.fromEntries(
      Object.entries(event.contexts).filter(([name]) => MACHINE_CONTEXTS.has(name)),
    );
  }
  return event;
}

// Each error in the cause chain whose message can hold a value, mapped to a message that cannot.
function safeMessages(error: unknown): Map<string, string> {
  const replacements = new Map<string, string>();
  for (let e = error, depth = 0; e instanceof Error && depth < 10; e = e.cause, depth += 1) {
    if (e instanceof DrizzleQueryError) {
      // Drizzle's message appends the parameters, which can be an email, a token or an IP.
      replacements.set(e.message, `Failed query: ${e.query}`);
    } else if (e instanceof DatabaseError && quotesValues(e.code)) {
      replacements.set(e.message, `Postgres error ${e.code ?? 'unknown'}`);
    }
  }
  return replacements;
}

const quotesValues = (code: string | undefined) =>
  code === undefined || VALUE_QUOTING_CLASSES.has(code.slice(0, 2));

// A message nobody mapped above, from a query error wrapped some other way: cut Drizzle's params.
function withoutParams(message: string): string {
  const at = message.indexOf('\nparams:');
  return at === -1 ? message : message.slice(0, at);
}

function withoutQuery(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url;
}
