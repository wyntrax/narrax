import { z } from 'zod';
import type { ParsedTx } from './rpc';

export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM = '11111111111111111111111111111111';
const unsigned = z.string().regex(/^\d{1,20}$/).refine(v => /^\d{1,20}$/.test(v) && BigInt(v) <= 18_446_744_073_709_551_615n);
export const Token2022TransferEvidence = z.object({
  programId:z.literal(TOKEN_2022_PROGRAM),sourceAccount:z.string().min(1),destinationAccount:z.string().min(1),
  decimals:z.number().int().min(0).max(255),amountRaw:unsigned,
  sourcePreRaw:unsigned,sourcePostRaw:unsigned,destinationPreRaw:unsigned,destinationPostRaw:unsigned,
  destinationPreEvidence:z.enum(['BALANCE_SNAPSHOT','CREATED_AND_INITIALIZED']),
});
export type Token2022TransferEvidence = z.infer<typeof Token2022TransferEvidence>;
type Failure = 'TOKEN_2022_BALANCE_EVIDENCE_MISSING' | 'TOKEN_2022_AMOUNT_MISMATCH' | 'TOKEN_2022_LIFECYCLE_AMBIGUOUS';
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const key=(k:ParsedTx['transaction']['message']['accountKeys'][number])=>typeof k==='string'?k:k.pubkey;

/** Only an ordinary checked received-token transfer whose gross amount equals
 * both raw source decrease and raw destination increase. No fee estimates,
 * extension assumptions, or current mint/account lookups. This does not certify
 * that a mint has no extensions or that the instruction is part of a DEX swap.
 */
export function token2022TransferEvidence(tx:ParsedTx,info:Record<string,unknown>,outerIndex:number):{evidence:Token2022TransferEvidence}|{reason:Failure}{
  const missing=():{reason:Failure}=>({reason:'TOKEN_2022_BALANCE_EVIDENCE_MISSING'});
  if(!tx.meta||tx.meta.err!=null||typeof info.source!=='string'||typeof info.destination!=='string'||typeof info.mint!=='string'||info.source===info.destination)return missing();
  const tokenAmount=object(info.tokenAmount),amount=unsigned.safeParse(tokenAmount.amount);
  const decimals=tokenAmount.decimals;
  if(!amount.success||BigInt(amount.data)===0n||typeof decimals!=='number'||!Number.isInteger(decimals)||decimals<0||decimals>255)return missing();
  const keys=tx.transaction.message.accountKeys.map(key),sourceIndex=keys.indexOf(info.source),destIndex=keys.indexOf(info.destination);
  if(sourceIndex<0||destIndex<0)return missing();
  const balance=(rows:NonNullable<NonNullable<ParsedTx['meta']>['preTokenBalances']>,index:number)=>{
    const matches=rows.filter(b=>b.accountIndex===index);
    if(matches.length!==1)return null;
    const b=matches[0]!,raw=unsigned.safeParse(b.uiTokenAmount.amount);
    return b.programId===TOKEN_2022_PROGRAM&&b.mint===info.mint&&b.owner&&b.uiTokenAmount.decimals===decimals&&raw.success?{owner:b.owner,amount:raw.data}:null;
  };
  const pre=tx.meta.preTokenBalances??[],post=tx.meta.postTokenBalances??[];
  const sourcePre=balance(pre,sourceIndex),sourcePost=balance(post,sourceIndex),destPost=balance(post,destIndex),destPre=balance(pre,destIndex);
  if(!sourcePre||!sourcePost||!destPost||sourcePre.owner!==sourcePost.owner||destPre&&destPre.owner!==destPost.owner)return missing();
  // Missing is not zero unless this transaction proves creation and initialization.
  if(!destPre&&pre.some(b=>b.accountIndex===destIndex))return missing();
  let created=false,initialized=false,ambiguous=false,transfers=0;
  const groups=new Map<number,unknown[]>();
  for(const g of tx.meta.innerInstructions??[]){
    if(typeof g.index!=='number'||!Number.isInteger(g.index)||g.index<0||g.index>=tx.transaction.message.instructions.length||groups.has(g.index))return {reason:'TOKEN_2022_LIFECYCLE_AMBIGUOUS'};
    groups.set(g.index,g.instructions);
  }
  const visit=(item:unknown,index:number)=>{
    const ix=object(item),p=object(ix.parsed),i=object(p.info);
    if(ix.programId===SYSTEM&&['createAccount','createAccountWithSeed'].includes(String(p.type))&&i.newAccount===info.destination){
      if(created||index>=outerIndex||i.owner!==TOKEN_2022_PROGRAM||typeof i.space!=='number'||!Number.isSafeInteger(i.space)||i.space<165)ambiguous=true;
      created=true;return;
    }
    if(ix.programId!==TOKEN_2022_PROGRAM)return;
    const touched=i.account===info.source||i.account===info.destination||i.source===info.source||i.source===info.destination||i.destination===info.source||i.destination===info.destination||
      Array.isArray(ix.accounts)&&ix.accounts.some(a=>a===info.source||a===info.destination);
    if(!touched)return;
    if(p.type==='transferChecked'&&i.source===info.source&&i.destination===info.destination&&index===outerIndex){transfers++;return;}
    if(['initializeAccount','initializeAccount2','initializeAccount3'].includes(String(p.type))&&i.account===info.destination){
      if(!created||initialized||index>=outerIndex||i.mint!==info.mint||i.owner!==destPost.owner||destPre)ambiguous=true;
      initialized=true;return;
    }
    if(p.type==='initializeImmutableOwner'&&i.account===info.destination&&created&&!initialized&&index<outerIndex)return;
    // Extra legs, mint/burn, fees, closure, authority changes, or opaque token
    // operations touching either account invalidate whole-transaction attribution.
    ambiguous=true;
  };
  for(let index=0;index<tx.transaction.message.instructions.length;index++){
    visit(tx.transaction.message.instructions[index],index);
    for(const ix of groups.get(index)??[])visit(ix,index);
  }
  if(ambiguous||transfers!==1)return {reason:'TOKEN_2022_LIFECYCLE_AMBIGUOUS'};
  if(!destPre&&(!created||!initialized))return missing();
  const destinationPreRaw=destPre?.amount??'0';
  if(BigInt(sourcePre.amount)-BigInt(sourcePost.amount)!==BigInt(amount.data)||BigInt(destPost.amount)-BigInt(destinationPreRaw)!==BigInt(amount.data))return {reason:'TOKEN_2022_AMOUNT_MISMATCH'};
  return {evidence:{programId:TOKEN_2022_PROGRAM,sourceAccount:info.source,destinationAccount:info.destination,decimals,amountRaw:amount.data,
    sourcePreRaw:sourcePre.amount,sourcePostRaw:sourcePost.amount,destinationPreRaw,destinationPostRaw:destPost.amount,
    destinationPreEvidence:destPre?'BALANCE_SNAPSHOT':'CREATED_AND_INITIALIZED'}};
}
