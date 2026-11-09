import { expect, it } from 'vitest';
import { discoverySpendEvidence, DiscoverySpendEvidence } from './discovery-spend';
import { WSOL_MINT } from './helius';
import type { ParsedTx } from './rpc';
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',SYSTEM='11111111111111111111111111111111';
const native=(source:string,destination:string,lamports:unknown)=>({programId:SYSTEM,parsed:{type:'transfer',info:{source,destination,lamports}}});
const transfer=(source:string,destination:string,amount:unknown)=>({programId:TOKEN,parsed:{type:'transfer',info:{source,destination,amount}}});
const balance=(accountIndex:number,owner:string,mint:string,amount:string)=>({accountIndex,owner,mint,uiTokenAmount:{amount}});
function fixture(wsol=false):ParsedTx {
 return {blockTime:1793000000,transaction:{message:{accountKeys:['wallet','pool-token','wallet-token','wallet-wsol','pool-wsol'],instructions:[{programId:'swap-program'},native('wallet','tip',5000),{programId:SYSTEM,parsed:{type:'createAccount',info:{source:'wallet',lamports:2039280}}}]}},
  meta:{err:null,fee:5000,preBalances:[1000000000],postBalances:[997920720],
   preTokenBalances:[balance(1,'pool','token','1000'),balance(2,'wallet','token','0'),balance(3,'wallet',WSOL_MINT,'1000000000'),balance(4,'pool',WSOL_MINT,'1000000000')],
   postTokenBalances:[balance(1,'pool','token','900'),balance(2,'wallet','token','100'),balance(3,'wallet',WSOL_MINT,wsol?'999972538':'1000000000'),balance(4,'pool',WSOL_MINT,wsol?'1000027462':'1000000000')],
   innerInstructions:[{index:0,instructions:[wsol?transfer('wallet-wsol','pool-wsol','27462'):native('wallet','pool',30000),transfer('pool-token','wallet-token','100')]}]}};
}
it('records exact native quote leg while excluding payer balance changes, network fees, rent and top-level tips',()=>{
 expect(discoverySpendEvidence(fixture(),'token')).toEqual({version:1,status:'MATCHED_TRANSFERS',source:'RPC_PARSED_INNER_TRANSFERS',quoteAsset:'SOL',quoteLamports:'30000',tokenAmountRaw:'100',outerInstructionIndex:0,counterparty:'pool',programId:'swap-program'});
});
it('records exact WSOL transfer amounts and supports checked token transfers',()=>{
 const tx=fixture(true);tx.meta!.innerInstructions![0]!.instructions[0]={programId:TOKEN,parsed:{type:'transferChecked',info:{source:'wallet-wsol',destination:'pool-wsol',mint:WSOL_MINT,tokenAmount:{amount:'27462',decimals:9}}}};
 expect(discoverySpendEvidence(tx,'token')).toMatchObject({status:'MATCHED_TRANSFERS',quoteAsset:'WSOL',quoteLamports:'27462'});
});
it('does not infer a quote from receiving tokens, even if the native balance fell',()=>{
 const tx=fixture();tx.meta!.innerInstructions=[];
 expect(discoverySpendEvidence(tx,'token')).toMatchObject({status:'UNKNOWN',reason:'NO_MATCHED_QUOTE_TRANSFER'});
});
it.each(['failed','missing metadata','no receipt'])('does not attribute spend without a successful token increase (%s)',kind=>{
 const tx=fixture();if(kind==='failed')tx.meta!.err='failed';else if(kind==='missing metadata')tx.meta=null;else tx.meta!.postTokenBalances=tx.meta!.preTokenBalances;
 expect(discoverySpendEvidence(tx,'token')).toMatchObject({status:'UNKNOWN',reason:'NO_TOKEN_INCREASE'});
});
it.each(['mapping','counterparty','amount','extra asset','refund','rent','token2022','spoofed program','second receipt'])('leaves unsupported or ambiguous legs unknown (%s)',kind=>{
 const tx=fixture(),ix=tx.meta!.innerInstructions![0]!.instructions;
 if(kind==='mapping')tx.transaction.message.accountKeys=['wallet'];
 if(kind==='counterparty')ix[0]=native('wallet','unrelated',30000);
 if(kind==='amount')ix[0]=native('wallet','pool',Number.MAX_SAFE_INTEGER+1);
 if(kind==='extra asset')tx.meta!.postTokenBalances!.push(balance(3,'wallet','other-token','10'));
 if(kind==='refund')ix.push(native('pool','wallet',10000));
 if(kind==='rent')ix.push({programId:SYSTEM,parsed:{type:'createAccount',info:{source:'wallet',lamports:2039280}}});
 if(kind==='token2022')ix[1]={...transfer('pool-token','wallet-token','100'),programId:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'};
 if(kind==='spoofed program')ix[0]={...native('wallet','pool',30000),programId:'fake',program:'system'};
 if(kind==='second receipt')ix.push(transfer('pool-token','wallet-token','100'));
 expect(discoverySpendEvidence(tx,'token').status).toBe('UNKNOWN');
});
it('does not match legs across independent outer calls',()=>{
 const tx=fixture(),ix=tx.meta!.innerInstructions![0]!.instructions;
 tx.meta!.innerInstructions=[{index:0,instructions:[ix[0]]},{index:1,instructions:[ix[1]]}];
 tx.transaction.message.instructions[1]={programId:'another-program'};
 expect(discoverySpendEvidence(tx,'token').status).toBe('UNKNOWN');
});
it('declines net receipts inconsistent with the token leg and inconsistent token ownership',()=>{
 const tx=fixture();tx.meta!.postTokenBalances![1]!.uiTokenAmount.amount='90';
 expect(discoverySpendEvidence(tx,'token').status).toBe('UNKNOWN');
 const changed=fixture();changed.meta!.postTokenBalances![0]!.owner='other';
 expect(discoverySpendEvidence(changed,'token')).toMatchObject({status:'UNKNOWN',reason:'MISSING_ACCOUNT_MAPPING'});
});
it.each(['NaN','-1','0','1.5','18446744073709551616','invalid'])('rejects malformed raw amounts without throwing (%s)',amount=>{
 const tx=fixture();tx.meta!.innerInstructions![0]!.instructions[0]=native('wallet','pool',amount);
 expect(discoverySpendEvidence(tx,'token').status).toBe('UNKNOWN');
 expect(DiscoverySpendEvidence.safeParse({...discoverySpendEvidence(fixture(),'token'),quoteLamports:amount}).success).toBe(false);
});
