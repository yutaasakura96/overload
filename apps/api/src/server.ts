import { serve } from '@hono/node-server';
import app from './index';

// Local only: `pnpm --filter @overload/api dev`. The web app's dev server proxies /api here, so
// the browser sees one origin, as it does behind the Vercel rewrite.
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(JSON.stringify({ listening: `http://localhost:${info.port}` }));
});
