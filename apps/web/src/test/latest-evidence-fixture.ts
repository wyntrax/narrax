import type {LatestEvidence} from '@narra/shared';
/** Synthetic UI fixture only. */
export function latestEvidenceFixture():LatestEvidence{
 const at='2026-10-23T14:00:00.000Z',missing={state:'MISSING' as const,at:null,source:null,data:null};
 return {checkedAt:at,market:{state:'FRESH',at,source:'dexscreener',data:{priceUsd:0.01,liquidityUsd:20000,marketCapUsd:50000}},holders:{state:'STALE',at,source:'stored-holder-metric',data:{holders:50,top10Pct:40,devHoldingPct:null}},risk:missing,rugcheck:missing,tradeability:{state:'FRESH',at,source:'jupiter',data:{version:1,mint:'So11111111111111111111111111111111111111112',source:'jupiter',sourceAt:at,direction:'BUY',inputMint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',inAmount:'50000000',outAmount:'1000000',otherAmountThreshold:'995000',slippageBps:50,routeCount:1,ticketUsdc:50,priceImpactPct:1}}};
}
