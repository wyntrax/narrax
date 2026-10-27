import {expect,it} from 'vitest';
import {temporaryWsolOwnership} from './wsol-ownership';
import {discoverySpendEvidence,DiscoverySpendEvidence} from './discovery-spend';
import {capturedTemporaryWsol,capturedTemporaryWsolTx} from './wsol-ownership.fixture';
const {account,wallet,mint}=capturedTemporaryWsol;
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',SYSTEM='11111111111111111111111111111111',WSOL='So11111111111111111111111111111111111111112';
const ix=(programId:string,type:string,info:Record<string,unknown>)=>({programId,parsed:{type,info}});
it('recovers ownership from captured creation and initialization, while retaining the Token-2022 blocker',()=>{
 const tx=capturedTemporaryWsolTx();
 const proof=temporaryWsolOwnership(tx,6).get(account);
 expect(proof).toEqual({account,owner:wallet,mint:WSOL,source:'RPC_CREATE_AND_INITIALIZE',createdAt:{outerIndex:2,innerIndex:1},initializedAt:{outerIndex:2,innerIndex:3}});
 const evidence=discoverySpendEvidence(tx,mint);
 expect(evidence).toEqual({version:1,status:'UNKNOWN',reason:'UNSUPPORTED_TOKEN_PROGRAM',recoveredWsolAccounts:[proof]});
 expect(DiscoverySpendEvidence.safeParse(evidence).success).toBe(true);
});
it('uses the exact transfer leg, not creation rent or wrap funding, for a synthetic classic-token counterpart',()=>{
 const tx=capturedTemporaryWsolTx();
 // Synthetic variant, not a claim that the captured target uses classic SPL.
 const group=tx.meta!.innerInstructions![1]!;
 group.instructions[1]={...group.instructions[1] as object,programId:TOKEN};
 tx.transaction.message.instructions[3]=ix(SYSTEM,'transfer',{source:wallet,destination:account,lamports:5000000});
 const result=discoverySpendEvidence(tx,mint);
 expect(result).toMatchObject({status:'MATCHED_TRANSFERS',quoteAsset:'WSOL',quoteLamports:'1599244',tokenAmountRaw:'18807903081',recoveredWsolAccounts:[{account,owner:wallet}]});
});
it.each(['initializeAccount','initializeAccount2','initializeAccount3'])('supports explicit classic %s before the route',type=>{
 const tx=capturedTemporaryWsolTx();tx.meta!.innerInstructions![0]!.instructions[3]=ix(TOKEN,type,{account,mint:WSOL,owner:wallet});
 expect(temporaryWsolOwnership(tx,6).get(account)?.owner).toBe(wallet);
});
it('supports top-level create/init and rejects initialization after the consuming outer call',()=>{
 const tx=capturedTemporaryWsolTx(),setup=tx.meta!.innerInstructions![0]!;
 tx.transaction.message.instructions[2]=setup.instructions[1];tx.transaction.message.instructions[3]=setup.instructions[3];
 tx.meta!.innerInstructions=tx.meta!.innerInstructions!.slice(1);
 expect(temporaryWsolOwnership(tx,6).get(account)).toMatchObject({createdAt:{outerIndex:2,innerIndex:null},initializedAt:{outerIndex:3,innerIndex:null}});
 tx.transaction.message.instructions[7]=tx.transaction.message.instructions[3];tx.transaction.message.instructions[3]={programId:'other'};
 expect(temporaryWsolOwnership(tx,6).size).toBe(0);
});
it.each(['no create','no init','wrong create program','wrong init program','wrong mint','wrong token owner','wrong space','missing owner','owner not in keys','missing account key','init before create','duplicate init','duplicate create','failed tx','observed conflicting owner'])('declines incomplete or conflicting proof: %s',kind=>{
 const tx=capturedTemporaryWsolTx(),setup=tx.meta!.innerInstructions![0]!.instructions;
 if(kind==='no create')setup[1]={programId:'other'};
 if(kind==='no init')setup[3]={programId:'other'};
 if(kind==='wrong create program')setup[1]=ix('fake','createAccount',{newAccount:account,owner:TOKEN,space:165});
 if(kind==='wrong init program')setup[3]=ix('fake','initializeAccount3',{account,mint:WSOL,owner:wallet});
 if(kind==='wrong mint')setup[3]=ix(TOKEN,'initializeAccount3',{account,mint,owner:wallet});
 if(kind==='wrong token owner')setup[1]=ix(SYSTEM,'createAccount',{newAccount:account,owner:'other',space:165});
 if(kind==='wrong space')setup[1]=ix(SYSTEM,'createAccount',{newAccount:account,owner:TOKEN,space:170});
 if(kind==='missing owner')setup[3]=ix(TOKEN,'initializeAccount3',{account,mint:WSOL});
 if(kind==='owner not in keys')setup[3]=ix(TOKEN,'initializeAccount3',{account,mint:WSOL,owner:'unknown'});
 if(kind==='missing account key')tx.transaction.message.accountKeys[1]='other';
 if(kind==='init before create')[setup[1],setup[3]]=[setup[3],setup[1]];
 if(kind==='duplicate init')setup.push(setup[3]);
 if(kind==='duplicate create')setup.push(setup[1]);
 if(kind==='failed tx')tx.meta!.err='failed';
 if(kind==='observed conflicting owner')tx.meta!.preTokenBalances!.push({accountIndex:1,owner:'someone',mint:WSOL,uiTokenAmount:{amount:'1'}});
 expect(temporaryWsolOwnership(tx,6).size).toBe(0);
});
it.each(['closeAccount','setAuthority'])('rejects %s before or inside the consuming call, but allows close afterwards',type=>{
 for(const inside of [false,true]){
  const tx=capturedTemporaryWsolTx(),change=ix(TOKEN,type,{account,authorityType:'accountOwner',newAuthority:'other'});
  if(inside)tx.meta!.innerInstructions![1]!.instructions.unshift(change);else tx.transaction.message.instructions[4]=change;
  expect(temporaryWsolOwnership(tx,6).size).toBe(0);
 }
 expect(temporaryWsolOwnership(capturedTemporaryWsolTx(),6).has(account)).toBe(true);
});
it('does not infer ownership from transfer authority, ATA declaration, syncNative or close destination',()=>{
 const tx=capturedTemporaryWsolTx();tx.meta!.innerInstructions=tx.meta!.innerInstructions!.slice(1);
 expect(temporaryWsolOwnership(tx,6).size).toBe(0);
 expect(discoverySpendEvidence(tx,mint)).toMatchObject({status:'UNKNOWN',reason:'MISSING_ACCOUNT_MAPPING'});
});
it('rejects same-call setup, malformed grouping and opaque token instructions involving the temporary account',()=>{
 const tx=capturedTemporaryWsolTx();tx.meta!.innerInstructions![0]!.index=6;
 expect(temporaryWsolOwnership(tx,6).size).toBe(0);
 const opaque=capturedTemporaryWsolTx();opaque.transaction.message.instructions[4]={programId:TOKEN,accounts:[account],data:'undecoded'};
 expect(temporaryWsolOwnership(opaque,6).size).toBe(0);
 const same=capturedTemporaryWsolTx();same.meta!.innerInstructions![1]!.instructions.unshift({programId:TOKEN,accounts:[account],data:'undecoded'});
 expect(temporaryWsolOwnership(same,6).size).toBe(0);
});
it('does not reuse a closed account even if it is created again',()=>{
 const tx=capturedTemporaryWsolTx(),setup=tx.meta!.innerInstructions![0]!.instructions;
 setup.push(ix(TOKEN,'closeAccount',{account,destination:wallet,owner:wallet}),setup[1],setup[3]);
 expect(temporaryWsolOwnership(tx,6).size).toBe(0);
});
