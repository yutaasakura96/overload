import type { Config } from './config';
import type { Database } from './db/connection';

/** The signed-in caller, set by the session middleware on every member route. */
export type SessionUser = { id: string; name: string; email: string; image: string | null };

export type AppEnv = { Variables: { user: SessionUser; requestId: string } };

/** What a route needs to answer. The routes never see Better Auth itself. */
export type RouteDeps = { config: Config; db: Database };
