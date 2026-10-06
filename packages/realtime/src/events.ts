import { z } from 'zod';

/**
 * Channels a client can subscribe to. `me` is private: it only ever carries events for the signed-in user and the
 * gateway adds it to every connection. The others are shared market data that every signed-in user may read
 * (the same data the REST read routes already return).
 */
export const PUBLIC_CHANNELS = ['narratives', 'opportunities', 'decisions', 'smartmoney', 'market', 'alerts'] as const;
export const CHANNELS = [...PUBLIC_CHANNELS, 'me'] as const;
export const Channel = z.enum(CHANNELS);
export type Channel = z.infer<typeof Channel>;
export const PublicChannel = z.enum(PUBLIC_CHANNELS);

const iso = z.string().datetime();
const num = z.number().finite();

/**
 * Every event type, the channel it travels on, and the shape of its data. Events are small notifications, not state:
 * a client that misses one refetches the REST resource. Free-text fields (titles, bodies, symbols) were sanitized when
 * they were stored, and clients must still render them as text.
 */
export const EVENT_DEFS = {
  'narrative.updated': { channel: 'narratives', scope: 'global', data: z.object({ id: z.string(), slug: z.string(), name: z.string(), stage: z.string(), score: num, velocity: num, acceleration: num, organicScore: num }) },
  'opportunity.created': { channel: 'opportunities', scope: 'global', data: z.object({ id: z.string(), mint: z.string(), symbol: z.string(), narrativeSlug: z.string().nullable(), score: num }) },
  'decision.created': { channel: 'decisions', scope: 'global', data: z.object({ id: z.string(), opportunityId: z.string().nullable(), action: z.string(), confidence: num }) },
  'consensus.updated': { channel: 'smartmoney', scope: 'global', data: z.object({ mint: z.string(), symbol: z.string(), score: num, walletCount: z.number().int(), independentEntities: z.number().int(), netFlowSol: num.nullable() }) },
  'market.sol': { channel: 'market', scope: 'global', data: z.object({ priceUsd: num }) },
  'alert.created': { channel: 'alerts', scope: 'global', data: z.object({ id: z.string(), kind: z.string(), priority: z.string(), title: z.string(), body: z.string(), refType: z.string().nullable(), refId: z.string().nullable() }) },
  'notification.created': { channel: 'me', scope: 'user', data: z.object({ id: z.string(), alertId: z.string(), kind: z.string(), priority: z.string(), title: z.string(), body: z.string(), refType: z.string().nullable(), refId: z.string().nullable() }) },
  'position.evaluated': { channel: 'me', scope: 'user', data: z.object({ positionId: z.string(), evaluationId: z.string(), action: z.string(), fractionPct: z.number().int(), pnlPct: num.nullable(), blind: z.boolean() }) },
  'confirmation.created': { channel: 'me', scope: 'user', data: z.object({ id: z.string(), kind: z.string(), mint: z.string(), sizeSol: num, expiresAt: iso }) },
  'trade.created': { channel: 'me', scope: 'user', data: z.object({ id: z.string(), side: z.string(), mode: z.string(), simulated: z.boolean(), mint: z.string().nullable(), sizeSol: num.nullable(), realizedPnlSol: num.nullable() }) },
} as const;

export type EventType = keyof typeof EVENT_DEFS;
export const EVENT_TYPES = Object.keys(EVENT_DEFS) as EventType[];
export type EventData<T extends EventType> = z.infer<(typeof EVENT_DEFS)[T]['data']>;

/** What a producer hands to publishEvent. */
export interface NewEvent<T extends EventType = EventType> {
  type: T;
  /** Required for user-scoped events, forbidden for global ones. */
  userId?: string;
  at: Date;
  data: EventData<T>;
}

/** An event as read back from the stream. `id` is the Redis stream id, which is also the resume cursor. */
export interface StreamEvent {
  id: string;
  type: EventType;
  channel: Channel;
  scope: 'global' | 'user';
  userId: string | null;
  at: string;
  data: unknown;
}

/** Validates a producer's event. Throws on a wrong scope or shape, so a bad producer cannot publish something odd. */
export function validateNewEvent(e: NewEvent): { channel: Channel; scope: 'global' | 'user'; data: unknown } {
  const def = EVENT_DEFS[e.type];
  if (!def) throw new Error(`unknown event type ${String(e.type)}`);
  if (def.scope === 'user' && !e.userId) throw new Error(`${e.type} needs a userId`);
  if (def.scope === 'global' && e.userId) throw new Error(`${e.type} is global and must not carry a userId`);
  return { channel: def.channel, scope: def.scope, data: def.data.parse(e.data) };
}
