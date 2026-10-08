import type { ServerMessage } from '@narra/realtime';
import type { FeatureKey } from '@narra/shared';
const FEATURES: Record<string, FeatureKey> = { 'narrative.updated': 'research.narratives', 'opportunity.created': 'research.opportunities', 'decision.created': 'research.opportunities', 'consensus.updated': 'research.smart_money', 'market.sol': 'research.tokens' };
/** Bounded serial research lane; private/control traffic bypasses it. No cached grants. */
export function researchEgress(send: (m: ServerMessage) => void, allowed: (f: FeatureKey) => Promise<boolean>, maxPending = 128) {
  let pending = 0, closed = false, tail = Promise.resolve();
  return {
    send(m: ServerMessage) {
      if (closed) return;
      if (m.type !== 'event' || m.channel === 'me' || m.event.type === 'alert.created') { send(m); return; }
      const feature = FEATURES[m.event.type]; if (!feature) return;
      if (pending >= maxPending) { send({ type: 'resync', reason: 'slow' }); return; }
      pending++;
      tail = tail.then(async () => { if (!closed && await allowed(feature) && !closed) send(m); }).catch(() => {}).finally(() => { pending--; });
    },
    close() { closed = true; },
    drained: () => tail,
  };
}
