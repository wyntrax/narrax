import type { ParsedTx } from './rpc';

/** Reduced RPC evidence captured read-only from mainnet on 2026-10-27.
 * Signature: 2ypTZHmoojTLyiqKYwrhyjVsegZY4TaVyEUVvnacACwQpoF76qjE9MoY6Lb4RAinDTnD9hrPZXTrgXVS2j7twC1S
 * Retains original outer indexes, balance account indexes, amounts, owners and
 * lifecycle instructions, token-program IDs and decimals. Compute data, route
 * data and logs are omitted. This is NOT a full transaction fixture.
 */
export const capturedTemporaryWsol = {
  wallet:'1ZG7dU8ncaHhysdK7J1A7z33oJpEaEwuAuPuUVfQnXZ',
  account:'F9R648F2Rnp5DvsRMKahGwCakWaS634YMMzVpDaukfJS',
  mint:'4baaC4quyt9LioPXQrrfa4ug3zdoFS5wjUqhLvouW8Un',
};
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',TOKEN2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM='11111111111111111111111111111111',WSOL='So11111111111111111111111111111111111111112';
const ATA='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',JUP='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const {wallet,account,mint}=capturedTemporaryWsol;
const receiving='3Gsc1tVUNdWaVm1RELK5p5qNc37de6DeznDTvTw8dr67',poolQuote='EZnUgnMaZZduM33Sn91EFCL11UUinNwut5NBgw7JTzF2';
const poolToken='HYDbM78zSnmL5hRnXgDkuZPwhAgiDnPboQGgAWbCsDPs',pool='HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC';
const ix=(programId:string,type:string,info:Record<string,unknown>)=>({programId,parsed:{type,info}});
const bal=(accountIndex:number,owner:string,mint:string,amount:string)=>({accountIndex,owner,mint,programId:mint===WSOL?TOKEN:TOKEN2022,uiTokenAmount:{amount,decimals:mint===WSOL?9:6}});
export function capturedTemporaryWsolTx():ParsedTx {
 return {blockTime:1793108448,transaction:{message:{
  accountKeys:[wallet,account,receiving,'ExdsEY28VZGPJgsgTvQRWnPUL75ZJ6rdGsh8agoptPZ9',poolQuote,poolToken,
   'ComputeBudget111111111111111111111111111111',ATA,SYSTEM,TOKEN,mint,TOKEN2022,JUP,'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf',WSOL,
   'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',pool,'3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet'],
  instructions:[{programId:'ComputeBudget111111111111111111111111111111'},{programId:'ComputeBudget111111111111111111111111111111'},
   ix(ATA,'createIdempotent',{account,mint:WSOL,wallet,source:wallet,tokenProgram:TOKEN,systemProgram:SYSTEM}),
   ix(SYSTEM,'transfer',{source:wallet,destination:account,lamports:1599244}),ix(TOKEN,'syncNative',{account}),
   ix(ATA,'createIdempotent',{account:receiving,mint,wallet,source:wallet,tokenProgram:TOKEN2022,systemProgram:SYSTEM}), {programId:JUP},ix(TOKEN,'closeAccount',{account,destination:wallet,owner:wallet})]}},
  meta:{err:null,preTokenBalances:[bal(4,pool,WSOL,'85005158992'),bal(5,pool,mint,'999821688286948')],
   postTokenBalances:[bal(2,wallet,mint,'18807903081'),bal(4,pool,WSOL,'85006758236'),bal(5,pool,mint,'999802880383867')],
   innerInstructions:[{index:2,instructions:[ix(TOKEN,'getAccountDataSize',{extensionTypes:['immutableOwner'],mint:WSOL}),
    ix(SYSTEM,'createAccount',{source:wallet,newAccount:account,owner:TOKEN,space:165,lamports:1488440}),
    ix(TOKEN,'initializeImmutableOwner',{account}),ix(TOKEN,'initializeAccount3',{account,mint:WSOL,owner:wallet})]},
    {index:5,instructions:[ix(TOKEN2022,'getAccountDataSize',{extensionTypes:['immutableOwner'],mint}),
     ix(SYSTEM,'createAccount',{source:wallet,newAccount:receiving,owner:TOKEN2022,space:170,lamports:1513840}),
     ix(TOKEN2022,'initializeImmutableOwner',{account:receiving}),ix(TOKEN2022,'initializeAccount3',{account:receiving,mint,owner:wallet})]},
    {index:6,instructions:[
     ix(TOKEN,'transferChecked',{authority:wallet,source:account,destination:poolQuote,mint:WSOL,tokenAmount:{amount:'1599244',decimals:9}}),
     ix(TOKEN2022,'transferChecked',{authority:pool,source:poolToken,destination:receiving,mint,tokenAmount:{amount:'18807903081',decimals:6}}),
    ]}]}};
}
