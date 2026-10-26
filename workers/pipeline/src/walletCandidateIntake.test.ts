import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { intakeEmergingWallets } from './walletCandidateIntake';

const now=new Date('2040-01-01T00:00:00Z');
const addresses=['So11111111111111111111111111111111111111112','11111111111111111111111111111111'];
function fixture(count:number,tracked:string[]=[],rejected:string[]=[]){
 const createMany=vi.fn(async(_args:unknown)=>({count:1})),upsert=vi.fn(async()=>({}));
 const tx={
  $executeRaw:vi.fn(async()=>0),systemSetting:{findUnique:async()=>({value:{checkedAt:now.toISOString(),items:addresses.map(address=>({address,scannedTokens:3}))}}),upsert},
  trackedWallet:{count:async()=>count,findMany:async()=>tracked.map(address=>({address})),createMany},
  walletCandidate:{findMany:async()=>rejected.map(address=>({address}))},
 };
 const db={$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)} as unknown as PrismaClient;
 return {db,createMany,upsert};
}
it('respects remaining capacity and stops admission at the discovered-wallet cap',async()=>{
 const last=fixture(199);expect(await intakeEmergingWallets(last.db,now)).toMatchObject({capacity:1,added:1});
 expect(last.createMany.mock.calls[0]?.[0]).toMatchObject({data:[{address:addresses[0],researchReview:'PROVISIONAL'}]});
 const full=fixture(200);expect(await intakeEmergingWallets(full.db,now)).toMatchObject({reason:'CAPACITY_REACHED',added:0});expect(full.createMany).not.toHaveBeenCalled();
});
it('does not reactivate existing tracked addresses or bypass a rejected candidate',async()=>{
 const f=fixture(0,[addresses[0]!],[addresses[1]!]);expect(await intakeEmergingWallets(f.db,now)).toMatchObject({added:0});expect(f.createMany).not.toHaveBeenCalled();
});
