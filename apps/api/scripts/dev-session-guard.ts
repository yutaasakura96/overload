const CONFIG_NAMES = [
  'DATABASE_URL',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'ADMIN_EMAIL',
  'NODE_ENV',
  'VERCEL',
  'VERCEL_ENV',
] as const;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const ENV_HINT = 'copy apps/api/.env.example to apps/api/.env.local and fill it in';

function parse(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function localOnlyRefusals(
  fileValues: Record<string, string | undefined>,
  exportedEnv: Record<string, string | undefined>,
  databaseName = 'overload',
): string[] {
  const refusals: string[] = [];

  for (const name of CONFIG_NAMES) {
    if (exportedEnv[name] !== undefined && exportedEnv[name] !== fileValues[name]) {
      refusals.push(`${name} differs from apps/api/.env.local.`);
    }
  }

  for (const env of [fileValues, exportedEnv]) {
    if (env.NODE_ENV === 'production') refusals.push('NODE_ENV is production.');
    for (const name of ['VERCEL', 'VERCEL_ENV']) {
      if (env[name] !== undefined) refusals.push(`${name} is set.`);
    }
  }

  const database = parse(fileValues.DATABASE_URL);
  if (database === null) {
    refusals.push(`DATABASE_URL is missing or not a URL: ${ENV_HINT}.`);
  } else if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !LOCAL_HOSTS.has(database.hostname) ||
    database.port !== '5434' ||
    database.pathname !== `/${databaseName}` ||
    database.search !== ''
  ) {
    refusals.push(
      `DATABASE_URL must target local Postgres on port 5434, database ${databaseName}, without query overrides.`,
    );
  }

  const web = parse(fileValues.BETTER_AUTH_URL);
  if (web === null) {
    refusals.push(`BETTER_AUTH_URL is missing or not a URL: ${ENV_HINT}.`);
  } else if (
    web.protocol !== 'http:' ||
    !LOCAL_HOSTS.has(web.hostname) ||
    web.username !== '' ||
    web.password !== ''
  ) {
    refusals.push('BETTER_AUTH_URL must be plain-http localhost or 127.0.0.1.');
  }

  return refusals;
}
