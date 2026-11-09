import { DiscoverySpendEvidence } from '@narra/solana';
import { Prisma } from '@narra/database';
import { z } from 'zod';

const D = Prisma.Decimal.clone({ precision: 80 });
const time = z.string().datetime();

export interface DiscoverySpendObservation { tokenId: string; signature: unknown; at: unknown; spendEvidence: unknown }
/** Per-token first observations, not repeated swap legs or closed positions.
 * Unknown observations remain in the denominator; a median over known legs is
 * explicitly partial and never feeds the closed-position-size readiness rule.
 */
export function summarizeDiscoverySpend(observations: DiscoverySpendObservation[], now: Date) {
  const distinct = new Map<string, DiscoverySpendObservation>();
  for (const o of observations) if (!distinct.has(o.tokenId)) distinct.set(o.tokenId,o);
  const amounts: Prisma.Decimal[] = [], unknownReasons: Record<string,number> = {};
  const missing = (reason: string) => { unknownReasons[reason] = (unknownReasons[reason] ?? 0) + 1; };
  for (const o of distinct.values()) {
    const observedAt=time.safeParse(o.at);
    if (typeof o.signature !== 'string' || !o.signature || !observedAt.success || Date.parse(observedAt.data) > +now) { missing('MISSING_PROVENANCE'); continue; }
    const parsed = DiscoverySpendEvidence.safeParse(o.spendEvidence);
    if (!parsed.success) { missing(o.spendEvidence == null ? 'LEGACY_NO_SPEND_EVIDENCE' : 'INVALID_SPEND_EVIDENCE'); continue; }
    if (parsed.data.status === 'UNKNOWN') { missing(parsed.data.reason); continue; }
    amounts.push(new D(parsed.data.quoteLamports).div(1_000_000_000));
  }
  amounts.sort((a,b)=>a.cmp(b));
  const mid = Math.floor(amounts.length/2);
  const median = amounts.length ? amounts.length%2 ? amounts[mid]! : amounts[mid-1]!.plus(amounts[mid]!).div(2) : null;
  return { version: 1 as const, observedTokens: distinct.size, matchedTokens: amounts.length, unknownTokens: distinct.size-amounts.length,
    medianMatchedQuoteSol: median?.toFixed() ?? null, minMatchedQuoteSol: amounts[0]?.toFixed() ?? null,
    maxMatchedQuoteSol: amounts.at(-1)?.toFixed() ?? null, unknownReasons };
}
