import { z } from 'zod';

export const Limit = z.coerce.number().int().min(1).max(100).default(25);

/**
 * Cursors are opaque to clients: base64url of a small JSON array. They are validated on the way in, so a client cannot
 * smuggle anything into a query with a crafted cursor. A bad cursor is a 400, never a 500.
 */
export function encodeCursor(parts: (string | number)[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}

export function decodeCursor<T extends z.ZodTypeAny>(raw: string, shape: T): z.infer<T> | null {
  if (raw.length > 300) return null;
  try {
    const parsed = shape.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** An id cursor for lists ordered by a stable key plus id. The id is checked against the database's own id shape. */
export const IdCursor = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/**
 * Escapes the characters that act as wildcards in a SQL LIKE pattern (% and _) and the escape character itself, so user text is
 * matched literally. Prisma's contains, startsWith and endsWith do NOT do this for the caller: a search for "%%" would match
 * every row. Use this on any user text passed to those filters.
 */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
