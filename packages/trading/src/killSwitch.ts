import { z } from 'zod';

/** SystemSetting key. An admin sets it through the API. The executor reads it before every order. */
export const KILL_SWITCH_KEY = 'executor.kill_switch';

export const KillSwitchValue = z.object({
  enabled: z.boolean(),
  reason: z.string().max(200).nullable().optional(),
  /** The admin user id who set it. */
  by: z.string().max(64).nullable().optional(),
  at: z.string().datetime().optional(),
}).strict();
export type KillSwitchValue = z.infer<typeof KillSwitchValue>;

export interface KillSwitchState {
  tripped: boolean;
  reason: string | null;
  /** True when the stored value could not be read. An unreadable switch counts as tripped. */
  malformed: boolean;
}

/**
 * Turns the stored value into a decision. No row means the switch was never touched, so it is not tripped.
 * A row that does not parse is treated as TRIPPED: a safety flag that cannot be read must stop trading, not allow it.
 * (Before real signing is allowed, B5b should invert the missing-row case so the executor needs an explicit "armed" flag.)
 */
export function interpretKillSwitch(raw: unknown): KillSwitchState {
  if (raw === null || raw === undefined) return { tripped: false, reason: null, malformed: false };
  const p = KillSwitchValue.safeParse(raw);
  if (!p.success) return { tripped: true, reason: 'The kill switch value is unreadable.', malformed: true };
  return { tripped: p.data.enabled, reason: p.data.reason ?? null, malformed: false };
}
