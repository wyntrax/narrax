import { parseArgs } from 'node:util';
import { createPrisma } from '@narra/database';
import { isSolanaAddress } from '@narra/shared';
import { reconcileWalletValuations } from '../workers/pipeline/src/walletValuationRepair';

// One bounded page per invocation. Dry-run uses a database-enforced read-only connection.
const {values}=parseArgs({options:{apply:{type:'boolean',default:false},limit:{type:'string',default:'100'},after:{type:'string'},wallet:{type:'string'},'as-of':{type:'string'}}});
const limit=Number(values.limit),now=values['as-of']?new Date(values['as-of']):new Date();
if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isFinite(+now))throw new Error('Use --limit=1..500 and a valid --as-of date');
if(values.wallet&&!isSolanaAddress(values.wallet))throw new Error('Invalid --wallet address');
const url=new URL(process.env.DATABASE_URL??'invalid:');
if(!values.apply)url.searchParams.set('options','-c default_transaction_read_only=on -c statement_timeout=20000');
const db=createPrisma(url.toString());
reconcileWalletValuations(db,now,{apply:values.apply,limit,after:values.after,wallet:values.wallet})
  .then(result=>console.log(JSON.stringify(result,null,2)))
  .catch(()=>{console.error('Wallet valuation reconciliation failed; no provider requests were made.');process.exitCode=1;})
  .finally(()=>db.$disconnect());
