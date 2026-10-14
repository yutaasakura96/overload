import { desc, eq, sql } from 'drizzle-orm';
import type { Database, Queryable } from './connection.js';
import { auditEvent, invite, session, user } from './schema.js';

// Invite administration (S9, docs/08 §8). The admin acts on every invite, not on their own rows,
// so each function takes the admin's user id as the actor: it is who an invite is invited by and
// whom the audit row names (docs/13 §7). The route reaches these only after the admin check.
// What a member has logged is never read here (docs/08 §4).

export type Invite = {
  id: string;
  email: string;
  note: string | null;
  invitedAt: string;
  revokedAt: string | null;
};

type InviteRow = Omit<Invite, 'invitedAt' | 'revokedAt'> & {
  invitedAt: Date;
  revokedAt: Date | null;
};

const shape = (row: InviteRow): Invite => ({
  ...row,
  invitedAt: row.invitedAt.toISOString(),
  revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
});

const columns = {
  id: invite.id,
  email: invite.email,
  note: invite.note,
  invitedAt: invite.createdAt,
  revokedAt: invite.revokedAt,
};

/** Every invite, newest first. Tens of rows, so not paged (docs/07 §1.4). */
export async function listInvites(db: Database, _adminId: string): Promise<Invite[]> {
  const rows = await db
    .select(columns)
    .from(invite)
    .orderBy(desc(invite.createdAt), desc(invite.id));
  return rows.map(shape);
}

async function findInvite(db: Queryable, id: string): Promise<Invite | undefined> {
  const [found] = await db.select(columns).from(invite).where(eq(invite.id, id));
  return found === undefined ? undefined : shape(found);
}

export type CreateInviteResult =
  | { kind: 'created'; invite: Invite }
  | { kind: 'existing'; invite: Invite }
  | { kind: 'invite_exists' }
  | { kind: 'id_conflict' };

/**
 * Invites an email, lowercased. A repeat of the same create returns the stored invite (docs/07
 * §1.2); an email that already has a row, revoked or not, is `invite_exists`: it is restored, not
 * invited again.
 */
export async function createInvite(
  db: Database,
  adminId: string,
  input: { id: string; email: string; note: string | null },
): Promise<CreateInviteResult> {
  const email = input.email.toLowerCase();
  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(invite)
      .values({ id: input.id, email, note: input.note, invitedByUserId: adminId })
      .onConflictDoNothing()
      .returning(columns);
    const [row] = inserted;
    if (row === undefined) return undefined;
    await audit(tx, adminId, 'invite_created', 'invite', row.id);
    return shape(row);
  });
  if (created !== undefined) return { kind: 'created', invite: created };

  const stored = await findInvite(db, input.id);
  if (stored === undefined) return { kind: 'invite_exists' };
  return stored.email === email && stored.note === input.note
    ? { kind: 'existing', invite: stored }
    : { kind: 'id_conflict' };
}

export type RevokeInviteResult =
  | { kind: 'revoked'; invite: Invite }
  | { kind: 'not_found' }
  | { kind: 'admin_account' };

/**
 * Revokes an invite (docs/08 §8): `revoked_at` is set and every login session of that user is
 * deleted, so the cookie and the bearer token each fail on their next request. Their data stays.
 * Revoking a revoked invite returns it unchanged. The admin's own invite is refused.
 *
 * Ingest tokens are revoked here too once they exist: `ingest_token` and its route arrive in M3,
 * and that slice adds their `revoked_at` beside the session delete below (docs/06, 2026-10-15).
 */
export async function revokeInvite(
  db: Database,
  adminId: string,
  adminEmail: string,
  id: string,
): Promise<RevokeInviteResult> {
  return db.transaction(async (tx): Promise<RevokeInviteResult> => {
    // Locked, so a revoke and a restore of the same invite run one after the other.
    const [found] = await tx.select(columns).from(invite).where(eq(invite.id, id)).for('update');
    if (found === undefined) return { kind: 'not_found' };
    if (found.email === adminEmail) return { kind: 'admin_account' };
    if (found.revokedAt !== null) return { kind: 'revoked', invite: shape(found) };

    const [revoked] = await tx
      .update(invite)
      .set({ revokedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(invite.id, id))
      .returning(columns);
    if (revoked === undefined) return { kind: 'not_found' };
    const member = await memberOf(tx, revoked.email);
    if (member !== undefined) await tx.delete(session).where(eq(session.userId, member));
    await audit(tx, adminId, 'access_revoked', 'user', member ?? null, revoked.id);
    return { kind: 'revoked', invite: shape(revoked) };
  });
}

/**
 * Clears `revoked_at`, so the member can sign in again and finds every row as they left it.
 * Ingest tokens stay revoked: the member makes a new one (docs/08 §8). Restoring an invite that is
 * not revoked returns it unchanged.
 */
export async function restoreInvite(
  db: Database,
  adminId: string,
  id: string,
): Promise<Invite | undefined> {
  return db.transaction(async (tx) => {
    const [found] = await tx.select(columns).from(invite).where(eq(invite.id, id)).for('update');
    if (found === undefined) return undefined;
    if (found.revokedAt === null) return shape(found);
    const member = await memberOf(tx, found.email);
    if (member !== undefined) await tx.delete(session).where(eq(session.userId, member));
    const [restored] = await tx
      .update(invite)
      .set({ revokedAt: null, updatedAt: sql`now()` })
      .where(eq(invite.id, id))
      .returning(columns);
    if (restored === undefined) return undefined;
    await audit(tx, adminId, 'access_restored', 'user', member ?? null, restored.id);
    return shape(restored);
  });
}

/** The user an invite admits, once they have signed in. The gate matches emails lowercased. */
async function memberOf(tx: Queryable, email: string): Promise<string | undefined> {
  const [found] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email));
  return found?.id;
}

/**
 * The audit row, in the action's transaction (docs/13 §7). Ids only, never the email. A revoke or
 * restore names the user; one whose person never signed in has no user, so the invite's id is kept
 * in `detail` instead.
 */
async function audit(
  tx: Queryable,
  actorUserId: string,
  action: 'invite_created' | 'access_revoked' | 'access_restored',
  targetType: 'invite' | 'user',
  targetId: string | null,
  inviteId?: string,
) {
  await tx.insert(auditEvent).values({
    actorUserId,
    action,
    targetType,
    targetId,
    detail: inviteId === undefined ? null : { inviteId },
  });
}
