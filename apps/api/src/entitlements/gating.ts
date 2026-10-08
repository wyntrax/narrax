import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@narra/database';
import type { FeatureKey } from '@narra/shared';
import { requireFeature } from './access';

/** Only wholly shared surfaces. Mixed routes perform ownership/field checks in their handlers. */
export const GATED_ROUTES: Record<string, FeatureKey> = {
  'GET /v1/narratives': 'research.narratives', 'GET /v1/narratives/:slug': 'research.narratives',
  'GET /v1/narratives/rotation': 'research.rotation', 'GET /v1/tokens/:mint': 'research.tokens',
  'GET /v1/intelligence-bar': 'research.overview', 'GET /v1/smart-money/wallets': 'research.smart_money',
  'GET /v1/analytics/decisions/summary': 'research.decision_analytics', 'GET /v1/analytics/decisions/outcomes': 'research.decision_analytics',
  'GET /v1/analytics/signals': 'research.advanced_analytics', 'GET /v1/analytics/backtest-summary': 'research.advanced_analytics',
  'POST /v1/chat': 'research.chat',
};
export function registerFeatureGates(app: FastifyInstance, db: PrismaClient, now?: () => Date) {
  app.addHook('onRoute', route => {
    const method = Array.isArray(route.method) ? route.method[0] : route.method;
    const feature = GATED_ROUTES[`${method === 'HEAD' ? 'GET' : method} ${route.url}`];
    if (!feature) return;
    const previous = route.preHandler ? Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler] : [];
    route.preHandler = [...previous, requireFeature(db, feature, now)];
  });
}
