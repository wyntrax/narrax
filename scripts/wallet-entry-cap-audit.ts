import { parseArgs } from 'node:util';
import { createPrisma } from '@narra/database';
import { EntryCapAuditOptions, readEntryCapCoverageAudit } from '../workers/pipeline/src/walletEntryCapAudit';

const {values}=parseArgs({options:{'wallet-limit':{type:'string',default:'5'},'entry-limit':{type:'string',default:'100'},wallet:{type:'string'},
  'after-wallet':{type:'string'},'after-entry':{type:'string'},'as-of':{type:'string'}}});
const options=EntryCapAuditOptions.parse({walletLimit:Number(values['wallet-limit']),entryLimit:Number(values['entry-limit']),
  wallet:values.wallet,afterWallet:values['after-wallet'],afterEntry:values['after-entry']});
const now=values['as-of']?new Date(values['as-of']):new Date();
if(!Number.isFinite(+now))throw new Error('Invalid --as-of');
const url=new URL(process.env.DATABASE_URL??'invalid:');
url.searchParams.set('options','-c default_transaction_read_only=on -c statement_timeout=20000');
const db=createPrisma(url.toString());
readEntryCapCoverageAudit(db,now,options).then(result=>console.log(JSON.stringify(result,null,2)))
  .catch(()=>{console.error('Entry-cap audit failed. No data was changed.');process.exitCode=1;}).finally(()=>db.$disconnect());
