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
  const old=new Date(+now-25*3600000).toISOString();
  expect(qualifyWallet('APPROVED',true,{...sample,lastTradeAt:old},history,now).reasons).toContain('ACTIVITY_STALE_OR_MISSING');
  for(const h of [null,{...history,capped:true},{...history,skipped:1},{...history,checkedAt:old},{...history,coveredFrom:undefined},{...history,coveredTo:new Date(+now+1000).toISOString()}])expect(qualifyWallet('APPROVED',true,sample,h,now).eligible).toBe(false);
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
});
