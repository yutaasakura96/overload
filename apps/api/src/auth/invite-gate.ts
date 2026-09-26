import { eq } from 'drizzle-orm';
import type { Database } from '../db/connection';
import { invite } from '../db/schema';

// The invite gate (docs/08 §1) and the admin bootstrap (§3). These queries sit outside
// `src/db/` on purpose: they run before any session exists, so there is no session user to take.

export type GateRefusal = { error: GateError; errorDescription: string };
export type GateError = 'email_unverified' | 'access_revoked' | 'not_invited';

// `errorDescription` reaches the client. It names the case, never the email.
const refusals: Record<GateError, GateRefusal> = {
  email_unverified: {
    error: 'email_unverified',
    errorDescription: 'Use a Google account with a verified email.',
  },
  access_revoked: { error: 'access_revoked', errorDescription: 'Your access was revoked.' },
  not_invited: {
    error: 'not_invited',
    errorDescription: "This Google account hasn't been invited.",
  },
};

export type IdentityToCheck = { email?: unknown; emailVerified?: unknown };

/**
 * Decides whether a Google identity may sign in. Runs on first sign-in, on linking, and on every
 * later sign-in with Google's fresh email, so a revoked invite is refused the next time.
 * Returns nothing to admit.
 */
export async function checkInvite(
  db: Database,
  adminEmail: string,
  identity: IdentityToCheck,
): Promise<GateRefusal | undefined> {
  // An unverified address proves nothing about who is signing in, so it is refused before the
  // allowlist is read.
  if (identity.emailVerified !== true || typeof identity.email !== 'string') {
    return refusals.email_unverified;
  }
  const email = identity.email.toLowerCase();

  const [row] = await db
    .select({ revokedAt: invite.revokedAt })
    .from(invite)
    .where(eq(invite.email, email));

  if (row === undefined) {
    // On a fresh database nobody is invited, the admin included. The admin is let through, and
    // their invite row is written once the user exists (bootstrapAdminInvite).
    return email === adminEmail ? undefined : refusals.not_invited;
  }
  return row.revokedAt === null ? undefined : refusals.access_revoked;
}

/**
 * Writes the admin's own invite row the first time the admin's user is created, so every
 * environment bootstraps itself and no migration holds an email (docs/06, 2026-09-23).
 */
export async function bootstrapAdminInvite(
  db: Database,
  adminEmail: string,
  user: { id: string; email: string },
): Promise<void> {
  if (user.email.toLowerCase() !== adminEmail) return;
  await db
    .insert(invite)
    .values({ email: adminEmail, invitedByUserId: user.id, note: 'admin' })
    .onConflictDoNothing({ target: invite.email });
}
