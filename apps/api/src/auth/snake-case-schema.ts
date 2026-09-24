// Better Auth's tables in snake_case, to match every other table (docs/04, Conventions).
//
// `database: { casing: 'snake' }`, the option docs/06 chose on 2026-09-24, is declared in Better
// Auth 1.7.5's types and read nowhere at runtime or by `auth generate`, so it changes nothing. These
// per-model `modelName` and `fields` options are Better Auth's own mechanism for renaming, and both
// the adapter and the generator honour them. A Better Auth upgrade that adds a field needs a line
// here, which the generated diff makes visible (docs/12 §3).

const timestamps = { createdAt: 'created_at', updatedAt: 'updated_at' } as const;

export const snakeCaseSchema = {
  user: {
    fields: { emailVerified: 'email_verified', ...timestamps },
  },
  session: {
    fields: {
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      userId: 'user_id',
      ...timestamps,
    },
  },
  account: {
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      userId: 'user_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      ...timestamps,
    },
  },
  verification: {
    fields: { expiresAt: 'expires_at', ...timestamps },
  },
  rateLimit: {
    modelName: 'rate_limit',
    fields: { lastRequest: 'last_request' },
  },
} as const;
