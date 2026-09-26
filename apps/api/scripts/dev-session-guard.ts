// Why `pnpm dev:session` must not run here, checked before it connects or writes anything. Empty
// means local: the Docker database, a plain-http localhost web origin, and no deployment's variables.
// Values are never echoed back, only the host or origin at fault: a URL may carry a password.

/** The local Docker Postgres, from the host or from inside the compose network (docker-compose.yml). */
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'postgres']);
const LOCAL_WEB_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const ENV_HINT = 'copy apps/api/.env.example to apps/api/.env.local and fill it in';

function parse(url: string | undefined) {
  if (url === undefined || url === '') return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function localOnlyRefusals(env: Record<string, string | undefined>): string[] {
  const refusals: string[] = [];

  if (env.NODE_ENV === 'production') refusals.push('NODE_ENV is production.');

  // Vercel sets these on every deployment, and `vercel env pull` writes them into the file it pulls,
  // so their presence means the secrets came from a deployment.
  for (const name of ['VERCEL', 'VERCEL_ENV']) {
    if (env[name] !== undefined) {
      refusals.push(`${name} is set: these variables come from a Vercel deployment.`);
    }
  }

  const database = parse(env.DATABASE_URL);
  if (database === null) {
    refusals.push(`DATABASE_URL is missing or not a URL: ${ENV_HINT}.`);
  } else if (!LOCAL_DATABASE_HOSTS.has(database.hostname)) {
    refusals.push(
      `DATABASE_URL points at ${database.hostname}, not the local Docker Postgres ` +
        `(${[...LOCAL_DATABASE_HOSTS].join(', ')}).`,
    );
  }

  // BETTER_AUTH_SECRET signs the cookie. Its value cannot say where it came from, so its pair does:
  // a deployment's web origin is https on a real host, the local one is http://localhost:5173.
  const web = parse(env.BETTER_AUTH_URL);
  if (web === null) {
    refusals.push(`BETTER_AUTH_URL is missing or not a URL: ${ENV_HINT}.`);
  } else if (web.protocol !== 'http:' || !LOCAL_WEB_HOSTS.has(web.hostname)) {
    refusals.push(
      `BETTER_AUTH_URL is ${web.origin}, not http://localhost, so BETTER_AUTH_SECRET may be a ` +
        'deployed one.',
    );
  }

  return refusals;
}
