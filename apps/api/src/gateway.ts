import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { PrismaClient } from '@narra/database';
import { CLOSE, ClientMessage, MAX_CLIENT_MESSAGE_BYTES, RealtimeHub, startStreamReader, type EventStream, type HubOptions, type HubSocket, type StreamEvent } from '@narra/realtime';
import { resolveUserId } from './account';
import type { AuthVerifier } from './auth';

/** Starting values, not tuned. */
export const GATEWAY_LIMITS = {
  /** Used when a token carries no expiry. The client re-sends its token before this to keep the connection. */
  defaultSessionMs: 10 * 60_000,
  heartbeatMs: 30_000,
  sweepMs: 1000,
  /** Most missed events replayed to one reconnecting client. Beyond this it is told to refetch. */
  maxReplayEvents: 2000,
  replayPage: 500,
} as const;

export interface GatewayDeps {
  db: PrismaClient;
  verifier: AuthVerifier;
  /** The stream on a normal Redis connection (range reads for replay). */
  stream: EventStream;
  /** The stream on a connection used only for the blocking read loop. */
  readerStream: EventStream;
  hub?: RealtimeHub;
  hubOptions?: HubOptions;
  /** Browser origins allowed to open a socket. Empty means any origin may connect, and only a valid token gets anything. */
  allowedOrigins?: string[];
  now?: () => number;
  limits?: { [K in keyof typeof GATEWAY_LIMITS]?: number };
}

/**
 * WebSocket gateway at GET /v1/stream.
 *
 * Protocol: the client opens the socket and sends {type:'auth', token, lastEventId?, channels?} within a few seconds. The token
 * goes in a message and not in the URL, so it never lands in an access log. Until then nothing is sent to the client.
 * After {type:'ready'} the client receives events for the channels it chose plus its own private `me` channel. Sending a new
 * auth message with a fresh token extends the connection; it must be the same user. Events are hints that something
 * changed: a client that gets {type:'resync'} (or is unsure) refetches the REST resources it shows.
 *
 * This process never trades and the socket cannot place orders. It only forwards events that already exist in the stream.
 */
export async function registerGateway(app: FastifyInstance, deps: GatewayDeps): Promise<{ hub: RealtimeHub }> {
  const L = { ...GATEWAY_LIMITS, ...deps.limits };
  const now = deps.now ?? Date.now;
  const hub = deps.hub ?? new RealtimeHub(deps.hubOptions);
  const origins = deps.allowedOrigins ?? [];

  let sweeper: ReturnType<typeof setInterval> | undefined;
  // The plugin's own shutdown step closes every client with no status code (1005), which a client cannot tell from a crash.
  // Replace it with one that sends 1001 (going away) through the hub first, so clients know to reconnect, then stops the
  // WebSocket server. The HTTP server stops accepting upgrades right after this hook, so keeping the plugin's listener is harmless.
  await app.register(websocket, {
    options: { maxPayload: MAX_CLIENT_MESSAGE_BYTES },
    preClose: function (this: FastifyInstance & { websocketServer?: { close(): void } }, done: () => void) {
      if (sweeper) clearInterval(sweeper);
      hub.closeAll(CLOSE.SERVER_SHUTDOWN, 'shutdown');
      try { this.websocketServer?.close(); } catch { /* already closed */ }
      done();
    },
  });

  const reader = startStreamReader({
    stream: deps.readerStream,
    onEvents: (events: StreamEvent[]) => { for (const e of events) hub.dispatch(e); },
    onError: (e) => app.log.warn({ err: e }, 'realtime stream read failed; retrying'),
  });
  sweeper = setInterval(() => hub.sweep(), L.sweepMs);
  sweeper.unref();
  app.addHook('onClose', async () => { await reader.stop(); });

  async function replay(id: string, lastEventId: string): Promise<void> {
    hub.beginReplay(id, lastEventId);
    try {
      if (!(await deps.stream.canResumeFrom(lastEventId))) return hub.completeReplay(id, { resync: 'too_old' });
      const missed: StreamEvent[] = [];
      let after = lastEventId;
      for (;;) {
        const page = await deps.stream.readRangePage(after, L.replayPage);
        missed.push(...page.events);
        if (page.rawCount < L.replayPage || !page.lastId) break;
        after = page.lastId;
        if (missed.length >= L.maxReplayEvents) return hub.completeReplay(id, { resync: 'too_many' });
      }
      hub.completeReplay(id, { missed });
    } catch (e) {
      app.log.warn({ err: e }, 'realtime replay failed');
      hub.completeReplay(id, { resync: 'server_restart' });
    }
  }

  app.get('/v1/stream', { websocket: true, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, (socket: WebSocket, req) => {
    const origin = req.headers.origin;
    if (origins.length && origin && !origins.includes(origin)) { socket.close(CLOSE.FORBIDDEN, 'origin_not_allowed'); return; }

    const hubSocket: HubSocket = {
      send: (m) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m)); },
      close: (code, reason) => { try { socket.close(code, reason.slice(0, 100)); } catch { /* already closed */ } },
      bufferedBytes: () => socket.bufferedAmount,
    };
    const id = hub.connect(hubSocket);
    if (!id) { socket.close(CLOSE.TOO_MANY_CONNECTIONS, 'server_full'); return; }

    let authed = false;
    let authBusy = false;
    let alive = true;
    socket.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false;
      try { socket.ping(); } catch { /* closing */ }
    }, L.heartbeatMs);
    heartbeat.unref();
    const cleanup = () => { clearInterval(heartbeat); hub.disconnect(id); };
    socket.on('close', cleanup);
    socket.on('error', cleanup);

    socket.on('message', async (raw, isBinary) => {
      if (isBinary) return hub.close(id, CLOSE.BAD_MESSAGE, 'text_only');
      if (!hub.allowMessage(id)) return hub.close(id, CLOSE.RATE_LIMITED, 'rate_limited');
      let json: unknown;
      try { json = JSON.parse(raw.toString()); } catch { return hub.send(id, { type: 'error', code: 'bad_message' }); }
      const m = ClientMessage.safeParse(json);
      if (!m.success) return hub.send(id, { type: 'error', code: 'bad_message' });
      const msg = m.data;

      if (msg.type === 'ping') return hub.send(id, { type: 'pong', serverTime: new Date(now()).toISOString() });

      if (msg.type === 'auth') {
        if (authBusy) return; // one verification at a time per socket
        authBusy = true;
        try {
          let v: { privyUserId: string; expiresAtMs: number | null };
          try {
            v = deps.verifier.verifyWithExpiry ? await deps.verifier.verifyWithExpiry(msg.token) : { ...(await deps.verifier.verify(msg.token)), expiresAtMs: null };
          } catch {
            return hub.close(id, CLOSE.UNAUTHORIZED, 'unauthorized'); // never say why
          }
          const expiresAtMs = v.expiresAtMs ?? now() + L.defaultSessionMs;
          if (expiresAtMs <= now()) return hub.close(id, CLOSE.UNAUTHORIZED, 'unauthorized');
          const userId = await resolveUserId(deps.db, v.privyUserId);
          const r = hub.authenticate(id, userId, expiresAtMs, msg.channels);
          if (!r.ok) return hub.close(id, r.close, r.reason);
          const first = !authed;
          authed = true;
          hub.send(id, { type: 'ready', connectionId: id, channels: r.channels, serverTime: new Date(now()).toISOString() });
          if (first && msg.lastEventId) await replay(id, msg.lastEventId);
        } catch (e) {
          app.log.warn({ err: e }, 'realtime auth failed');
          hub.close(id, 1011, 'server_error');
        } finally { authBusy = false; }
        return;
      }

      if (!authed) return hub.close(id, CLOSE.UNAUTHORIZED, 'auth_required');
      if (msg.type === 'subscribe') { const ch = hub.subscribe(id, msg.channels); if (ch) hub.send(id, { type: 'subscribed', channels: ch }); return; }
      if (msg.type === 'unsubscribe') { const ch = hub.unsubscribe(id, msg.channels); if (ch) hub.send(id, { type: 'subscribed', channels: ch }); }
    });
  });

  return { hub };
}
