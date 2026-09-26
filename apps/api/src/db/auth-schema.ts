// Better Auth 1.7.5's five tables, as its CLI generates them (docs/12 §3):
//
//   pnpm dlx auth@<pinned version> generate --config scripts/auth-schema.ts --output <scratch file>
//
// Two edits to the generated file, both to match docs/04's conventions: every timestamp is
// `withTimezone` (timestamptz), and the two `userId` indexes are named in snake_case. Table and column
// names are snake_case as generated: the Drizzle adapter finds a model by its key here and a field by
// its JavaScript key, and the column's own name is what reaches SQL. On a Better Auth upgrade,
// generate again into a scratch file, carry the difference over here, and let `pnpm db:generate`
// write the migration.
import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const user = pgTable('user', {
  id: uuid('id')
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: instant('created_at').defaultNow().notNull(),
  updatedAt: instant('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  'session',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    expiresAt: instant('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: instant('access_token_expires_at'),
    refreshTokenExpiresAt: instant('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: instant('expires_at').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const rateLimit = pgTable('rate_limit', {
  id: uuid('id')
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

/** What the Drizzle adapter is given: Better Auth's tables only, keyed by model name. */
export const authSchema = {
  user,
  session,
  account,
  verification,
  rateLimit,
  userRelations,
  sessionRelations,
  accountRelations,
};
