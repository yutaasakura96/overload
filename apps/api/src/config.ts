import { z } from 'zod';

// Everything the API reads from its environment (docs/12 §2), checked once at start-up so a
// missing variable fails the deploy rather than the first request that needs it.
const Env = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ADMIN_EMAIL: z.email(),
});

export type Config = {
  databaseUrl: string;
  /** The web origin. The API is reached through the web app's rewrite (docs/03 §5). */
  webOrigin: string;
  authSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  /** Lowercased, so it compares with the lowercased emails in `invite`. */
  adminEmail: string;
};

export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    // Names only: a value here may be a secret.
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Missing or invalid environment variables: ${names}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    webOrigin: new URL(e.BETTER_AUTH_URL).origin,
    authSecret: e.BETTER_AUTH_SECRET,
    googleClientId: e.GOOGLE_CLIENT_ID,
    googleClientSecret: e.GOOGLE_CLIENT_SECRET,
    adminEmail: e.ADMIN_EMAIL.toLowerCase(),
  };
}
