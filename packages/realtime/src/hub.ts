import { randomUUID } from 'node:crypto';
import { CLOSE, type ServerMessage } from './protocol';
import { compareIds } from './stream';
import { PUBLIC_CHANNELS, type Channel, type StreamEvent } from './events';

/** The hub never touches a real socket. The gateway wraps one in this. `send` and `close` must not throw. */
export interface HubSocket {
  send(msg: ServerMessage): void;
  close(code: number, reason: string): void;
  /** Bytes queued for this client and not yet written. */
  bufferedBytes(): number;
}

export interface HubOptions {
  /** Starting values, not tuned. */
  maxPerUser?: number;
  maxTotal?: number;
  maxBufferedBytes?: number;
  authTimeoutMs?: number;
  /** Live events held for one connection while its replay runs. Over this, the client is told to resync. */
  maxPending?: number;
  rateLimit?: { count: number; windowMs: number };
  now?: () => number;
}

interface Conn {
  id: string;
  socket: HubSocket;
  connectedAt: number;
  userId: string | null;
  expiresAtMs: number | null;
  channels: Set<Channel>;
  /** Highest stream id already delivered. Live events at or below it are skipped (they were part of a replay). */
  cursor: string;
  replaying: boolean;
  pending: StreamEvent[];
  pendingOverflow: boolean;
  recent: number[];
}

export type AuthResult = { ok: true; channels: Channel[] } | { ok: false; close: number; reason: string };

export class RealtimeHub {
  private conns = new Map<string, Conn>();
  private byUser = new Map<string, Set<string>>();
  private byChannel = new Map<Channel, Set<string>>();
  private o: Required<Omit<HubOptions, 'now'>> & { now: () => number };

  constructor(opts: HubOptions = {}) {
    this.o = {
      maxPerUser: opts.maxPerUser ?? 5,
      maxTotal: opts.maxTotal ?? 5000,
      maxBufferedBytes: opts.maxBufferedBytes ?? 1_000_000,
      authTimeoutMs: opts.authTimeoutMs ?? 5000,
      maxPending: opts.maxPending ?? 1000,
      rateLimit: opts.rateLimit ?? { count: 30, windowMs: 10_000 },
      now: opts.now ?? Date.now,
    };
  }

  stats() {
    return { connections: this.conns.size, authenticated: [...this.conns.values()].filter((c) => c.userId).length, users: this.byUser.size };
  }

  /** Registers a new, unauthenticated connection. Returns null when the server is full. */
  connect(socket: HubSocket): string | null {
    if (this.conns.size >= this.o.maxTotal) return null;
    const id = randomUUID();
    this.conns.set(id, { id, socket, connectedAt: this.o.now(), userId: null, expiresAtMs: null, channels: new Set(), cursor: '0-0', replaying: false, pending: [], pendingOverflow: false, recent: [] });
    return id;
  }

  /** Idempotent. Call when the underlying socket closes. */
  disconnect(id: string): void {
    const c = this.conns.get(id);
    if (!c) return;
    this.conns.delete(id);
    if (c.userId) this.unindexUser(c.userId, id);
    for (const ch of c.channels) this.byChannel.get(ch)?.delete(id);
  }

  /** Closes a connection with a code and forgets it. */
  close(id: string, code: number, reason: string): void {
    const c = this.conns.get(id);
    if (!c) return;
    this.disconnect(id);
    try { c.socket.close(code, reason); } catch { /* socket already gone */ }
  }

  /**
   * Marks a connection as belonging to a user. Called again with a fresh token to extend the session; the user must
   * be the same, so one socket can never change identity. `me` is always subscribed.
   */
  authenticate(id: string, userId: string, expiresAtMs: number | null, channels?: readonly Channel[]): AuthResult {
    const c = this.conns.get(id);
    if (!c) return { ok: false, close: CLOSE.UNAUTHORIZED, reason: 'gone' };
    if (c.userId && c.userId !== userId) return { ok: false, close: CLOSE.FORBIDDEN, reason: 'identity_changed' };
    if (!c.userId) {
      const existing = this.byUser.get(userId)?.size ?? 0;
      if (existing >= this.o.maxPerUser) return { ok: false, close: CLOSE.TOO_MANY_CONNECTIONS, reason: 'too_many_connections' };
      c.userId = userId;
      this.indexUser(userId, id);
      this.addChannels(c, ['me']);
    }
    c.expiresAtMs = expiresAtMs;
    if (channels?.length) this.addChannels(c, channels);
    return { ok: true, channels: [...c.channels] };
  }

  subscribe(id: string, channels: readonly Channel[]): Channel[] | null {
    const c = this.conns.get(id);
    if (!c?.userId) return null;
    this.addChannels(c, channels.filter((ch) => (PUBLIC_CHANNELS as readonly string[]).includes(ch)));
    return [...c.channels];
  }

  unsubscribe(id: string, channels: readonly Channel[]): Channel[] | null {
    const c = this.conns.get(id);
    if (!c?.userId) return null;
    for (const ch of channels) {
      if (ch === 'me') continue; // private events always flow
      c.channels.delete(ch);
      this.byChannel.get(ch)?.delete(id);
    }
    return [...c.channels];
  }

  /** Counts a client message against the connection's rate limit. False means over the limit. */
  allowMessage(id: string): boolean {
    const c = this.conns.get(id);
    if (!c) return false;
    const now = this.o.now();
    c.recent = c.recent.filter((t) => now - t < this.o.rateLimit.windowMs);
    if (c.recent.length >= this.o.rateLimit.count) return false;
    c.recent.push(now);
    return true;
  }

  send(id: string, msg: ServerMessage): void {
    const c = this.conns.get(id);
    if (!c) return;
    try { c.socket.send(msg); } catch { this.close(id, CLOSE.SLOW_CONSUMER, 'send_failed'); }
  }

  /** Starts holding live events for this connection while the gateway reads missed ones from the stream. */
  beginReplay(id: string, lastEventId: string): void {
    const c = this.conns.get(id);
    if (!c) return;
    c.cursor = lastEventId;
    c.replaying = true;
    c.pending = [];
    c.pendingOverflow = false;
  }

  /**
   * Ends a replay. With `missed` the client gets those events (oldest first), then any live events that arrived meanwhile.
   * With a resync reason the client is told to refetch, and live events continue from now.
   */
  completeReplay(id: string, outcome: { missed: StreamEvent[] } | { resync: 'too_old' | 'too_many' | 'server_restart' | 'slow' }): void {
    const c = this.conns.get(id);
    if (!c) return;
    c.replaying = false;
    const pending = c.pending; const overflow = c.pendingOverflow;
    c.pending = []; c.pendingOverflow = false;
    if ('resync' in outcome) {
      c.cursor = '0-0';
      this.send(id, { type: 'resync', reason: outcome.resync });
    } else {
      for (const e of outcome.missed) this.deliver(c, e);
    }
    if (overflow) { this.send(id, { type: 'resync', reason: 'too_many' }); c.cursor = '0-0'; return; }
    for (const e of pending) this.deliver(c, e);
  }

  /** Routes one stream event to every connection that may see it. */
  dispatch(e: StreamEvent): void {
    if (e.scope === 'user') {
      for (const id of [...(e.userId ? this.byUser.get(e.userId) ?? [] : [])]) this.route(id, e);
    } else {
      for (const id of [...(this.byChannel.get(e.channel) ?? [])]) this.route(id, e);
    }
  }

  /** Closes connections that never authenticated in time or whose token expired. Call about once a second. */
  sweep(): void {
    const now = this.o.now();
    for (const c of [...this.conns.values()]) {
      if (!c.userId && now - c.connectedAt > this.o.authTimeoutMs) this.close(c.id, CLOSE.AUTH_TIMEOUT, 'auth_timeout');
      else if (c.expiresAtMs !== null && now >= c.expiresAtMs) this.close(c.id, CLOSE.TOKEN_EXPIRED, 'token_expired');
    }
  }

  closeAll(code: number, reason: string): void {
    for (const id of [...this.conns.keys()]) this.close(id, code, reason);
  }

  private route(id: string, e: StreamEvent): void {
    const c = this.conns.get(id);
    if (!c?.userId) return;
    if (c.replaying) {
      if (c.pending.length >= this.o.maxPending) c.pendingOverflow = true;
      else c.pending.push(e);
      return;
    }
    this.deliver(c, e);
  }

  private deliver(c: Conn, e: StreamEvent): void {
    if (!this.conns.has(c.id) || !c.userId) return;
    // A user event is only ever delivered to its owner, a global one only to subscribers of its channel. Checked again here
    // because replayed events come from a shared range read, not from the routing indexes.
    if (e.scope === 'user' ? e.userId !== c.userId : !c.channels.has(e.channel)) return;
    if (compareIds(e.id, c.cursor) <= 0) return;
    if (c.socket.bufferedBytes() > this.o.maxBufferedBytes) { this.close(c.id, CLOSE.SLOW_CONSUMER, 'slow_consumer'); return; }
    c.cursor = e.id;
    this.send(c.id, { type: 'event', id: e.id, channel: e.channel, event: { type: e.type, at: e.at, data: e.data } });
  }

  private addChannels(c: Conn, channels: readonly Channel[]): void {
    for (const ch of channels) {
      c.channels.add(ch);
      let set = this.byChannel.get(ch);
      if (!set) this.byChannel.set(ch, (set = new Set()));
      set.add(c.id);
    }
  }

  private indexUser(userId: string, id: string): void {
    let set = this.byUser.get(userId);
    if (!set) this.byUser.set(userId, (set = new Set()));
    set.add(id);
  }

  private unindexUser(userId: string, id: string): void {
    const set = this.byUser.get(userId);
    set?.delete(id);
    if (set && set.size === 0) this.byUser.delete(userId);
  }
}
