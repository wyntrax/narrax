import {it,expect} from 'vitest';
import {summarizeWalletResearch} from './walletResearch';
it('retains missing first calls before overlap deduplication and separates sell observations',()=>{
 const now=new Date();
 const rows=[{id:'first',tokenId:'t',side:'BUY' as const,createdAt:now,measurements:[{horizonHours:1,status:'UNKNOWN',returnPct:null}]},
 {id:'later',tokenId:'t',side:'BUY' as const,createdAt:new Date(+now+60000),measurements:[{horizonHours:1,status:'MEASURED',returnPct:100}]},
 {id:'sell',tokenId:'t',side:'SELL' as const,createdAt:now,measurements:[{horizonHours:1,status:'MEASURED',returnPct:-25}]}];
 const [buy,sell]=summarizeWalletResearch(rows);
 expect(buy!.horizons[0]).toMatchObject({raw:2,independent:1,unknown:1,known:0,overlapExcluded:1,returns:{median:null,sufficient:false}});
 expect(sell!.horizons[0]).toMatchObject({known:1,returns:{median:-25,sufficient:false}});
});
