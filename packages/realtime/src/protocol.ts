import { z } from 'zod';
import { PublicChannel, type Channel } from './events';

/** Largest message the gateway accepts from a client, in bytes. A Privy access token is about 1 KB. */
export const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;

export const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(10).max(6000), lastEventId: z.string().regex(/^\d{1,16}-\d{1,16}$/).optional(), channels: z.array(PublicChannel).max(8).optional() }).strict(),
  z.object({ type: z.literal('subscribe'), channels: z.array(PublicChannel).min(1).max(8) }).strict(),
  z.object({ type: z.literal('unsubscribe'), channels: z.array(PublicChannel).min(1).max(8) }).strict(),
  z.object({ type: z.literal('ping') }).strict(),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export type ServerMessage =
  | { type: 'ready'; connectionId: string; channels: Channel[]; serverTime: string }
  | { type: 'subscribed'; channels: Channel[] }
  | { type: 'event'; id: string; channel: Channel; event: { type: string; at: string; data: unknown } }
  /** The client missed events that can no longer be replayed. It should refetch the REST resources it displays. */
  | { type: 'resync'; reason: 'too_old' | 'too_many' | 'server_restart' | 'slow' }
  | { type: 'pong'; serverTime: string }
  | { type: 'error'; code: string };

/** WebSocket close codes. 4xxx are application codes. */
export const CLOSE = {
  AUTH_TIMEOUT: 4408,
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  TOKEN_EXPIRED: 4411,
  RATE_LIMITED: 4429,
  SLOW_CONSUMER: 4413,
  TOO_MANY_CONNECTIONS: 4430,
  SERVER_SHUTDOWN: 1001,
  BAD_MESSAGE: 4400,
} as const;
