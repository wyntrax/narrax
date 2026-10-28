import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@narra/database';
import { WALLET_INTAKE_LIMITS } from '@narra/worker-pipeline';

/** Public aggregate counts only. No wallet identities, narrative rows or private research. */
export function registerPublicResearchSnapshot(app:FastifyInstance,db:PrismaClient,clock:()=>Date){
  async function load(){
    const at=clock(),since=new Date(+at-86400000);
    const [top,activeNarratives,trackedWallets,discoveredWallets,opportunities24h]=await Promise.all([
      db.narrative.findMany({where:{stage:{not:'DEAD'}},orderBy:[{score:'desc'},{id:'asc'}],take:5,
        select:{score:true,metrics:{where:{at:{lte:at}},orderBy:{at:'desc'},take:1,select:{at:true}}}}),
      db.narrative.count({where:{stage:{not:'DEAD'}}}),
      db.trackedWallet.count({where:{active:true}}),
      db.trackedWallet.count({where:{active:true,source:'DISCOVERED',researchReview:{not:'REJECTED'}}}),
      db.opportunity.count({where:{createdAt:{gte:since,lte:at}}}),
    ]);
    const stamps=top.map(n=>n.metrics[0]?.at);
    return {at:at.toISOString(),narrativeHeat:top.length?Math.round(top.reduce((s,n)=>s+n.score,0)/top.length):null,
      narrativeSampleSize:top.length,narrativeAsOf:stamps.length&&stamps.every(Boolean)?new Date(Math.min(...stamps.map(t=>+t!))).toISOString():null,
      activeNarratives,trackedWallets,discoveredWallets,discoveryCapacity:WALLET_INTAKE_LIMITS.capacity,opportunities24h};
  }
  let cached:ReturnType<typeof load>|undefined,expires=0;
  app.get('/v1/public-research-snapshot',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async(_req,reply)=>{
    if(!cached||+clock()>=expires){
      expires=+clock()+30000;
      const pending=load();cached=pending;
      void pending.catch(()=>{if(cached===pending){cached=undefined;expires=0;}});
    }
    const result=await cached;
    reply.header('Cache-Control','public, max-age=30');
    return result;
  });
}
