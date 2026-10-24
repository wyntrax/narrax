import {it,expect,vi} from 'vitest';
import {createQueues,type createRedis} from './index';
vi.mock('bullmq',()=>({Queue:class{
 constructor(readonly name:string){}
  async getJobs(states:string[]){return states[0]==='failed'?[{finishedOn:1000,failedReason:'secret-credential'}]:[{finishedOn:2000,returnvalue:this.name==='ai-analysis'?JSON.stringify({analyzed:0,providerFailures:10,tokensUsed:0,providerKey:'secret-credential'}):this.name==='narrative-ingestion'?JSON.stringify({topicsSeen:7,providerErrors:7,mentionsStored:0,narrativesUpdated:0,providerKey:'secret-credential'}):{summary:{errors:['HTTP 429 secret-credential']}}}];}
}}));
it('returns allowlisted run evidence and retained timestamps without errors or job payloads',async()=>{
 const queues=createQueues({} as ReturnType<typeof createRedis>);const result=await queues.health();
  expect(result['ai-analysis']).toMatchObject({lastRun:{analyzed:0,providerFailures:10,tokensUsed:0}});
  expect(result['narrative-ingestion']).toMatchObject({lastRun:{topicsSeen:7,providerErrors:7,mentionsStored:0,narrativesUpdated:0}});
 expect(result['market-data']?.lastRun?.rateLimited).toBe(true);expect(JSON.stringify(result)).not.toContain('secret-credential');
});
