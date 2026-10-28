import { parseArgs } from 'node:util';
import { createPrisma } from '@narra/database';
import { AdmissionPreviewOptions } from '../workers/pipeline/src/walletAdmissionPreview';
import { readWalletAdmissionPreview } from '../workers/pipeline/src/walletAdmissionPreviewRead';

const {values}=parseArgs({options:{
  'min-quote-sol':{type:'string',default:'0.01'},'min-matched-tokens':{type:'string',default:'2'},
  'min-coverage-percent':{type:'string',default:'100'},'exploration-slots':{type:'string',default:'1'},
}});
const options=AdmissionPreviewOptions.parse({minQuoteSol:values['min-quote-sol'],minMatchedTokens:Number(values['min-matched-tokens']),
  minCoveragePercent:Number(values['min-coverage-percent']),explorationSlots:Number(values['exploration-slots'])});
const u=new URL(process.env.DATABASE_URL??'invalid:');
u.searchParams.set('options','-c default_transaction_read_only=on -c statement_timeout=20000');
const db=createPrisma(u.toString());
readWalletAdmissionPreview(db,new Date(),options).then(report=>console.log(JSON.stringify(report,null,2)))
  .catch(()=>{console.error('Admission preview failed. No data was changed.');process.exitCode=1;}).finally(()=>db.$disconnect());
