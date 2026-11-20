import {describe,it,expect} from 'vitest';
import {qualifyWallet,researchSample} from './qualification';
import {computeWalletStats,type TradeRow} from './stats';

const now=new Date('2040-01-31T12:00:00Z');
const sample={checkedAt:now.toISOString(),closedTrades:30,closedTokens:8,observedDays:10,unmatchedSells:0,excessSellUnits:0,score:80,pnlSol:1,medianRoi:0.1,lastTradeAt:now.toISOString()};
const history={checkedAt:now.toISOString(),windowDays:30,capped:false,skipped:0,coveredFrom:new Date(+now-30*86400000).toISOString(),coveredTo:now.toISOString()};
describe('research qualification independent of historical score',()=>{
 it('requires operator review as well as complete current evidence',()=>{
  expect(qualifyWallet('APPROVED',true,sample,history,now).eligible).toBe(true);
  expect(qualifyWallet('PROVISIONAL',true,sample,history,now).reasons).toContain('REVIEW_REQUIRED');
  expect(qualifyWallet('REJECTED',true,sample,history,now).status).toBe('REJECTED');
  expect(qualifyWallet('APPROVED',false,sample,history,now).eligible).toBe(false);
 });
 it('rejects high scores with small or one-token samples and unmatched units',()=>{
  for(const changes of [{closedTrades:6},{closedTokens:1},{observedDays:1},{unmatchedSells:1},{excessSellUnits:1},{pnlSol:0},{medianRoi:-0.1},{score:NaN}])expect(qualifyWallet('APPROVED',true,{...sample,...changes},history,now).eligible).toBe(false);
 });
 it('does not confuse a freshly computed profile with fresh activity or complete history',()=>{
  const oldChecked=new Date(+now-25*3600000).toISOString();
  const staleTrade=new Date(+now-15*86400000).toISOString();
  expect(qualifyWallet('APPROVED',true,{...sample,lastTradeAt:staleTrade},history,now).reasons).toContain('ACTIVITY_STALE_OR_MISSING');
  expect(qualifyWallet('APPROVED',true,{...sample,lastTradeAt:new Date(+now-6*86400000).toISOString()},history,now).eligible).toBe(true);
  for(const h of [null,{...history,capped:true},{...history,skipped:1},{...history,checkedAt:oldChecked},{...history,coveredFrom:undefined},{...history,coveredTo:new Date(+now+1000).toISOString()}])expect(qualifyWallet('APPROVED',true,sample,h,now).eligible).toBe(false);
 });
 it('accepts capped scans only when live activity and deep (>=21d, >=100 closes) unskipped evidence exist',()=>{
  const capped={...history,capped:true,coveredTo:new Date(+now-10*86400000).toISOString()};
  const deep={...sample,closedTrades:120,closedTokens:50,observedDays:22,unmatchedSells:1,excessSellUnits:1};
  expect(qualifyWallet('APPROVED',true,deep,capped,now).eligible).toBe(true);
  expect(qualifyWallet('APPROVED',true,deep,{...capped,skipped:1},now).reasons).toContain('HISTORY_INCOMPLETE_OR_STALE');
  expect(qualifyWallet('APPROVED',true,{...deep,observedDays:15},capped,now).reasons).toContain('HISTORY_INCOMPLETE_OR_STALE');
  expect(qualifyWallet('APPROVED',true,{...deep,lastTradeAt:new Date(+now-25*3600000).toISOString()},capped,now).reasons).toContain('HISTORY_INCOMPLETE_OR_STALE');
 });
 it('detects partially unmatched sells without altering the original cost-basis score',()=>{
  const trades:TradeRow[]=[{wallet:'w',token:'t',side:'BUY',sol:1,qty:10,at:new Date(+now-60000)},{wallet:'w',token:'t',side:'SELL',sol:4,qty:20,at:now}];
  const stats=computeWalletStats(trades);
  expect(stats.unmatchedSells).toBe(0);
  const evidence=researchSample(trades,stats,80,now);
  expect(evidence.excessSellUnits).toBe(1);
  expect(evidence.closedTokens).toBe(1);
  expect(qualifyWallet('APPROVED',true,evidence,history,now).reasons).toContain('INCOMPLETE_COST_BASIS');
 });
 it('tolerates tiny (<=1.5%) pre-window unmatched sells on high-sample (>=100 trades) wallets while blocking large gaps',()=>{
  const highSample={...sample,closedTrades:1000,closedTokens:200,unmatchedSells:10,excessSellUnits:10};
  expect(qualifyWallet('APPROVED',true,highSample,history,now).eligible).toBe(true);
  expect(qualifyWallet('APPROVED',true,{...highSample,unmatchedSells:20},history,now).reasons).toContain('INCOMPLETE_COST_BASIS');
  expect(qualifyWallet('APPROVED',true,{...sample,closedTrades:99,unmatchedSells:1,excessSellUnits:0},history,now).reasons).toContain('INCOMPLETE_COST_BASIS');
 });
 it('enforces calibrated minScore (60) and tolerates <=1% skipped history swaps on 100+ scanned swaps',()=>{
  expect(qualifyWallet('APPROVED',true,{...sample,score:62},history,now).eligible).toBe(true);
  expect(qualifyWallet('APPROVED',true,{...sample,score:59},history,now).reasons).toContain('SCORE_BELOW_MINIMUM');
  expect(qualifyWallet('APPROVED',true,sample,{...history,scanned:1000,skipped:10},now).eligible).toBe(true);
  expect(qualifyWallet('APPROVED',true,sample,{...history,scanned:1000,skipped:11},now).reasons).toContain('HISTORY_INCOMPLETE_OR_STALE');
  expect(qualifyWallet('APPROVED',true,sample,{...history,scanned:99,skipped:1},now).reasons).toContain('HISTORY_INCOMPLETE_OR_STALE');
 });
});
