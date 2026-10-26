import { expect, it } from 'vitest';
import { rankingReasons } from './walletRanking';
import type { WalletPerformance } from '@narra/shared';
const now=new Date('2026-10-26T12:00:00Z');
const history={checkedAt:now.toISOString(),coveredTo:now.toISOString(),coveredFrom:new Date(+now-30*86400000).toISOString(),capped:false,skipped:0,windowDays:30};
const sample={checkedAt:now.toISOString(),lastTradeAt:now.toISOString(),capped:false,invalidTrades:0,unmatchedSells:0} as WalletPerformance;
const band={band:'SMALL_CAP',closedPositions:25,closedTokens:8,observedDays:12,realisedPnlSol:'8',medianRoi:.4,winRateLowerBound:.6,fastCloseRate:0} as WalletPerformance['bands'][number];
it('requires independent evidence coverage and a repeatable positive sample, not high win rate alone',()=>{
 expect(rankingReasons(sample,band,history,now,false,false)).toEqual({historyComplete:true,reasons:[]});
 expect(rankingReasons(sample,{...band,realisedPnlSol:'-8'},history,now,false,false).reasons).toContain('POSITIVE_RESULTS_REQUIRED');
 expect(rankingReasons(sample,band,{...history,capped:true},now,false,false).reasons).toContain('HISTORY_INCOMPLETE');
 expect(rankingReasons({...sample,unmatchedSells:1},band,history,now,false,false).reasons).toContain('INCOMPLETE_COST_BASIS');
});
it('withholds stale, unknown-cap, fast-exit, linked and known-deployer samples from review-ready rank',()=>{
 const result=rankingReasons(sample,{...band,band:'UNKNOWN',fastCloseRate:.8},history,new Date(+now+2*86400000),true,true);
 expect(result.reasons).toEqual(expect.arrayContaining(['PERFORMANCE_STALE','ACTIVITY_STALE','HISTORY_INCOMPLETE','SMALL_CAP_UNPROVEN','FAST_EXITS','LINKED_WALLETS','KNOWN_DEPLOYER']));
});
