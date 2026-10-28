import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import {expect,it,vi} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {registerPublicResearchSnapshot} from './publicResearchSnapshot';

async function setup(){
 let now=new Date('2040-01-01T12:00:00Z');
 const db={narrative:{findMany:vi.fn().mockResolvedValue([{score:36,metrics:[{at:new Date(+now-120000)}]},{score:34,metrics:[{at:new Date(+now-60000)}]}]),count:vi.fn().mockResolvedValue(7)},
  trackedWallet:{count:vi.fn().mockResolvedValueOnce(203).mockResolvedValue(200)},opportunity:{count:vi.fn().mockResolvedValue(17)}};
 const app=Fastify();await app.register(rateLimit,{global:false});registerPublicResearchSnapshot(app,db as unknown as PrismaClient,()=>now);
 return {app,db,advance:()=>{now=new Date(+now+31000);}};
}
it('serves only aggregate fields anonymously and keeps count time separate from narrative observations',async()=>{
 const {app,db}=await setup();try{
  const res=await app.inject('/v1/public-research-snapshot');expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({at:'2040-01-01T12:00:00.000Z',narrativeHeat:35,narrativeSampleSize:2,narrativeAsOf:'2040-01-01T11:58:00.000Z',activeNarratives:7,trackedWallets:203,discoveredWallets:200,discoveryCapacity:200,opportunities24h:17});
  expect(db.opportunity.count).toHaveBeenCalledWith({where:{createdAt:{gte:new Date('2039-12-31T12:00:00Z'),lte:new Date('2040-01-01T12:00:00Z')}}});
  expect(res.headers['cache-control']).toBe('public, max-age=30');
 }finally{await app.close();}
});
it('coalesces cached requests, expires the snapshot, and rate limits public reads',async()=>{
 const {app,db,advance}=await setup();try{
  await Promise.all([app.inject('/v1/public-research-snapshot'),app.inject('/v1/public-research-snapshot')]);
  expect(db.narrative.findMany).toHaveBeenCalledTimes(1);advance();await app.inject('/v1/public-research-snapshot');expect(db.narrative.findMany).toHaveBeenCalledTimes(2);
  for(let i=3;i<30;i++)expect((await app.inject('/v1/public-research-snapshot')).statusCode).toBe(200);
  expect((await app.inject('/v1/public-research-snapshot')).statusCode).toBe(429);
 }finally{await app.close();}
});
it('keeps empty heat and missing observation times unknown and retries after a database failure',async()=>{
 const {app,db,advance}=await setup();try{
  db.narrative.findMany.mockRejectedValueOnce(new Error('unavailable'));
  expect((await app.inject('/v1/public-research-snapshot')).statusCode).toBe(500);
  db.narrative.findMany.mockResolvedValue([]);expect((await app.inject('/v1/public-research-snapshot')).json()).toMatchObject({narrativeHeat:null,narrativeAsOf:null,narrativeSampleSize:0});
  advance();db.narrative.findMany.mockResolvedValue([{score:0,metrics:[]}]);
  expect((await app.inject('/v1/public-research-snapshot')).json()).toMatchObject({narrativeHeat:0,narrativeAsOf:null,narrativeSampleSize:1});
 }finally{await app.close();}
});
