import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import {
  CONSENSUS_HEARTBEAT_MS,
  CONSENSUS_PRUNE_BATCH,
  CONSENSUS_RETENTION_MS,
  filterConsensusWrites,
  pruneExpiredConsensusSignals,
} from './walletIntelligence';

describe('consensus signal bounded growth', () => {
  const now = new Date('2032-02-01T12:00:00Z');
  const candidate = (tokenId: string, patch: Record<string, unknown> = {}) => ({
    tokenId,
    score: 72,
    walletCount: 4,
    independentEntities: 3,
    leaderCount: 1,
    netFlowSol: 6.5,
    timingConcentration: 0.4,
    at: now,
    ...patch,
  });

  it('skips unchanged consensus writes within heartbeat window and keeps changes or expired heartbeats', async () => {
    const existing = [
      candidate('same-fresh', { at: new Date(+now - 5 * 60_000) }),
      candidate('heartbeat-due', { at: new Date(+now - CONSENSUS_HEARTBEAT_MS) }),
      candidate('score-changed', { score: 65, at: new Date(+now - 5 * 60_000) }),
      candidate('flow-changed', { netFlowSol: 8.2, at: new Date(+now - 5 * 60_000) }),
    ];
    const db = {
      consensusSignal: {
        findMany: vi.fn(async () => existing),
      },
    } as unknown as PrismaClient;

    const kept = await filterConsensusWrites(
      db,
      [
        candidate('brand-new'),
        candidate('same-fresh'),
        candidate('heartbeat-due'),
        candidate('score-changed'),
        candidate('flow-changed'),
      ],
      now,
    );

    expect(kept.map((x) => x.tokenId)).toEqual(['brand-new', 'heartbeat-due', 'score-changed', 'flow-changed']);
  });

  it('prunes expired ConsensusSignal rows in bounded batches using the retention cutoff', async () => {
    const findMany = vi.fn(async () => [{ id: 'old-1' }, { id: 'old-2' }]);
    const deleteMany = vi.fn(async () => ({ count: 2 }));
    const db = { consensusSignal: { findMany, deleteMany } } as unknown as PrismaClient;

    const deleted = await pruneExpiredConsensusSignals(db, now);

    expect(deleted).toBe(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { at: { lt: new Date(+now - CONSENSUS_RETENTION_MS) } },
      orderBy: { at: 'asc' },
      take: CONSENSUS_PRUNE_BATCH,
      select: { id: true },
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['old-1', 'old-2'] } } });
  });
});
