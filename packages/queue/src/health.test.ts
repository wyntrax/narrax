import {it,expect,vi} from 'vitest';
import {createQueues,type createRedis} from './index';
vi.mock('bullmq',()=>({Queue:class{
 constructor(readonly name:string){}
  async getJobs(states:string[]){
   if(states[0]==='failed')return [{finishedOn:1000,failedReason:'secret-credential'}];
   if(this.name==='wallet-sync')return [{finishedOn:2000,returnvalue:JSON.stringify({action:'skipped',desired:0,error:'GET /v0/webhooks returned HTTP 429 secret-credential'})}];
   return [{finishedOn:2000,returnvalue:this.name==='ai-analysis'?JSON.stringify({analyzed:0,providerFailures:10,tokensUsed:0,providerKey:'secret-credential'}):this.name==='narrative-ingestion'?JSON.stringify({topicsSeen:7,providerErrors:7,mentionsStored:0,narrativesUpdated:0,providerKey:'secret-credential'}):{summary:{errors:['HTTP 429 secret-credential']}}}];
  }
}}));
it('returns allowlisted run evidence and retained timestamps without errors or job payloads',async()=>{
 const queues=createQueues({} as ReturnType<typeof createRedis>);const result=await queues.health();
  expect(result['ai-analysis']).toMatchObject({lastRun:{analyzed:0,providerFailures:10,tokensUsed:0}});
  expect(result['narrative-ingestion']).toMatchObject({lastRun:{topicsSeen:7,providerErrors:7,mentionsStored:0,narrativesUpdated:0}});
 expect(result['market-data']?.lastRun).toMatchObject({errors:1,rateLimited:true});
 expect(result['wallet-sync']?.lastRun).toMatchObject({action:'skipped',error:'RATE_LIMITED'});
 // Every queue is sampled, so a worker that exists but never reports is visible.
 expect(result['token-resolution']).toBeDefined();expect(result['wallet-discovery']).toBeDefined();expect(result['notification-dispatch']).toBeDefined();
 expect(JSON.stringify(result)).not.toContain('secret-credential');
});
