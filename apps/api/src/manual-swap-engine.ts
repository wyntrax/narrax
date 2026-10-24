import {Connection,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,ComputeBudgetProgram,type AddressLookupTableAccount} from '@solana/web3.js';
import {ed25519} from '@noble/curves/ed25519';
import bs58 from 'bs58';
import {z} from 'zod';
import {SolanaRpc,WSOL_MINT} from '@narra/solana';
import {DEFAULT_TX_LIMITS,TOKEN_PROGRAM,JUPITER_V6_PROGRAM,associatedTokenAddress,verifySwapTransaction,verifySimulation} from '@narra/tx-verify';
import {TradeQuote,type TradeQuoteData,tradeBaseUnits} from '@narra/shared';

export class SwapError extends Error {constructor(readonly code:string,readonly status=409){super(code);}}
const fail=(code:string):never=>{throw new SwapError(code);};
const MAINNET='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const u64=z.string().regex(/^\d{1,20}$/);
const ix=z.object({programId:z.string(),accounts:z.array(z.object({pubkey:z.string(),isSigner:z.boolean(),isWritable:z.boolean()})).max(100),data:z.string().max(4000)});
export const BuildResponse=z.object({inputMint:z.string(),outputMint:z.string(),inAmount:u64,outAmount:u64,otherAmountThreshold:u64,swapMode:z.literal('ExactIn'),slippageBps:z.number().int(),priceImpactPct:z.union([z.string(),z.number()]).optional(),transactionVersion:z.union([z.literal(0),z.literal('0')]).optional(),computeBudgetInstructions:z.array(ix).max(3),setupInstructions:z.array(ix).max(8),swapInstruction:ix,cleanupInstruction:ix.nullable(),otherInstructions:z.array(ix).max(4),tipInstruction:ix.nullable(),addressesByLookupTableAddress:z.record(z.array(z.string())).nullable(),blockhashWithMetadata:z.object({blockhash:z.array(z.number().int().min(0).max(255)).length(32),lastValidBlockHeight:z.number().int().positive()})});
type Build=z.infer<typeof BuildResponse>;
export type SwapInput={wallet:string;mint:string;side:'BUY'|'SELL';amount:string;slippageBps:number};
export type PreparedSwap={transaction:string;quote:TradeQuoteData;lastValidBlockHeight:number};
export interface ManualSwapEngine {
 readonly enabled?:boolean;
 balances(wallet:string,mint:string):Promise<{sol:string;token:string;decimals:number}>;
 prepare(input:SwapInput):Promise<PreparedSwap>;
 recheck(transaction:string,wallet:string,side:'BUY'|'SELL',quote:TradeQuoteData):Promise<void>;
 send(signed:string):Promise<string>;
 status(signature:string):Promise<'SUBMITTED'|'CONFIRMED'|'FAILED'>;
}
const instruction=(v:z.infer<typeof ix>)=>new TransactionInstruction({programId:new PublicKey(v.programId),keys:v.accounts.map(a=>({...a,pubkey:new PublicKey(a.pubkey)})),data:Buffer.from(v.data,'base64')});

/** Jupiter Swap V2 `/build` returns one of two exact-in instructions. Both put inAmount/u64,
 * quotedOut/u64, slippage/u16 and platformFee/u8 immediately after the discriminator (and, for the
 * shared-account form, the shared id/u8). Older `route`/`shared_accounts_route` and any future
 * instruction fail closed until their layout is reviewed against live builds. */
const ROUTE_V2 = 'bb64facc31c4af14';
const SHARED_ROUTE_V2 = 'd19853937cfed8e9';
export function verifyRoute(v:TransactionInstruction,wallet:string,q:TradeQuoteData){
 const data=v.data,discriminator=data.subarray(0,8).toString('hex'),shared=discriminator===SHARED_ROUTE_V2;
 if(v.programId.toBase58()!==JUPITER_V6_PROGRAM||(!shared&&discriminator!==ROUTE_V2))fail('UNSUPPORTED_ROUTE');
 const base=shared?9:8;
 // The fixed prefix must be present and the route data must be non-empty. The route itself is opaque.
 if(data.length<base+19+5)fail('UNSUPPORTED_ROUTE');
 if(data.readBigUInt64LE(base)!==BigInt(q.inAmount)||data.readBigUInt64LE(base+8)!==BigInt(q.outAmount)||data.readUInt16LE(base+16)!==q.slippageBps||data[base+18]!==0)fail('TRANSACTION_MISMATCH');
 const key=(n:number)=>v.keys[n]?.pubkey.toBase58();
 // route_v2: [wallet, source ATA, destination ATA, input mint, output mint, ...]
 // shared route_v2: [shared authority, wallet, source ATA, destination ATA, .., input mint, output mint, ...]
 const walletAt=shared?1:0,sourceAt=shared?2:1,destinationAt=shared?3:2,inputMintAt=shared?6:3,outputMintAt=shared?7:4;
 if(key(walletAt)!==wallet||key(sourceAt)!==associatedTokenAddress(wallet,q.inputMint)||key(destinationAt)!==associatedTokenAddress(wallet,q.outputMint)||key(inputMintAt)!==q.inputMint||key(outputMintAt)!==q.outputMint)fail('TRANSACTION_MISMATCH');
 const out=BigInt(q.outAmount),min=BigInt(q.minOut);
 if(min<=0n||min>out||min<out*BigInt(10000-q.slippageBps)/10000n)fail('TRANSACTION_MISMATCH');
}

/** A wallet signs exactly the stored message. A forged signature or a wallet-modified transaction is never relayed. */
export function verifySignedSwap(unsigned:string,signed:string,wallet:string):string{
 try{
  const original=VersionedTransaction.deserialize(Buffer.from(unsigned,'base64')),tx=VersionedTransaction.deserialize(Buffer.from(signed,'base64'));
  if(!Buffer.from(tx.message.serialize()).equals(Buffer.from(original.message.serialize()))||tx.signatures.length!==1||tx.message.staticAccountKeys[0]?.toBase58()!==wallet||!ed25519.verify(tx.signatures[0]!,tx.message.serialize(),new PublicKey(wallet).toBytes()))return fail('INVALID_SIGNATURE');
  return bs58.encode(tx.signatures[0]!);
 }catch{return fail('INVALID_SIGNATURE');}
}

export function makeManualSwapEngine(apiKey:string,rpcUrl:string,enabled=false):ManualSwapEngine{
 // Timeouts and no automatic 429 replay. Provider keys are server-only.
 const boundedFetch:typeof fetch=(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(8000)});
 const chain=new Connection(rpcUrl,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:boundedFetch}),rpc=new SolanaRpc({url:rpcUrl,timeoutMs:8000});
 async function mainnet(){if(await chain.getGenesisHash()!==MAINNET)fail('WRONG_NETWORK');}
 async function token(mint:string,side?:'BUY'|'SELL'){
  const info=await rpc.getMintInfo(mint);
  if(info.program!==TOKEN_PROGRAM||info.hasExtensions||info.decimals<0||info.decimals>9)fail('UNSUPPORTED_TOKEN');
  if(side==='BUY'&&info.freezeAuthority)fail('FREEZE_AUTHORITY');
  return info;
 }
 async function tables(tx:VersionedTransaction):Promise<AddressLookupTableAccount[]>{
  if(tx.message.addressTableLookups.length>DEFAULT_TX_LIMITS.maxLookupTables)fail('UNSUPPORTED_ROUTE');
  return Promise.all(tx.message.addressTableLookups.map(async l=>{const t=(await chain.getAddressLookupTable(l.accountKey)).value;if(!t||!t.isActive())return fail('UNSUPPORTED_ROUTE');return t;}));
 }
 async function inspect(transaction:string,wallet:string,side:'BUY'|'SELL',q:TradeQuoteData){
  const tx=VersionedTransaction.deserialize(Buffer.from(transaction,'base64')),alts=await tables(tx);
  const message=tx.message;
  const keys=message.getAccountKeys({addressLookupTableAccounts:alts});
  const resolved=keys.accountKeysFromLookups;
  const verdict=verifySwapTransaction(transaction,{userWallet:wallet,side,inputMint:q.inputMint,outputMint:q.outputMint,inAmount:BigInt(q.inAmount),limits:DEFAULT_TX_LIMITS,...(resolved?{resolvedLookupKeys:{writable:resolved.writable.map(k=>k.toBase58()),readonly:resolved.readonly.map(k=>k.toBase58())}}:{})});
  if(!verdict.ok||!verdict.summary.derived)fail('UNSUPPORTED_ROUTE');
  const decompiled=TransactionMessage.decompile(message,{addressLookupTableAccounts:alts});
  const swap=decompiled.instructions.find(i=>i.programId.toBase58()===JUPITER_V6_PROGRAM);if(!swap)fail('UNSUPPORTED_ROUTE');
  verifyRoute(swap!,wallet,q);
  // Never close a pre-existing nonzero WSOL account as an incidental side effect.
  const d=verdict.summary.derived!,addresses=[wallet,d.inputAccount,d.outputAccount];
  const before=await rpc.getAccounts(addresses);
  const wrapped=before[side==='BUY'?1:2];
  if(wrapped&&Buffer.from(wrapped.data,'base64').length>=72&&Buffer.from(wrapped.data,'base64').readBigUInt64LE(64)>0n)fail('EXISTING_WRAPPED_SOL');
  const sim=await rpc.simulateTransaction(transaction,addresses);
  const effect=verifySimulation({err:sim.err,unitsConsumed:sim.unitsConsumed,pre:{wallet:before[0]??null,inputAccount:before[1]??null,outputAccount:before[2]??null},post:{wallet:sim.accounts[0]??null,inputAccount:sim.accounts[1]??null,outputAccount:sim.accounts[2]??null}},{side,inAmount:BigInt(q.inAmount),minOutAmount:BigInt(q.minOut),maxOverheadLamports:DEFAULT_TX_LIMITS.maxOverheadLamports,maxComputeUnits:DEFAULT_TX_LIMITS.maxComputeUnits});
  if(!effect.ok)fail('SIMULATION_FAILED');
  return {tx,priority:verdict.summary.priorityFeeLamports??'0'};
 }
 return {
  enabled,
  async balances(wallet,mint){await mainnet();const info=await token(mint);const [sol,units]=await Promise.all([rpc.getBalanceLamports(wallet),rpc.getTokenBaseUnits(wallet,mint)]);return {sol:String(sol),token:String(units),decimals:info.decimals};},
  async prepare(input){
   await mainnet();const info=await token(input.mint,input.side),buy=input.side==='BUY';
   const amount=tradeBaseUnits(input.amount,buy?9:info.decimals);
   const query=new URLSearchParams({inputMint:buy?WSOL_MINT:input.mint,outputMint:buy?input.mint:WSOL_MINT,amount:String(amount),taker:input.wallet,slippageBps:String(input.slippageBps),transactionVersion:'0',maxAccounts:'48'});
   const res=await boundedFetch(`https://api.jup.ag/swap/v2/build?${query}`,{headers:{'x-api-key':apiKey}});
   if(!res.ok)fail(res.status===429?'RATE_LIMITED':'QUOTE_UNAVAILABLE');
   const b:Build=BuildResponse.parse(await res.json());
   if(b.inputMint!==query.get('inputMint')||b.outputMint!==query.get('outputMint')||b.inAmount!==String(amount)||b.slippageBps!==input.slippageBps||BigInt(b.outAmount)<=0n||BigInt(b.otherAmountThreshold)<=0n||BigInt(b.otherAmountThreshold)>BigInt(b.outAmount)||b.tipInstruction)fail('TRANSACTION_MISMATCH');
   // /build OpenAPI defines a decimal ratio: "0.001" means 0.1%.
   const impact=b.priceImpactPct===undefined?null:Math.abs(Number(b.priceImpactPct))*100;
   if(impact!==null&&(!Number.isFinite(impact)||impact>3))fail('PRICE_IMPACT');
   const q=TradeQuote.parse({inputMint:b.inputMint,outputMint:b.outputMint,inAmount:b.inAmount,outAmount:b.outAmount,minOut:b.otherAmountThreshold,inputDecimals:buy?9:info.decimals,outputDecimals:buy?info.decimals:9,slippageBps:b.slippageBps,priceImpactPct:impact,networkFeeLamports:'0',priorityFeeLamports:'0',maxOverheadLamports:String(DEFAULT_TX_LIMITS.maxOverheadLamports)});
   const swap=instruction(b.swapInstruction);verifyRoute(swap,input.wallet,q);
   const names=Object.keys(b.addressesByLookupTableAddress??{});if(names.length>4)fail('UNSUPPORTED_ROUTE');
   // Fetch real ALTs. The builder's claimed address lists are not trusted.
   const alts=await Promise.all(names.map(async key=>{const a=(await chain.getAddressLookupTable(new PublicKey(key))).value;if(!a||!a.isActive())return fail('UNSUPPORTED_ROUTE');return a;}));
   const budget=b.computeBudgetInstructions.map(instruction),hasLimit=budget.some(i=>i.data[0]===2);
   const msg=new TransactionMessage({payerKey:new PublicKey(input.wallet),recentBlockhash:bs58.encode(Uint8Array.from(b.blockhashWithMetadata.blockhash)),instructions:[...(hasLimit?[]:[ComputeBudgetProgram.setComputeUnitLimit({units:DEFAULT_TX_LIMITS.maxComputeUnits})]),...budget,...b.setupInstructions.map(instruction),swap,...(b.cleanupInstruction?[instruction(b.cleanupInstruction)]:[]),...b.otherInstructions.map(instruction)]}).compileToV0Message(alts);
   const tx=new VersionedTransaction(msg),transaction=Buffer.from(tx.serialize()).toString('base64');
   const result=await inspect(transaction,input.wallet,input.side,q);
   const fee=(await chain.getFeeForMessage(msg,'confirmed')).value;if(fee===null||fee>Number(DEFAULT_TX_LIMITS.maxOverheadLamports))fail('QUOTE_UNAVAILABLE');
   q.networkFeeLamports=String(fee);q.priorityFeeLamports=result.priority;
   return {transaction,quote:q,lastValidBlockHeight:b.blockhashWithMetadata.lastValidBlockHeight};
  },
  async recheck(transaction,wallet,side,q){await mainnet();await token(side==='BUY'?q.outputMint:q.inputMint,side);await inspect(transaction,wallet,side,q);},
  async send(signed){await mainnet();return chain.sendRawTransaction(Buffer.from(signed,'base64'),{skipPreflight:false,maxRetries:0,preflightCommitment:'confirmed'});},
  async status(signature){await mainnet();const s=(await chain.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];return !s?'SUBMITTED':s.err?'FAILED':s.confirmationStatus==='confirmed'||s.confirmationStatus==='finalized'?'CONFIRMED':'SUBMITTED';},
 };
}
