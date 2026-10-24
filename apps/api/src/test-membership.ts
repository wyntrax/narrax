import {randomBytes} from 'node:crypto';
import bs58 from 'bs58';
import type {PrismaClient} from '@narra/database';
import {assertTestDatabase} from '../../../scripts/test-database';

/** Content-route fixtures use real linked Pro memberships, never a global gate bypass. */
export async function seedTestPro(db:PrismaClient,userId:string){
 assertTestDatabase(new URL(process.env.DATABASE_URL??'invalid:'));
 const address=bs58.encode(randomBytes(32));
 await db.linkedWallet.create({data:{userId,chain:'solana',address,verifiedAt:new Date('2020-01-01')}});
 await db.wyntraxEntitlement.create({data:{membershipId:`test-pro:${userId}`,chain:'solana',address,key:'PRO',status:'ACTIVE',seq:1n,validUntil:new Date('2099-01-01'),proSince:new Date('2020-01-01'),receivedAt:new Date(),lastEventId:`test-pro:${userId}`}});
}
export async function clearTestPro(db:PrismaClient,ids:string[]){
 assertTestDatabase(new URL(process.env.DATABASE_URL??'invalid:'));
 await db.wyntraxEntitlement.deleteMany({where:{membershipId:{in:ids.map(id=>`test-pro:${id}`)}}});
}
