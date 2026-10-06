import { describe, expect, it } from 'vitest';
import { RealtimeHub, type HubSocket } from './hub';
import { CLOSE, type ServerMessage } from './protocol';
import type { StreamEvent } from './events';

class FakeSocket implements HubSocket {
  sent: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  buffered = 0;
  send(m: ServerMessage) { this.sent.push(m); }
  close(code: number, reason: string) { this.closed = { code, reason }; }
  bufferedBytes() { return this.buffered; }
  events() { return this.sent.filter((m): m is Extract<ServerMessage, { type: 'event' }> => m.type === 'event'); }
}

let seq = 0;
const global = (channel: 'narratives' | 'alerts' | 'market', id = `${1000 + ++seq}-0`): StreamEvent => ({ id, type: 'market.sol', channel, scope: 'global', userId: null, at: new Date().toISOString(), data: { n: seq } });
const mine = (userId: string, id = `${1000 + ++seq}-0`): StreamEvent => ({ id, type: 'notification.created', channel: 'me', scope: 'user', userId, at: new Date().toISOString(), data: { n: seq } });

function client(hub: RealtimeHub, user: string | null, channels?: ('narratives' | 'alerts' | 'market')[]) {
  const socket = new FakeSocket();
  const id = hub.connect(socket)!;
  if (user) expect(hub.authenticate(id, user, null, channels).ok).toBe(true);
  return { id, socket };
}

describe('RealtimeHub routing', () => {
  it('sends a global event only to subscribers of its channel, and nothing to unauthenticated sockets', () => {
    const hub = new RealtimeHub();
    const sub = client(hub, 'u1', ['narratives']);
    const other = client(hub, 'u2', ['alerts']);
    const anon = client(hub, null);
    hub.dispatch(global('narratives'));
    expect(sub.socket.events()).toHaveLength(1);
    expect(other.socket.events()).toHaveLength(0);
    expect(anon.socket.events()).toHaveLength(0);
  });

  it('delivers a user event only to that user, on every one of their sockets, never to another user', () => {
    const hub = new RealtimeHub();
    const a1 = client(hub, 'alice'); const a2 = client(hub, 'alice'); const bob = client(hub, 'bob');
    hub.dispatch(mine('alice'));
    expect(a1.socket.events()).toHaveLength(1);
    expect(a2.socket.events()).toHaveLength(1);
    expect(bob.socket.events()).toHaveLength(0);
  });

  it('keeps `me` subscribed even when the client unsubscribes from it, and honours subscribe and unsubscribe for public channels', () => {
    const hub = new RealtimeHub();
    const c = client(hub, 'alice');
    hub.dispatch(global('market'));
    expect(c.socket.events()).toHaveLength(0);
    hub.subscribe(c.id, ['market']);
    hub.dispatch(global('market'));
    expect(c.socket.events()).toHaveLength(1);
    hub.unsubscribe(c.id, ['market', 'me']);
    hub.dispatch(global('market'));
    hub.dispatch(mine('alice'));
    expect(c.socket.events()).toHaveLength(2); // the first market event and the user event
  });

  it('does not deliver an event twice when the same id arrives again', () => {
    const hub = new RealtimeHub();
    const c = client(hub, 'alice', ['market']);
    const e = global('market', '5000-0');
    hub.dispatch(e); hub.dispatch(e);
    expect(c.socket.events()).toHaveLength(1);
  });
});

describe('limits and expiry', () => {
  it('refuses a sixth socket for one user and a connection beyond the total cap', () => {
    const hub = new RealtimeHub({ maxPerUser: 2, maxTotal: 3 });
    client(hub, 'u'); client(hub, 'u');
    const third = new FakeSocket(); const id = hub.connect(third)!;
    expect(hub.authenticate(id, 'u', null)).toMatchObject({ ok: false, close: CLOSE.TOO_MANY_CONNECTIONS });
    expect(hub.connect(new FakeSocket())).toBeNull();
  });

  it('does not let a socket change identity when it re-authenticates', () => {
    const hub = new RealtimeHub();
    const c = client(hub, 'alice');
    expect(hub.authenticate(c.id, 'bob', null)).toMatchObject({ ok: false, close: CLOSE.FORBIDDEN });
    expect(hub.authenticate(c.id, 'alice', Date.now() + 1000).ok).toBe(true);
  });

  it('closes sockets that never authenticate and sockets whose token has expired, and a refreshed token keeps the socket', () => {
    let now = 1_000_000;
    const hub = new RealtimeHub({ now: () => now, authTimeoutMs: 5000 });
    const anon = client(hub, null);
    const expiring = client(hub, 'a'); hub.authenticate(expiring.id, 'a', now + 10_000);
    const refreshed = client(hub, 'b'); hub.authenticate(refreshed.id, 'b', now + 10_000);
    now += 6000; hub.sweep();
    expect(anon.socket.closed?.code).toBe(CLOSE.AUTH_TIMEOUT);
    expect(expiring.socket.closed).toBeNull();
    hub.authenticate(refreshed.id, 'b', now + 60_000);
    now += 5000; hub.sweep();
    expect(expiring.socket.closed?.code).toBe(CLOSE.TOKEN_EXPIRED);
    expect(refreshed.socket.closed).toBeNull();
  });

  it('closes a slow consumer instead of queueing without bound', () => {
    const hub = new RealtimeHub({ maxBufferedBytes: 100 });
    const c = client(hub, 'alice', ['market']);
    c.socket.buffered = 500;
    hub.dispatch(global('market'));
    expect(c.socket.closed?.code).toBe(CLOSE.SLOW_CONSUMER);
    expect(c.socket.events()).toHaveLength(0);
  });

  it('rate limits client messages per window', () => {
    let now = 0;
    const hub = new RealtimeHub({ now: () => now, rateLimit: { count: 3, windowMs: 1000 } });
    const c = client(hub, 'alice');
    expect([1, 2, 3, 4].map(() => hub.allowMessage(c.id))).toEqual([true, true, true, false]);
    now += 1500;
    expect(hub.allowMessage(c.id)).toBe(true);
  });

  it('forgets a socket on disconnect, so later events are not sent to it', () => {
    const hub = new RealtimeHub();
    const c = client(hub, 'alice', ['market']);
    hub.disconnect(c.id);
    hub.dispatch(global('market')); hub.dispatch(mine('alice'));
    expect(c.socket.events()).toHaveLength(0);
    expect(hub.stats()).toEqual({ connections: 0, authenticated: 0, users: 0 });
  });
});

describe('replay on reconnect', () => {
  it('sends missed events first, then live events that arrived during the replay, in order and without duplicates', () => {
    const hub = new RealtimeHub();
    const c = client(hub, 'alice', ['market']);
    hub.beginReplay(c.id, '100-0');
    const live1 = global('market', '103-0');            // arrives while the range read is running
    hub.dispatch(live1);
    expect(c.socket.events()).toHaveLength(0);           // held back
    const missed = [global('market', '101-0'), global('market', '102-0'), global('market', '103-0')]; // the range read also saw 103
    hub.completeReplay(c.id, { missed });
    expect(c.socket.events().map((e) => e.id)).toEqual(['101-0', '102-0', '103-0']);
  });

  it('never replays another user\'s private event to a reconnecting client', () => {
    const hub = new RealtimeHub();
    const c = client(hub, 'alice', ['market']);
    hub.beginReplay(c.id, '100-0');
    hub.completeReplay(c.id, { missed: [mine('bob', '101-0'), mine('alice', '102-0'), global('alerts', '103-0')] });
    expect(c.socket.events().map((e) => e.id)).toEqual(['102-0']); // not bob's, not a channel alice never joined
  });

  it('tells the client to refetch when the gap cannot be replayed, and keeps live events flowing', () => {
    const hub = new RealtimeHub();
    const c = client(hub, 'alice', ['market']);
    hub.beginReplay(c.id, '1-0');
    hub.completeReplay(c.id, { resync: 'too_old' });
    expect(c.socket.sent).toContainEqual({ type: 'resync', reason: 'too_old' });
    hub.dispatch(global('market', '9000-0'));
    expect(c.socket.events()).toHaveLength(1);
  });

  it('asks for a resync when too many live events pile up during a replay', () => {
    const hub = new RealtimeHub({ maxPending: 2 });
    const c = client(hub, 'alice', ['market']);
    hub.beginReplay(c.id, '100-0');
    for (let i = 1; i <= 5; i++) hub.dispatch(global('market', `${200 + i}-0`));
    hub.completeReplay(c.id, { missed: [] });
    expect(c.socket.sent.some((m) => m.type === 'resync')).toBe(true);
  });
});
