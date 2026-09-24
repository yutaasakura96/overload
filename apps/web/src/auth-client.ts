import { createAuthClient } from 'better-auth/react';

// Better Auth's own client, for its /api/auth/* routes only. It is served from the web origin,
// behind the same rewrite as everything else under /api (docs/03 §5).
export const authClient = createAuthClient({ basePath: '/api/auth' });
