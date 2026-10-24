import {parseArgs} from 'node:util';
import {createPrisma} from '@narra/database';
import {earlyRadarReport} from '../workers/pipeline/src/earlyRadarTracking';
async function main(){
  const {values}=parseArgs({options:{from:{type:'string'},to:{type:'string'}}});
  const to=values.to?new Date(values.to):new Date(),from=values.from?new Date(values.from):new Date(+to-30*86400000);
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
  const db=createPrisma();
  try{console.log(JSON.stringify(await earlyRadarReport(db,from,to),null,2));}finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Early radar report failed; check database migration and date range.');process.exitCode=1;});
