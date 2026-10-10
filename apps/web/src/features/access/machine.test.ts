import {describe,it,expect} from 'vitest';
import {STATES,transition,resolvedName,type AccessState,type Event,type StateName} from './machine';
import {empty,linked,active,status,challenge,ADDRESS} from '@/test/fixtures';
describe('access state machine',()=>{
 it('walks sign-in, real-proof stages, join, leave and unlink; never grants optimistic access',()=>{let s:AccessState={name:'signedOut'};const send=(e:Event)=>s=transition(s,e);send({type:'CHECK'});send({type:'LOADED',data:empty,status});expect(s.name).toBe('noWallet');send({type:'CONNECT'});send({type:'CHALLENGE',challenge:challenge(),address:ADDRESS});expect(s.name).toBe('challenge');send({type:'SIGN'});expect(s.data?.effectiveTier).toBe('NONE');send({type:'SIGNED'});expect(s.name).toBe('verifying');send({type:'VERIFIED',data:linked,wait:false});send({type:'JOIN'});expect(s.data?.effectiveTier).toBe('NONE');send({type:'JOINED',data:active});expect(s.name).toBe('active');send({type:'LEAVE'});send({type:'LOADED',data:linked});expect(s.name).toBe('linked');send({type:'UNLINK'});send({type:'LOADED',data:empty});expect(s.name).toBe('noWallet');});
 it.each(STATES)('sign-out erases proofs and private data from %s',name=>{const result=transition({name,data:active,challenge:challenge(),address:ADDRESS},{type:'SIGN_OUT'});expect(result).toEqual({name:'signedOut',status:undefined});});
 it.each(STATES)('failure clears a challenge in %s and retry begins a fresh check',name=>{const failed=transition({name,challenge:challenge()},{type:'FAIL',error:'NETWORK'});expect(failed.name).toBe('error');expect(failed.challenge).toBeUndefined();expect(transition(failed,{type:'CHECK'}).name).toBe('checking');});
 const cases: [Event,StateName[],StateName][]=[
 [{type:'CONNECT'},['noWallet','linked','active','disabled','full','inviteOnly','syncExpired','error'],'connecting'],
 [{type:'CHALLENGE',challenge:challenge(),address:ADDRESS},['connecting'],'challenge'],
 [{type:'SIGN'},['challenge'],'signing'],[{type:'SIGNED'},['signing'],'verifying'],
 [{type:'VERIFIED',data:linked,wait:true},['verifying'],'waitingSync'],
 [{type:'JOIN'},['linked','syncExpired'],'joining'],[{type:'JOINED',data:active},['joining'],'active'],
 [{type:'WAIT'},['linked','syncExpired','active'],'waitingSync'],[{type:'SYNC',data:{...active,effectiveTier:'PRO'}},['waitingSync'],'active'],[{type:'SYNC_TIMEOUT'},['waitingSync'],'syncExpired'],
 [{type:'UNLINK'},['linked','active','disabled','full','inviteOnly','syncExpired','error'],'unlinking'],
 [{type:'LEAVE'},['active','linked','disabled','full','inviteOnly','syncExpired','error'],'leaving'],
 [{type:'LOADED',data:linked,status},['checking','unlinking','leaving'],'linked']
 ];
 for(const [event,allowed,next] of cases){it.each(STATES)(`${event.type} is accepted only at its defined boundary from %s`,name=>{const before:AccessState={name};const after=transition(before,event);if(allowed.includes(name))expect(after.name).toBe(next);else expect(after).toBe(before);});}
 it.each(STATES)('public availability updates do not overwrite private flow %s',name=>{expect(transition({name},{type:'PUBLIC',status}).name).toBe(name);});
 it('existing memberships remain accessible when early access is disabled/full/invite-only',()=>{for(const policy of [{...status,enabled:false},{...status,seatsLeft:0},{...status,inviteRequired:true}])expect(resolvedName(active,policy)).toBe('active');expect(resolvedName(empty,{...status,enabled:false})).toBe('disabled');expect(resolvedName(linked,{...status,seatsLeft:0})).toBe('full');expect(resolvedName(linked,{...status,inviteRequired:true})).toBe('inviteOnly');});
 it('keeps waiting for Wyntrax even with an early access grant, then stops',()=>{expect(transition({name:'waitingSync'},{type:'SYNC',data:active}).name).toBe('waitingSync');expect(transition({name:'waitingSync'},{type:'SYNC_TIMEOUT'}).name).toBe('syncExpired');});
 it.each([['EARLY_ACCESS_DISABLED','disabled'],['EARLY_ACCESS_FULL','full'],['INVITES_UNAVAILABLE','inviteOnly']] as const)('maps admission error %s', (error,name)=>expect(transition({name:'joining'},{type:'FAIL',error}).name).toBe(name));
});
