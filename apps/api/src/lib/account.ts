import { z } from '@hono/zod-openapi';

// Every member response names the account it was answered for, so a client holding one account's
// saved copy can refuse an answer made under another account's cookie (docs/08 §5). The web app
// reads the same name from packages/api-contract.
export const ACCOUNT_HEADER = 'Overload-User';

/** The `headers` of a member route's successful response, for its OpenAPI entry. */
export const accountHeaders = z.object({
  [ACCOUNT_HEADER]: z.uuid().openapi({
    description: 'The id of the user whose session answered. Keep the body for that account only.',
  }),
});
