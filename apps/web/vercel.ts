import { routes, type VercelConfig } from '@vercel/config/v1';

// The browser only ever talks to the web origin: /api/* is proxied to the API project, whose
// origin is read at build time so staging reaches the staging API (docs/12 §1). Everything else
// falls back to the client-only app. Only this file may exist, never a vercel.json beside it.
const apiOrigin = process.env.API_ORIGIN;
if (!apiOrigin) throw new Error('API_ORIGIN is not set for this deployment');

export const config: VercelConfig = {
  rewrites: [
    routes.rewrite('/api/(.*)', `${apiOrigin}/api/$1`),
    routes.rewrite('/(.*)', '/index.html'),
  ],
};
