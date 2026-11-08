import type { AgentPorts } from '@narra/agent';
import type { PrismaClient } from '@narra/database';
import { canReadFeature, entitlementTrace, featureDecision } from './access';

/** Closure binds the authenticated user; model/tool input cannot select identity or feature. */
export function researchPorts(ports: AgentPorts, db: PrismaClient, userId: string, now: () => Date, log?: (entry: object) => void): AgentPorts {
  return { ...ports,
    async listOpportunities(limit) {
      const d = await featureDecision(db, userId, 'research.opportunities', now(), log);
      return d.allowed ? ports.listOpportunities(Math.min(limit, d.pageLimit)) : [];
    },
    async getToken(mint) {
      if (!await canReadFeature(db, userId, 'research.tokens', now(), log)) return null;
      const token = await ports.getToken(mint); if (!token) return null;
      return { ...token, opportunity: await canReadFeature(db, userId, 'research.opportunities', now(), log) ? token.opportunity : null,
        consensus: await canReadFeature(db, userId, 'research.smart_money', now(), log) ? token.consensus : null };
    },
    async recentDecisions(mint, limit) {
      const d = await featureDecision(db, userId, 'research.decision_analytics', now(), log);
      return d.allowed ? ports.recentDecisions(mint, Math.min(limit, d.pageLimit)) : [];
    },
    async accessSummary() {
      const trace = await entitlementTrace(db, userId, now());
      return {
        effectiveTier: trace.effectiveTier,
        admin: trace.admin,
        features: Object.fromEntries(Object.entries(trace.features).map(([feature, value]) => [feature, { allowed: value.allowed, requiredTier: value.requiredTier }])),
      };
    },
    async featureAccess(_userId, feature) {
      const decision = await featureDecision(db, userId, feature, now(), log);
      return { feature, ...decision };
    },
    async backtestSummary() { return await canReadFeature(db, userId, 'research.advanced_analytics', now(), log) ? ports.backtestSummary() : null; },
  };
}
