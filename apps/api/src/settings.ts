import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import { AppearanceBody, DEFAULT_NOTIFICATION_PREFS, InterestsBody, NotificationPrefsBody, ProfileBody } from '@narra/shared';
import { makeAuthenticate, type AccountDeps } from './account';

const DAY = 86_400_000;

/**
 * User settings. Trading limits and mode stay on their own routes (/v1/risk-profile, /v1/mode), where each change has its
 * own checks. Nothing here can change what the agent may do. Every change is written to the audit log.
 */
export function registerSettingsRoutes(app: FastifyInstance, deps: Pick<AccountDeps, 'db' | 'verifier' | 'now'>): void {
  const db: PrismaClient = deps.db;
  const now = deps.now ?? (() => new Date());
  const opts = { preHandler: makeAuthenticate(deps), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const bad = (issues?: z.ZodIssue[]) => ({ error: 'INVALID_INPUT', ...(issues ? { fields: [...new Set(issues.map((i) => i.path.join('.')).filter(Boolean))] } : {}) });
  const audit = (userId: string, action: string, detail: Prisma.InputJsonValue) => db.auditLog.create({ data: { userId, action, detail } });

  async function view(userId: string) {
    const [user, since] = [await db.user.findUniqueOrThrow({ where: { id: userId }, select: { interests: true, settings: true } }), new Date(now().getTime() - 30 * DAY)];
    const s = user.settings;
    // The kinds a user can mute are the kinds that exist as global alerts, so the list never goes stale as new alert types are added.
    const kinds = await db.alert.findMany({ where: { userId: null, createdAt: { gte: since } }, distinct: ['kind'], select: { kind: true }, orderBy: { kind: 'asc' }, take: 100 });
    return {
      profile: { displayName: s?.displayName ?? null, timezone: s?.timezone ?? null },
      appearance: { theme: s?.theme ?? 'DARK', density: s?.density ?? 'COMFORTABLE', reducedMotion: s?.reducedMotion ?? false },
      notifications: {
        minPriority: s?.minAlertPriority ?? DEFAULT_NOTIFICATION_PREFS.minPriority, mutedKinds: s?.mutedAlertKinds ?? DEFAULT_NOTIFICATION_PREFS.mutedKinds,
        // Alerts about your own positions and confirmations, and every CRITICAL alert, are always delivered.
        mutableKinds: kinds.map((k) => k.kind), alwaysDelivered: ['CRITICAL', 'POSITION_SIGNAL', 'CONFIRMATION_REQUIRED'],
      },
      interests: user.interests,
    };
  }

  app.get('/v1/settings', opts, async (req) => view(req.userId!));

  app.put('/v1/settings/profile', opts, async (req, reply) => {
    const b = ProfileBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send(bad(b.error.issues));
    const userId = req.userId!;
    const data = { ...(b.data.displayName !== undefined ? { displayName: b.data.displayName } : {}), ...(b.data.timezone !== undefined ? { timezone: b.data.timezone } : {}) };
    await db.$transaction([db.userSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data }), audit(userId, 'settings.profile.changed', { fields: Object.keys(data) })]);
    return (await view(userId)).profile;
  });

  app.put('/v1/settings/appearance', opts, async (req, reply) => {
    const b = AppearanceBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send(bad(b.error.issues));
    const userId = req.userId!;
    await db.$transaction([db.userSettings.upsert({ where: { userId }, create: { userId, ...b.data }, update: b.data }), audit(userId, 'settings.appearance.changed', b.data)]);
    return (await view(userId)).appearance;
  });

  app.put('/v1/settings/notifications', opts, async (req, reply) => {
    const b = NotificationPrefsBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send(bad(b.error.issues));
    const userId = req.userId!;
    const data = { minAlertPriority: b.data.minPriority, mutedAlertKinds: b.data.mutedKinds };
    await db.$transaction([db.userSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data }), audit(userId, 'settings.notifications.changed', { minPriority: b.data.minPriority, mutedKinds: b.data.mutedKinds })]);
    const v = await view(userId);
    return v.notifications;
  });

  // Narrative interests collected at onboarding. They are preferences for what to show first, never an instruction to the agent.
  app.put('/v1/settings/interests', opts, async (req, reply) => {
    const b = InterestsBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send(bad(b.error.issues));
    const userId = req.userId!;
    await db.$transaction([db.user.update({ where: { id: userId }, data: { interests: b.data.interests } }), audit(userId, 'settings.interests.changed', { count: b.data.interests.length })]);
    return { interests: b.data.interests };
  });
}
