import { eq } from 'drizzle-orm';
import type { Database } from './connection.js';
import { auditEvent, invite, user } from './schema.js';

/**
 * Deletes the user's account (S10, docs/08 §6) in one transaction: their invite, so the address is
 * no longer kept and coming back takes a new invite, then the `user` row, which cascades through
 * every table of theirs. The custom exercises' references from routines and workouts are deferred,
 * so the order the cascade takes does not matter (docs/04). The audit row outlives it (docs/13 §7).
 */
export async function deleteAccount(db: Database, owner: { id: string; email: string }) {
  await db.transaction(async (tx) => {
    await tx.insert(auditEvent).values({
      actorUserId: owner.id,
      action: 'account_deleted',
      targetType: 'user',
      targetId: owner.id,
    });
    await tx.delete(invite).where(eq(invite.email, owner.email.toLowerCase()));
    await tx.delete(user).where(eq(user.id, owner.id));
  });
}
