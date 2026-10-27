import { expect, it } from 'vitest';
import { summarizeDiscoverySpend } from './walletDiscoverySpend';
import { discoverySpendEvidence } from '@narra/solana';
import { capturedTemporaryWsol, capturedTemporaryWsolTx } from '../../../packages/solana/src/wsol-ownership.fixture';
const now=new Date('2040-01-01T00:00:00Z');
const observation=(tokenId:string,quoteLamports='30000')=>({tokenId,signature:'sig',at:now.toISOString(),spendEvidence:{version:1,status:'MATCHED_TRANSFERS',source:'RPC_PARSED_INNER_TRANSFERS',quoteAsset:'SOL',quoteLamports,tokenAmountRaw:'100',outerInstructionIndex:0,counterparty:'pool',programId:'program'}});
it('keeps a precise matched-only median and deduplicates tokens rather than counting extra legs',()=>{
 expect(summarizeDiscoverySpend([observation('a'),observation('a','100000000'),observation('b','27462')],now)).toMatchObject({observedTokens:2,matchedTokens:2,unknownTokens:0,medianMatchedQuoteSol:'0.000028731',minMatchedQuoteSol:'0.000027462',maxMatchedQuoteSol:'0.00003'});
});
it('keeps legacy, missing provenance, and unsupported samples in the denominator',()=>{
 const legacy={tokenId:'legacy',signature:'sig',at:now.toISOString(),spendEvidence:undefined};
 const unsupported={...observation('unsupported'),spendEvidence:{version:1,status:'UNKNOWN',reason:'NO_MATCHED_QUOTE_TRANSFER'}};
 const missing={...observation('missing'),at:null};
 expect(summarizeDiscoverySpend([observation('known'),legacy,unsupported,missing],now)).toEqual({version:1,observedTokens:4,matchedTokens:1,unknownTokens:3,medianMatchedQuoteSol:'0.00003',minMatchedQuoteSol:'0.00003',maxMatchedQuoteSol:'0.00003',unknownReasons:{LEGACY_NO_SPEND_EVIDENCE:1,NO_MATCHED_QUOTE_TRANSFER:1,MISSING_PROVENANCE:1}});
 expect(summarizeDiscoverySpend([legacy],now).medianMatchedQuoteSol).toBeNull();
});
it('rejects future timestamps and invalid evidence rather than upgrading them to known size',()=>{
 const future={...observation('future'),at:new Date(+now+1).toISOString()};
 expect(summarizeDiscoverySpend([future,observation('invalid','no amount')],now)).toMatchObject({matchedTokens:0,unknownTokens:2,medianMatchedQuoteSol:null,unknownReasons:{MISSING_PROVENANCE:1,INVALID_SPEND_EVIDENCE:1}});
});
it('retains half-lamport precision when averaging large raw amounts',()=>{
 expect(summarizeDiscoverySpend([observation('a','18446744073709551615'),observation('b','18446744073709551614')],now).medianMatchedQuoteSol).toBe('18446744073.7095516145');
});
it('retains the unknown denominator when recovered WSOL ownership exposes an unsupported received token',()=>{
 const tx=capturedTemporaryWsolTx(),spendEvidence=discoverySpendEvidence(tx,capturedTemporaryWsol.mint);
 expect(spendEvidence.recoveredWsolAccounts).toHaveLength(1);
 const result=summarizeDiscoverySpend([{tokenId:'captured',signature:'2ypTZHmoojTLyiqKYwrhyjVsegZY4TaVyEUVvnacACwQpoF76qjE9MoY6Lb4RAinDTnD9hrPZXTrgXVS2j7twC1S',at:new Date(tx.blockTime!*1000).toISOString(),spendEvidence}],now);
 expect(result).toMatchObject({matchedTokens:0,unknownTokens:1,medianMatchedQuoteSol:null,unknownReasons:{UNSUPPORTED_TOKEN_PROGRAM:1}});
});
