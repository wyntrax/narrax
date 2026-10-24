import {expect,it} from 'vitest';
import {Keypair,PublicKey,SystemProgram,TransactionMessage,TransactionInstruction,VersionedTransaction} from '@solana/web3.js';
import {tradeBaseUnits,tradeDisplayUnits,type TradeQuoteData} from '@narra/shared';
import {JUPITER_V6_PROGRAM,WSOL_MINT,associatedTokenAddress} from '@narra/tx-verify';
import {verifyRoute,verifySignedSwap,BuildResponse} from './manual-swap-engine';
const user=Keypair.generate(),wallet=user.publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58();
const ROUTE_V2='bb64facc31c4af14',SHARED_V2='d19853937cfed8e9';
const quote:TradeQuoteData={inputMint:WSOL_MINT,outputMint:mint,inAmount:'1000000',outAmount:'10000',minOut:'9900',inputDecimals:9,outputDecimals:6,slippageBps:100,priceImpactPct:0,networkFeeLamports:'5000',priorityFeeLamports:'0',maxOverheadLamports:'5000000'};
/** Mirrors live /build route_v2 and shared_accounts_route_v2 responses (see docs/API, checked 2026-10-22). */
function route(shared=false){
 const header=Buffer.alloc(shared?9:8);Buffer.from(shared?SHARED_V2:ROUTE_V2,'hex').copy(header);if(shared)header[8]=5;
 const amounts=Buffer.alloc(19);amounts.writeBigUInt64LE(1000000n);amounts.writeBigUInt64LE(10000n,8);amounts.writeUInt16LE(100,16);
 const keys=shared?[JUPITER_V6_PROGRAM,wallet,associatedTokenAddress(wallet,WSOL_MINT),associatedTokenAddress(wallet,mint),JUPITER_V6_PROGRAM,JUPITER_V6_PROGRAM,WSOL_MINT,mint]:[wallet,associatedTokenAddress(wallet,WSOL_MINT),associatedTokenAddress(wallet,mint),WSOL_MINT,mint,JUPITER_V6_PROGRAM];
 return new TransactionInstruction({programId:new PublicKey(JUPITER_V6_PROGRAM),keys:keys.map(pubkey=>({pubkey:new PublicKey(pubkey),isSigner:pubkey===wallet,isWritable:true})),data:Buffer.concat([header,amounts,Buffer.from([1,0,0,0,0,0,0,0,0,0])])});
}
it.each([false,true])('binds live Jupiter V2 exact-in instruction (%s) to amount, wallet, accounts and slippage',shared=>{expect(()=>verifyRoute(route(shared),wallet,quote)).not.toThrow();});
it('rejects the retired V1 route instruction and unknown discriminators',()=>{const old=route();Buffer.from('e517cb977ae3ad2a','hex').copy(old.data);expect(()=>verifyRoute(old,wallet,quote)).toThrow('UNSUPPORTED_ROUTE');const ix=route();ix.data[1]=0;expect(()=>verifyRoute(ix,wallet,quote)).toThrow('UNSUPPORTED_ROUTE');});
it('rejects amounts, slippage and non-zero platform fee that differ from the quote',()=>{
 for(const shared of [false,true]){const base=shared?9:8;for(const offset of [base,base+8,base+16,base+18]){const ix=route(shared);ix.data[offset]=ix.data[offset]!^1;expect(()=>verifyRoute(ix,wallet,quote)).toThrow('TRANSACTION_MISMATCH');}}
});
it('rejects a different wallet, token accounts or mints',()=>{
 for(const shared of [false,true]){for(const index of shared?[1,2,3,6,7]:[0,1,2,3,4]){const ix=route(shared);ix.keys[index]!.pubkey=Keypair.generate().publicKey;expect(()=>verifyRoute(ix,wallet,quote)).toThrow('TRANSACTION_MISMATCH');}}
});
it('rejects a minimum output outside the quoted slippage band',()=>{
 for(const minOut of ['0','10001','9899'])expect(()=>verifyRoute(route(),wallet,{...quote,minOut})).toThrow('TRANSACTION_MISMATCH');
 expect(()=>verifyRoute(route(),wallet,{...quote,minOut:'9950'})).not.toThrow();
});
it('requires the exact stored message and a real ed25519 signature from its fee payer',()=>{
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:user.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:user.publicKey,toPubkey:user.publicKey,lamports:1})]}).compileToV0Message());
 const original=Buffer.from(tx.serialize()).toString('base64');tx.sign([user]);const signed=Buffer.from(tx.serialize()).toString('base64');
 expect(verifySignedSwap(original,signed,wallet)).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
 expect(()=>verifySignedSwap(original,original,wallet)).toThrow('INVALID_SIGNATURE');
 expect(()=>verifySignedSwap(original,signed,mint)).toThrow('INVALID_SIGNATURE');
 tx.message.recentBlockhash=Keypair.generate().publicKey.toBase58();tx.sign([user]);expect(()=>verifySignedSwap(original,Buffer.from(tx.serialize()).toString('base64'),wallet)).toThrow('INVALID_SIGNATURE');
});
it('uses exact raw amounts and refuses precision loss, zero, overflow and exponent input',()=>{
 expect(tradeBaseUnits('9007199254740.99',6)).toBe(9007199254740990000n);expect(tradeBaseUnits('0.000000001',9)).toBe(1n);
 for(const v of ['0','-1','1e3','0.00000001','01','9999999999999.999999999'])expect(()=>tradeBaseUnits(v,6)).toThrow();
 expect(tradeDisplayUnits('1000000000',9)).toBe('1');expect(tradeDisplayUnits('101',2)).toBe('1.01');expect(tradeDisplayUnits('0',9)).toBe('0');
});
it('rejects provider transaction version 1 rather than guessing its wire format',()=>{expect(BuildResponse.safeParse({transactionVersion:1}).success).toBe(false);});
