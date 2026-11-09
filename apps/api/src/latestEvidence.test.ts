import {it,expect,vi} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {latestEvidenceViews} from './latestEvidence';
import {testTradeability} from '../../../scripts/test-tradeability';

const now=new Date('2026-10-23T14:00:00Z'),token={id:'token',mint:'mint'};
function fixture(){
 const metric={id:'metric',at:now,priceUsd:'0.01',marketCapUsd:'50000',liquidityUsd:'20000'};
 const values=new Map<string,unknown>([
  ['research.market.token',{mint:token.mint,metricId:metric.id,at:now.toISOString(),source:'dexscreener',marketCapIsFdv:false,priceChange1hPct:0,pairAddress:'pair',dexId:null,pairCreatedAt:null}],
  ['research.radarTradeability.mint',testTradeability(token.mint,now)],
 ]);
 const row={...token,metrics:[metric],holders:[{at:new Date(+now-61*60000),holders:50,top10Pct:40,devHoldingPct:null}],risk:[]};
 const findTokens=vi.fn(async()=>[row]),findSettings=vi.fn(async()=>[...values].map(([key,value])=>({key,value})));
 return {row,values,findTokens,findSettings,db:{token:{findMany:findTokens},systemSetting:{findMany:findSettings}} as unknown as PrismaClient};
}
it('returns separate stored observations with accurate age and missing states in bounded reads',async()=>{
 const f=fixture(),view=(await latestEvidenceViews(f.db,[token,token],now)).get(token.id)!;
 expect(view.market).toMatchObject({state:'FRESH',source:'dexscreener',data:{priceUsd:0.01}});
  expect(view.holders).toMatchObject({state:'UNVERIFIED',data:{devHoldingPct:null}});
 expect(view.risk).toMatchObject({state:'MISSING',data:null});
 expect(view.rugcheck).toMatchObject({state:'MISSING',data:null});
 expect(view.tradeability).toMatchObject({state:'FRESH',data:{direction:'BUY',ticketUsdc:50}});
 expect(f.findTokens).toHaveBeenCalledTimes(1);expect(f.findSettings).toHaveBeenCalledTimes(1);
 expect(f.findSettings.mock.calls[0]).toBeDefined();
 expect(view).not.toHaveProperty('verdict');
});
it('uses provider holder observation time instead of a newer retrieval or legacy row timestamp',async()=>{
 const f=fixture(),sourceAt=new Date(+now-24*3600000).toISOString();
 f.row.holders[0]!.at=now;
 f.values.set('research.holders.token',{mint:token.mint,source:'geckoterminal',sourceAt,retrievedAt:now.toISOString(),holders:5919,top10Pct:88.83,devHoldingPct:null});
 const view=(await latestEvidenceViews(f.db,[token],now)).get(token.id)!;
 expect(view.holders).toMatchObject({state:'STALE',at:sourceAt,retrievedAt:now.toISOString(),source:'geckoterminal',data:{holders:5919}});
 f.values.set('research.holders.token',{...f.values.get('research.holders.token') as object,sourceAt:null});
 expect((await latestEvidenceViews(f.db,[token],now)).get(token.id)?.holders).toMatchObject({state:'UNVERIFIED',at:null});
});
it('never credits mismatched, future or legacy evidence as fresh',async()=>{
 const f=fixture();
 f.values.set('research.market.token',{...f.values.get('research.market.token') as object,mint:'other'});
 f.values.set('research.radarTradeability.mint',{...testTradeability('other',now)});
 let view=(await latestEvidenceViews(f.db,[token],now)).get(token.id)!;
 expect(view.market.state).toBe('UNVERIFIED');expect(view.tradeability).toMatchObject({state:'INVALID',data:null});
 f.row.metrics[0]!.at=new Date(+now+1000);
 f.values.set('research.radarTradeability.mint',testTradeability(token.mint,new Date(+now+1000)));
 view=(await latestEvidenceViews(f.db,[token],now)).get(token.id)!;
 expect(view.market).toMatchObject({state:'INVALID',data:null});expect(view.tradeability.state).toBe('INVALID');
 f.values.set('research.radarTradeability.mint',{mint:token.mint,sourceAt:now.toISOString(),priceImpactPct:0,ticketUsd:50});
 expect((await latestEvidenceViews(f.db,[token],now)).get(token.id)?.tradeability.state).toBe('INVALID');
 f.values.set('research.radarTradeability.mint',testTradeability(token.mint,new Date(+now-11*60000)));
 expect((await latestEvidenceViews(f.db,[token],now)).get(token.id)?.tradeability.state).toBe('STALE');
});

it('isolates malformed holder evidence without erasing valid or missing observations',async()=>{
 const f=fixture();f.row.holders[0]!.top10Pct=101;
 const view=(await latestEvidenceViews(f.db,[token],now)).get(token.id)!;
 expect(view.holders).toMatchObject({state:'INVALID',data:null});
 expect(view.market.state).toBe('FRESH');expect(view.tradeability.state).toBe('FRESH');
 expect(view.risk.state).toBe('MISSING');expect(view.rugcheck.state).toBe('MISSING');
});

it('marks invalid numeric values and dates invalid instead of throwing or silently treating them as missing',async()=>{
 const f=fixture();f.row.metrics[0]!.priceUsd='1e400';f.row.holders[0]!.at=new Date(NaN);
 const view=(await latestEvidenceViews(f.db,[token],now)).get(token.id)!;
 expect(view.market).toMatchObject({state:'INVALID',data:null});
 expect(view.holders).toMatchObject({state:'INVALID',data:null});
 expect(view.tradeability.state).toBe('FRESH');
});
