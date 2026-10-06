import type { Prisma, PrismaClient } from '@narra/database';
import { SYSTEM_LIMITS_KEY, resolveSystemLimits, type RiskLimits } from '@narra/risk';

/** SystemSetting key for the admin's global stop on new entries. */
export const TRADING_PAUSE_KEY = 'system.trading_paused';

export interface TradingPause { paused: boolean; reason: string | null; at: string | null; by: string | null }

export interface SystemControls {
  /** The system ceiling to enforce. The code defaults with each valid admin override on top, never looser. */
  limits: RiskLimits;
  overrides: Partial<RiskLimits>;
  /** Stored fields that were ignored because they were malformed or looser than the code. */
  invalid: string[];
  pause: TradingPause;
}

export const parsePause = (v: unknown): TradingPause => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { paused: o.paused === true, reason: typeof o.reason === 'string' ? o.reason : null, at: typeof o.at === 'string' ? o.at : null, by: typeof o.by === 'string' ? o.by : null };
};

/** One read of both settings. Called per job and per fan-out run, so a change takes effect on the next job. */
export async function loadSystemControls(db: PrismaClient): Promise<SystemControls> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: [SYSTEM_LIMITS_KEY, TRADING_PAUSE_KEY] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return { ...resolveSystemLimits(get(SYSTEM_LIMITS_KEY)), pause: parsePause(get(TRADING_PAUSE_KEY)) };
}

export const toJson = (v: unknown) => v as Prisma.InputJsonValue;
