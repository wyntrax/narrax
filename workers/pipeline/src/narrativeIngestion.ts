import type { Prisma, PrismaClient } from '@narra/database';
import {
  computeNarrativeMetrics, extractTokenRefs, normalizeHandle, normalizeText, normalizeTopic, sha256, simhash64,
  type MentionPoint, type NarrativeProvider, type RawMention,
} from '@narra/narrative';
import type { NarrativeStage } from '@narra/shared';
import {bulkCreatorRoles} from './bulkPublication';

export interface IngestOptions {
  /** How far back to ask providers for activity. */
  lookbackHours?: number;
  /** Hard cap per topic per run, so one noisy topic cannot flood the database. */
  maxMentionsPerTopic?: number;
  onProviderError?: (provider: string, error: unknown) => void;
}

export interface IngestSummary {
  topicsSeen: number;
  narrativesUpdated: number;
  mentionsStored: number;
  stageChanges: number;
  providerErrors: number;
}

const ALERT_FOR: Partial<Record<NarrativeStage, { kind: string; priority: 'INFO' | 'WATCH' | 'IMPORTANT' | 'CRITICAL'; verb: string }>> = {
  EMERGING: { kind: 'NARRATIVE_EMERGING', priority: 'INFO', verb: 'is emerging' },
  ACCELERATING: { kind: 'NARRATIVE_ACCELERATING', priority: 'IMPORTANT', verb: 'is accelerating' },
  SATURATED: { kind: 'NARRATIVE_SATURATED', priority: 'WATCH', verb: 'looks saturated' },
  DECAYING: { kind: 'NARRATIVE_DECAY', priority: 'WATCH', verb: 'is losing momentum' },
};

/** Keeps only what the schema stores. The raw text is hashed here and dropped; only extracted token references (mint or $TICKER) survive. */
function toRow(m: RawMention) {
  const norm = normalizeText(m.text);
  return {
    externalId: m.externalId.slice(0, 128), platform: m.platform.slice(0, 32), handle: normalizeHandle(m.creatorHandle),
    creatorAgeDays: m.creatorAgeDays != null && Number.isFinite(m.creatorAgeDays) ? Math.max(0, Math.round(m.creatorAgeDays)) : null,
    textHash: sha256(norm), simhash: simhash64(norm), refs: extractTokenRefs(m.text), engagement: Math.max(0, Math.round(Number.isFinite(m.engagement) ? m.engagement : 0)), at: m.at,
  };
}

/**
 * Pulls activity from every provider, stores mention hashes and creators, then recomputes each touched narrative's
 * velocity, organic score, lifecycle stage and score from the stored mentions. Provider failures are counted and
 * skipped. They never stop other providers.
 */
export async function ingestNarratives(db: PrismaClient, providers: NarrativeProvider[], now: Date = new Date(), opts: IngestOptions = {}): Promise<IngestSummary> {
  const lookback = opts.lookbackHours ?? 48;
  const cap = opts.maxMentionsPerTopic ?? 2000;
  const since = new Date(now.getTime() - lookback * 3_600_000);
  const summary: IngestSummary = { topicsSeen: 0, narrativesUpdated: 0, mentionsStored: 0, stageChanges: 0, providerErrors: 0 };
  const touched = new Map<string, string>(); // slug -> narrative id

  for (const provider of providers) {
    let topics;
    try { topics = await provider.getTrendingTopics(); } catch (error) { summary.providerErrors++; opts.onProviderError?.(provider.name, error); continue; }
    for (const topic of topics) {
      const norm = normalizeTopic(topic.name);
      if (!norm) continue;
      summary.topicsSeen++;
      let raw: RawMention[];
      try { raw = await provider.getTopicActivity(topic, since); } catch (error) { summary.providerErrors++; opts.onProviderError?.(provider.name, error); continue; }

      const rows = raw.filter((m) => m.at >= since && m.at <= now).slice(0, cap).map(toRow).filter((r) => r.handle && r.externalId);
      // A configured search with no observations is not evidence that a new narrative exists.
      // Existing narratives still age/decay when a successful fetch returns no recent activity.
      const narrative = rows.length
        ? await db.narrative.upsert({ where: { slug: norm.slug }, create: { name: norm.name, slug: norm.slug, firstDetectedAt: now }, update: {}, select: { id: true } })
        : await db.narrative.findUnique({ where: { slug: norm.slug }, select: { id: true } });
      if (!narrative) continue;
      touched.set(norm.slug, narrative.id);
      await db.narrativeSource.upsert({
        where: { narrativeId_provider: { narrativeId: narrative.id, provider: provider.name } },
        create: { narrativeId: narrative.id, provider: provider.name, externalRef: topic.externalId.slice(0, 128) }, update: {},
      });

      if (!rows.length) continue;

      const handles = [...new Set(rows.map((r) => `${r.platform}\u0000${r.handle}`))].map((k) => { const [platform, handle] = k.split('\u0000') as [string, string]; return { platform, handle }; });
      await db.creator.createMany({ data: handles, skipDuplicates: true });
      const creators = await db.creator.findMany({ where: { OR: handles.map((h) => ({ platform: h.platform, handle: h.handle })) }, select: { id: true, platform: true, handle: true } });
      const creatorId = new Map(creators.map((c) => [`${c.platform}\u0000${c.handle}`, c.id]));

      const res = await db.narrativeMention.createMany({
        data: rows.map((r) => ({ narrativeId: narrative.id, platform: r.platform, externalId: r.externalId, creatorId: creatorId.get(`${r.platform}\u0000${r.handle}`) ?? null, textHash: r.textHash, simhash: r.simhash, creatorAgeDays: r.creatorAgeDays, engagement: r.engagement, at: r.at })),
        skipDuplicates: true, // the same post fetched again is ignored
      });
      summary.mentionsStored += res.count;
      // Token references found in the same posts (mint addresses, $TICKERS). Stored without the text, so the social-token scan can count them.
      const refRows = rows.flatMap((r) => r.refs.map((ref) => ({ refKind: ref.kind, ref: ref.value, platform: r.platform, externalId: r.externalId, creatorId: creatorId.get(`${r.platform}\u0000${r.handle}`) ?? null, textHash: r.textHash, simhash: r.simhash, creatorAgeDays: r.creatorAgeDays, engagement: r.engagement, at: r.at })));
      if (refRows.length) await db.tokenMention.createMany({ data: refRows, skipDuplicates: true });
    }
  }

  for (const [slug, id] of touched) {
    const stored = await db.narrativeMention.findMany({ where: { narrativeId: id, at: { gte: since, lte: now } }, select: { externalId: true, platform: true, creatorId: true, creatorAgeDays: true, engagement: true, at: true, simhash: true, textHash: true }, orderBy: { at: 'desc' }, take: 20_000 });
    const points: MentionPoint[] = stored.map((m) => ({ externalId: m.externalId, platform: m.platform, creator: m.creatorId ?? m.externalId, creatorAgeDays: m.creatorAgeDays, engagement: m.engagement, at: m.at, simhash: m.simhash, textHash: m.textHash }));
    const prev = await db.narrative.findUniqueOrThrow({ where: { id }, select: { stage: true, name: true, firstDetectedAt: true } });
    const isNew = (await db.narrativeMetric.count({ where: { narrativeId: id } })) === 0;
    const c = computeNarrativeMetrics(points, now, isNew ? undefined : prev.stage);
    const knownCreators = new Set(stored.map((m) => m.creatorId).filter((x): x is string => !!x));

    const ops: Prisma.PrismaPromise<unknown>[] = [
      db.narrative.update({ where: { id }, data: { stage: c.stage, score: c.score, velocity: c.mentionVelocity, acceleration: c.acceleration, organicScore: c.organicScore, saturationRisk: c.saturationRisk } }),
      db.narrativeMetric.create({ data: { narrativeId: id, score: c.score, velocity: c.mentionVelocity, acceleration: c.acceleration, organicScore: c.organicScore, manipulationRisk: c.manipulationRisk, mentionVelocity: c.mentionVelocity, creatorVelocity: c.creatorVelocity, engagementVelocity: c.engagementVelocity, at: now } }),
      ...bulkCreatorRoles(db,[...c.roles].filter(([creator]) => knownCreators.has(creator)).map(([creator,role])=>({narrativeId:id,creatorId:creator,role}))),
    ];
    const changed = c.stage !== prev.stage;
    const alert = changed ? ALERT_FOR[c.stage] : undefined;
    if (alert) {
      ops.push(db.alert.create({ data: { kind: alert.kind, priority: alert.priority, title: `${prev.name} ${alert.verb}`, body: `Score ${c.score}, velocity ${c.mentionVelocity}%, organic ${c.organicScore}${c.organicKnown ? '' : ' (not enough data)'}.`, refType: 'NARRATIVE', refId: id, createdAt: now } }));
    }
    await db.$transaction(ops);
    summary.narrativesUpdated++;
    if (changed) summary.stageChanges++;
    void slug;
  }
  return summary;
}
