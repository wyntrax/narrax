import {it,expect} from 'vitest';
import {parseHeliusSwaps,WSOL_MINT} from './helius';
const tx={signature:'signature',timestamp:1792301059,feePayer:'wallet',type:'SWAP',transactionError:null,events:{},tokenTransfers:[{mint:WSOL_MINT,tokenAmount:.2,fromUserAccount:'wallet',toUserAccount:'pool'},{mint:'token',tokenAmount:100,fromUserAccount:'pool',toUserAccount:'wallet'}]};
it('parses explicit wallet-owned wrapped SOL AMM buys and sells without events.swap',()=>{
 expect(parseHeliusSwaps([tx]).events[0]).toMatchObject({wallet:'wallet',side:'BUY',amountSol:.2,tokenAmount:100});
 const sell={...tx,tokenTransfers:tx.tokenTransfers.map(t=>({...t,fromUserAccount:t.toUserAccount,toUserAccount:t.fromUserAccount}))};
 expect(parseHeliusSwaps([sell]).events[0]?.side).toBe('SELL');
});
it('rejects failed, non-swap, unrelated, multi-token and native-fee-only evidence',()=>{
 for(const invalid of [{...tx,transactionError:'failed'},{...tx,type:'TRANSFER'},{...tx,tokenTransfers:[tx.tokenTransfers[0],{...tx.tokenTransfers[1],fromUserAccount:'unrelated'}]},{...tx,tokenTransfers:[...tx.tokenTransfers,{...tx.tokenTransfers[1],mint:'another'}]},{...tx,tokenTransfers:[tx.tokenTransfers[1]],nativeTransfers:[{amount:10000}]}])expect(parseHeliusSwaps([invalid]).events).toEqual([]);
});
