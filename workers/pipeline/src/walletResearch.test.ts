import { describe, expect, it } from 'vitest';
import { entityKeyForWallet } from './walletResearch';

describe('entityKeyForWallet', () => {
  it('treats unclustered wallets as independent entities', () => {
    expect(entityKeyForWallet({ id: 'w1', clusterId: null, cluster: null })).toBe('wallet:w1');
  });

  it('collapses funding clusters and medium/high timing clusters into one cluster entity', () => {
    expect(entityKeyForWallet({ id: 'w1', clusterId: 'c1', cluster: { label: 'funding', confidence: 'HIGH' } })).toBe('cluster:c1');
    expect(entityKeyForWallet({ id: 'w2', clusterId: 'c1', cluster: { label: 'funding', confidence: 'LOW' } })).toBe('cluster:c1');
    expect(entityKeyForWallet({ id: 'w3', clusterId: 'c2', cluster: { label: 'timing', confidence: 'MEDIUM' } })).toBe('cluster:c2');
  });

  it('does not collapse LOW-confidence timing mega-clusters into one entity', () => {
    expect(entityKeyForWallet({ id: 'w1', clusterId: 'c-low', cluster: { label: 'timing', confidence: 'LOW' } })).toBe('wallet:w1');
    expect(entityKeyForWallet({ id: 'w2', clusterId: 'c-low', cluster: { label: 'timing', confidence: 'LOW' } })).toBe('wallet:w2');
  });
});
