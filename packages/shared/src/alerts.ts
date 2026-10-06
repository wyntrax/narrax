import { z } from 'zod';
import { AlertPriority } from './enums';
import { sanitizeUntrusted } from './untrusted';

/** Higher is more urgent. */
export const ALERT_PRIORITY_RANK: Record<AlertPriority, number> = { INFO: 0, WATCH: 1, IMPORTANT: 2, CRITICAL: 3 };

/**
 * Starting value, not validated. INFO alerts (for example every new token candidate) are frequent, so a user who has
 * never opened settings starts from WATCH and above. Anyone can lower it to INFO.
 */
export const DEFAULT_MIN_ALERT_PRIORITY: AlertPriority = 'WATCH';
export const MAX_MUTED_KINDS = 50;
export const MAX_INTERESTS = 20;

export interface NotificationPrefs {
  minPriority: AlertPriority;
  mutedKinds: string[];
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { minPriority: DEFAULT_MIN_ALERT_PRIORITY, mutedKinds: [] };

/**
 * Whether a GLOBAL alert (one with no owner, such as a narrative stage change) becomes a notification for a user.
 * Preferences only ever apply to global alerts. Alerts that belong to one user (position signals, confirmations)
 * are always delivered, because muting a stop-loss warning or a pending confirmation is not a preference worth honouring.
 * CRITICAL is never muted by kind either.
 */
export function shouldDeliverGlobalAlert(prefs: NotificationPrefs, alert: { kind: string; priority: AlertPriority }): boolean {
  if (alert.priority === 'CRITICAL') return true;
  if (ALERT_PRIORITY_RANK[alert.priority] < ALERT_PRIORITY_RANK[prefs.minPriority]) return false;
  return !prefs.mutedKinds.includes(alert.kind);
}

const KIND = /^[A-Z][A-Z0-9_]{1,63}$/;

export const NotificationPrefsBody = z.object({
  minPriority: AlertPriority,
  mutedKinds: z.array(z.string().regex(KIND)).max(MAX_MUTED_KINDS).transform((k) => [...new Set(k)]),
}).strict();

function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Display name is shown back to the user and in the UI, so it is sanitized like any other free text. */
export const ProfileBody = z.object({
  displayName: z.string().max(80).transform((s) => sanitizeUntrusted(s, 40)).nullable().optional(),
  timezone: z.string().max(64).refine(validTimeZone, 'unknown time zone').nullable().optional(),
}).strict().refine((b) => b.displayName !== undefined || b.timezone !== undefined, 'nothing to change');

export const AppearanceBody = z.object({
  theme: z.enum(['DARK', 'LIGHT', 'SYSTEM']).optional(),
  density: z.enum(['COMFORTABLE', 'COMPACT']).optional(),
  reducedMotion: z.boolean().optional(),
}).strict().refine((b) => Object.keys(b).length > 0, 'nothing to change');

/** Interests are free text for now (there is no narrative taxonomy yet), so they are sanitized, lower-cased and de-duplicated. */
export const InterestsBody = z.object({
  interests: z.array(z.string().max(80)).max(MAX_INTERESTS * 2).transform((items) => {
    const out: string[] = [];
    for (const raw of items) {
      const v = sanitizeUntrusted(raw, 40).toLowerCase();
      if (v && !out.includes(v)) out.push(v);
    }
    return out;
  }).refine((a) => a.length <= MAX_INTERESTS, `at most ${MAX_INTERESTS} interests`),
}).strict();
