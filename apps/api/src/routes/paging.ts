import { z } from '@hono/zod-openapi';
import type { WorkoutCursor } from '../db/history.js';
import { Uuid } from './schemas.js';

// Cursor pagination for the growing lists (docs/07 §1.4).

/** A page's default and largest size. */
const PAGE_DEFAULT = 30;
const PAGE_MAX = 100;

/** `limit` and `cursor`, as every paged route takes them. */
export const pageQuery = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGE_MAX)
    .default(PAGE_DEFAULT)
    .openapi({ description: 'Default 30, at most 100.' }),
  cursor: z.string().optional().openapi({ description: 'The previous page’s `nextCursor`.' }),
};

const CursorFields = z.tuple([z.iso.datetime({ offset: true }), Uuid]);

/** The cursor is opaque to the client: the last row's sort key and id, encoded. */
export const encodeCursor = (cursor: WorkoutCursor) =>
  Buffer.from(JSON.stringify([cursor.startedAt, cursor.id])).toString('base64url');

export function decodeCursor(text: string): WorkoutCursor | undefined {
  try {
    const read = CursorFields.safeParse(JSON.parse(Buffer.from(text, 'base64url').toString()));
    return read.success ? { startedAt: read.data[0], id: read.data[1] } : undefined;
  } catch {
    return undefined;
  }
}
