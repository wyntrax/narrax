import { expect, it } from 'vitest';
import { isLinkedCluster, rankingReasons } from './walletRanking';
import type { WalletPerformance } from '@narra/shared';
const now=new Date('2026-10-26T12:00:00Z');
const history={checkedAt:now.toISOString(),coveredTo:now.toISOString(),coveredFrom:new Date(+now-30*86400000).toISOString(),capped:false,skipped:0,windowDays:30};
const sample={checkedAt:now.toISOString(),lastTradeAt:now.toISOString(),capped:false,invalidTrades:0,unmatchedSells:0} as WalletPerformance;
const band={band:'SMALL_CAP',closedPositions:25,closedTokens:8,observedDays:12,realisedPnlSol:'8',medianRoi:.4,winRateLowerBound:.6,fastCloseRate:0,medianClosedPositionSol:'0.1'} as WalletPerformance['bands'][number];
it('requires independent evidence coverage and a repeatable positive sample, not high win rate alone',()=>{
 expect(rankingReasons(sample,band,history,now,false,false)).toEqual({historyComplete:true,reasons:[]});
 expect(rankingReasons(sample,{...band,realisedPnlSol:'-8'},history,now,false,false).reasons).toContain('POSITIVE_RESULTS_REQUIRED');
 expect(rankingReasons(sample,band,{...history,capped:true},now,false,false).reasons).toContain('HISTORY_INCOMPLETE');
 expect(rankingReasons({...sample,unmatchedSells:1},band,history,now,false,false).reasons).toContain('INCOMPLETE_COST_BASIS');
});
it('withholds dust-sized and legacy unknown-size results, with an explicit adjustable boundary',()=>{
 expect(rankingReasons(sample,{...band,medianClosedPositionSol:undefined},history,now,false,false).reasons).toContain('POSITION_SIZE_UNKNOWN');
 expect(rankingReasons(sample,{...band,medianClosedPositionSol:'0.00003'},history,now,false,false).reasons).toContain('SMALL_POSITIONS');
 expect(rankingReasons(sample,{...band,medianClosedPositionSol:'0.01'},history,now,false,false).reasons).toEqual([]);
 expect(rankingReasons(sample,band,history,now,false,false,1).reasons).toContain('SMALL_POSITIONS');
 expect(rankingReasons(sample,{...band,medianClosedPositionSol:'0.00003'},history,now,false,false,0).reasons).toEqual([]);
});
it('withholds stale, unknown-cap, fast-exit, linked and known-deployer samples from review-ready rank',()=>{
 const result=rankingReasons(sample,{...band,band:'UNKNOWN',fastCloseRate:.8},history,new Date(+now+2*86400000),true,true);
 expect(result.reasons).toEqual(expect.arrayContaining(['PERFORMANCE_STALE','ACTIVITY_STALE','HISTORY_INCOMPLETE','SMALL_CAP_UNPROVEN','FAST_EXITS','LINKED_WALLETS','KNOWN_DEPLOYER']));
});
it('ignores LOW-confidence timing mega-clusters while still flagging funding and stronger timing clusters',()=>{
 expect(isLinkedCluster({clusterId:null,cluster:null})).toBe(false);
 expect(isLinkedCluster({clusterId:'c1',cluster:{label:'timing',confidence:'LOW'}})).toBe(false);
 expect(isLinkedCluster({clusterId:'c2',cluster:{label:'timing',confidence:'MEDIUM'}})).toBe(true);
 expect(isLinkedCluster({clusterId:'c3',cluster:{label:'funding',confidence:'LOW'}})).toBe(true);
});
it('accepts deep live-sampled history (100+ ALL-band closes over 21+ days) while keeping historyComplete false',()=>{
 const allBand={...band,band:'ALL',closedPositions:100,observedDays:21} as WalletPerformance['bands'][number];
 const deepSample={...sample,bands:[allBand,band]} as WalletPerformance;
 const cappedHistory={...history,capped:true,coveredFrom:new Date(+now-21*86400000).toISOString()};
 expect(rankingReasons(deepSample,band,cappedHistory,now,false,false)).toEqual({historyComplete:false,reasons:[]});
 expect(rankingReasons({...sample,bands:[{...allBand,observedDays:20},band]},band,cappedHistory,now,false,false).reasons).toContain('HISTORY_INCOMPLETE');
 expect(rankingReasons({...sample,bands:[{...allBand,closedPositions:99},band]},band,cappedHistory,now,false,false).reasons).toContain('HISTORY_INCOMPLETE');
 expect(rankingReasons(deepSample,band,{...cappedHistory,skipped:1},now,false,false).reasons).toContain('HISTORY_INCOMPLETE');
 expect(rankingReasons({...deepSample,lastTradeAt:new Date(+now-25*3600000).toISOString()},band,cappedHistory,now,false,false).reasons).toContain('HISTORY_INCOMPLETE');
});
it('applies the 1.5% unmatched-sell tolerance on 100+ ALL-band closes while still rejecting invalidTrades',()=>{
 const allBand={...band,band:'ALL',closedPositions:200,observedDays:21} as WalletPerformance['bands'][number];
 const largeSample={...sample,bands:[allBand,band],unmatchedSells:3} as WalletPerformance;
 expect(rankingReasons(largeSample,band,history,now,false,false)).toEqual({historyComplete:true,reasons:[]});
 expect(rankingReasons({...largeSample,unmatchedSells:4},band,history,now,false,false).reasons).toContain('INCOMPLETE_COST_BASIS');
 expect(rankingReasons({...largeSample,invalidTrades:1},band,history,now,false,false).reasons).toContain('INCOMPLETE_COST_BASIS');
});
it('tolerates <=1% skipped history swaps when scanned >= 100 on both uncapped and deep live samples',()=>{
 const allBand={...band,band:'ALL',closedPositions:100,observedDays:21} as WalletPerformance['bands'][number];
 const deepSample={...sample,bands:[allBand,band]} as WalletPerformance;
 expect(rankingReasons(sample,band,{...history,scanned:1000,skipped:10},now,false,false)).toEqual({historyComplete:true,reasons:[]});
 expect(rankingReasons(deepSample,band,{...history,capped:true,scanned:1000,skipped:10},now,false,false)).toEqual({historyComplete:false,reasons:[]});
 expect(rankingReasons(deepSample,band,{...history,capped:true,scanned:1000,skipped:11},now,false,false).reasons).toContain('HISTORY_INCOMPLETE');
 expect(rankingReasons(sample,band,{...history,skipped:1},now,false,false).reasons).toContain('HISTORY_INCOMPLETE');
});
it('withholds automated/bot wallets from review-ready status with AUTOMATED_BEHAVIOR',()=>{
 expect(rankingReasons(sample,band,history,now,false,false,0.01,true).reasons).toContain('AUTOMATED_BEHAVIOR');
});
it('withholds bag-holding wallets whose dead open bags wipe out realised profit',()=>{
 expect(rankingReasons(sample,{...band,realisedPnlSol:'5',deadBagPositions:3,deadBagCostSol:'6'},history,now,false,false).reasons).toContain('DEAD_BAG_OVERHANG');
 expect(rankingReasons(sample,{...band,realisedPnlSol:'10',deadBagPositions:1,deadBagCostSol:'2'},history,now,false,false).reasons).not.toContain('DEAD_BAG_OVERHANG');
});
it('accepts a 5+ live small-cap sample when the 30-day ALL band has 20+ closes and band fast-close rate stays <= 50%',()=>{
 const allBand={...band,band:'ALL',closedPositions:200,closedTokens:200,observedDays:30,fastCloseRate:0.5} as WalletPerformance['bands'][number];
 const liveSmall={...band,closedPositions:9,closedTokens:9,observedDays:29,winRateLowerBound:0.7,fastCloseRate:0.11} as WalletPerformance['bands'][number];
 const multi={...sample,bands:[allBand,liveSmall]} as WalletPerformance;
 expect(rankingReasons(multi,liveSmall,history,now,false,false)).toEqual({historyComplete:true,reasons:[]});
 expect(rankingReasons(multi,allBand,history,now,false,false)).toEqual({historyComplete:true,reasons:[]});
 expect(rankingReasons(multi,{...liveSmall,fastCloseRate:0.54},history,now,false,false).reasons).toContain('FAST_EXITS');
});
