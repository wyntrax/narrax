import {expect,it} from 'vitest';
import {discoverySpendEvidence,DiscoverySpendEvidence} from './discovery-spend';
import {capturedTemporaryWsol,capturedTemporaryWsolTx} from './wsol-ownership.fixture';
import {TOKEN_2022_PROGRAM as TOKEN} from './token2022-evidence';
const {mint,wallet}=capturedTemporaryWsol;
const ix=(type:string,info:Record<string,unknown>)=>({programId:TOKEN,parsed:{type,info}});
const route=(tx:ReturnType<typeof capturedTemporaryWsolTx>)=>tx.meta!.innerInstructions!.find(g=>g.index===6)!;
const setup=(tx:ReturnType<typeof capturedTemporaryWsolTx>)=>tx.meta!.innerInstructions!.find(g=>g.index===5)!;
const account=(tx:ReturnType<typeof capturedTemporaryWsolTx>,index:number)=>tx.transaction.message.accountKeys[index] as string;
it('matches captured checked transfers with exact source/destination deltas and proven fresh destination',()=>{
 const r=discoverySpendEvidence(capturedTemporaryWsolTx(),mint);
 expect(r).toMatchObject({status:'MATCHED_TRANSFERS',quoteAsset:'WSOL',quoteLamports:'1599244',tokenAmountRaw:'18807903081',token2022Transfers:[{
  programId:TOKEN,decimals:6,amountRaw:'18807903081',sourcePreRaw:'999821688286948',sourcePostRaw:'999802880383867',destinationPreRaw:'0',destinationPostRaw:'18807903081',destinationPreEvidence:'CREATED_AND_INITIALIZED',
 }]});
 expect(DiscoverySpendEvidence.safeParse(r).success).toBe(true);
});
it('supports an existing destination with full before/after snapshots',()=>{
 const tx=capturedTemporaryWsolTx(),dest=tx.meta!.postTokenBalances!.find(b=>b.accountIndex===2)!;
 tx.meta!.preTokenBalances!.push({...dest,uiTokenAmount:{...dest.uiTokenAmount,amount:'10'}});
 dest.uiTokenAmount.amount='18807903091';
 tx.meta!.innerInstructions=tx.meta!.innerInstructions!.filter(g=>g.index!==5);
 tx.transaction.message.instructions[5]={programId:'other'};
 expect(discoverySpendEvidence(tx,mint)).toMatchObject({status:'MATCHED_TRANSFERS',token2022Transfers:[{destinationPreRaw:'10',destinationPreEvidence:'BALANCE_SNAPSHOT'}]});
});
it.each(['destination fee','source extra debit','gross mismatch'])('leaves %s unknown rather than estimating fees',kind=>{
 const tx=capturedTemporaryWsolTx();
 if(kind==='destination fee')tx.meta!.postTokenBalances!.find(b=>b.accountIndex===2)!.uiTokenAmount.amount='18807903080';
 if(kind==='source extra debit')tx.meta!.postTokenBalances!.find(b=>b.accountIndex===5)!.uiTokenAmount.amount='999802880383866';
 if(kind==='gross mismatch')route(tx).instructions[1]=ix('transferChecked',{source:account(tx,5),destination:account(tx,2),mint,tokenAmount:{amount:'18807903082',decimals:6}});
 expect(discoverySpendEvidence(tx,mint)).toMatchObject({status:'UNKNOWN',reason:'TOKEN_2022_AMOUNT_MISMATCH'});
});
it.each(['transferCheckedWithFee','transfer','confidentialTransfer','unknownExtension'])('declines unsupported instruction %s',type=>{
 const tx=capturedTemporaryWsolTx();route(tx).instructions[1]=ix(type,{source:account(tx,5),destination:account(tx,2),mint,amount:'18807903081',feeAmount:'1'});
 expect(discoverySpendEvidence(tx,mint)).toMatchObject({status:'UNKNOWN',reason:'UNSUPPORTED_TOKEN_PROGRAM'});
});
it.each(['program','decimals','missing source before','missing source after','duplicate balance','invalid raw','missing destination setup'])('requires complete and coherent raw balance evidence (%s)',kind=>{
 const tx=capturedTemporaryWsolTx(),post=tx.meta!.postTokenBalances!,dest=post.find(b=>b.accountIndex===2)!;
 if(kind==='program')dest.programId='fake';
 if(kind==='decimals')dest.uiTokenAmount.decimals=9;
 if(kind==='missing source before')tx.meta!.preTokenBalances=tx.meta!.preTokenBalances!.filter(b=>b.accountIndex!==5);
 if(kind==='missing source after')tx.meta!.postTokenBalances=post.filter(b=>b.accountIndex!==5);
 if(kind==='duplicate balance')post.push({...dest});
 if(kind==='invalid raw')dest.uiTokenAmount.amount='18446744073709551616';
 if(kind==='missing destination setup')setup(tx).instructions=[];
 expect(discoverySpendEvidence(tx,mint)).toMatchObject({status:'UNKNOWN',reason:'TOKEN_2022_BALANCE_EVIDENCE_MISSING'});
});
it.each(['authority','close','mint','burn','extra transfer','opaque','late init','reinit','fake create','wrong owner'])('rejects lifecycle or extra activity: %s',kind=>{
 const tx=capturedTemporaryWsolTx(),dest=account(tx,2),source=account(tx,5);
 if(kind==='authority')route(tx).instructions.push(ix('setAuthority',{account:dest,newAuthority:wallet}));
 if(kind==='close')tx.meta!.innerInstructions!.push({index:7,instructions:[ix('closeAccount',{account:dest,destination:wallet})]});
 if(kind==='mint')route(tx).instructions.push(ix('mintTo',{account:dest,mint,amount:'1'}));
 if(kind==='burn')route(tx).instructions.push(ix('burn',{account:source,mint,amount:'1'}));
 if(kind==='extra transfer')tx.meta!.innerInstructions!.push({index:7,instructions:[ix('transferChecked',{source:dest,destination:source,mint,tokenAmount:{amount:'1',decimals:6}})]});
 if(kind==='opaque')tx.meta!.innerInstructions!.push({index:7,instructions:[{programId:TOKEN,accounts:[dest],data:'opaque'}]});
 if(kind==='late init')setup(tx).index=7;
 if(kind==='reinit')setup(tx).instructions.push(setup(tx).instructions[3]);
 if(kind==='fake create')setup(tx).instructions[1]={programId:'fake'};
 if(kind==='wrong owner')setup(tx).instructions[3]=ix('initializeAccount3',{account:dest,mint,owner:'someone'});
 expect(discoverySpendEvidence(tx,mint)).toMatchObject({status:'UNKNOWN',reason:'TOKEN_2022_LIFECYCLE_AMBIGUOUS'});
});
