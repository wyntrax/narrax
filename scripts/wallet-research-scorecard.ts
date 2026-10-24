import {createPrisma} from '@narra/database';
import {summarizeWalletResearch} from '@narra/analytics';
const db=createPrisma();
async function main(){
 const now=new Date();
 // Ascending cap retains earliest evidence; truncation is explicit, never silently a complete cohort.
 const rows=await db.walletResearchSignal.findMany({where:{createdAt:{lte:now}},orderBy:[{createdAt:'asc'},{id:'asc'}],take:10001,include:{measurements:true}});
 console.log(JSON.stringify({asOf:now.toISOString(),read:Math.min(rows.length,10000),truncated:rows.length>10000,note:'Gross token-price changes, not wallet PnL. Qualification thresholds are unvalidated. SELL returns are not inverted. Missing and pending horizons remain in the denominator.',cohorts:summarizeWalletResearch(rows.slice(0,10000))},null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1;}).finally(()=>db.$disconnect());
