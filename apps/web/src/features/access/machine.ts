import type {Challenge, Entitlements, PublicStatus} from '@/lib/schemas';
export const STATES = ['signedOut','checking','noWallet','connecting','challenge','signing','verifying','linked','joining','active','disabled','full','inviteOnly','unlinking','leaving','error'] as const;
export type StateName = typeof STATES[number];
export interface AccessState {name: StateName; data?: Entitlements; status?: PublicStatus; challenge?: Challenge; address?: string; error?: string; retryAt?: number; requiredTier?:string}
export type Event = {type:'SIGN_OUT'} | {type:'CHECK'} | {type:'LOADED'; data:Entitlements; status?:PublicStatus} | {type:'PUBLIC'; status:PublicStatus} | {type:'CONNECT'} | {type:'CHALLENGE'; challenge:Challenge; address:string} | {type:'SIGN'} | {type:'SIGNED'} | {type:'VERIFIED'; data:Entitlements} | {type:'JOIN'} | {type:'JOINED'; data:Entitlements} | {type:'SYNC'; data:Entitlements} | {type:'UNLINK'} | {type:'LEAVE'} | {type:'FAIL'; error:string; retryAt?:number;requiredTier?:string};
export const TRANSITIONS: Record<Event['type'], readonly StateName[]> = {
 SIGN_OUT:STATES, PUBLIC:STATES, CHECK:STATES, FAIL:STATES,
 LOADED:['checking','unlinking','leaving'], CONNECT:['noWallet','linked','active','disabled','full','inviteOnly','error'],
 CHALLENGE:['connecting'], SIGN:['challenge'], SIGNED:['signing'], VERIFIED:['verifying'],
  JOIN:['linked'], JOINED:['joining'], SYNC:['linked','active','disabled','full','inviteOnly'],
 UNLINK:['linked','active','disabled','full','inviteOnly','error'], LEAVE:['active','linked','disabled','full','inviteOnly','error']
};
export function resolvedName(data:Entitlements, status?:PublicStatus):StateName {
 if(data.effectiveTier!=='NONE')return 'active';
 if(status && !status.enabled)return 'disabled';
 if(!data.links.length)return 'noWallet';
 if(status?.inviteRequired)return 'inviteOnly';
 if(status?.seatsLeft===0)return 'full';
 return 'linked';
}
export function transition(state:AccessState,event:Event):AccessState {
 if(!TRANSITIONS[event.type].includes(state.name))return state;
 switch(event.type){
 case 'SIGN_OUT':return {name:'signedOut',status:state.status};
 case 'PUBLIC':return {...state,status:event.status};
 case 'CHECK':return {...state,name:'checking',challenge:undefined,error:undefined};
 case 'LOADED':return {name:resolvedName(event.data,event.status??state.status),data:event.data,status:event.status??state.status};
 case 'CONNECT':return {...state,name:'connecting',challenge:undefined,error:undefined};
 case 'CHALLENGE':return {...state,name:'challenge',challenge:event.challenge,address:event.address};
 case 'SIGN':return {...state,name:'signing'};
 case 'SIGNED':return {...state,name:'verifying'};
 case 'VERIFIED':return {...state,name:event.data.effectiveTier!=='NONE'?'active':resolvedName(event.data,state.status),data:event.data,challenge:undefined};
 case 'JOIN':return {...state,name:'joining'};
 case 'JOINED':return {...state,name:resolvedName(event.data,state.status),data:event.data};
  // A post-sign-in refresh may discover membership access while the wallet is verified.
 case 'SYNC':return {...state,data:event.data,name:event.data.effectiveTier!=='NONE'?'active':state.name};
 case 'UNLINK':return {...state,name:'unlinking',challenge:undefined};
 case 'LEAVE':return {...state,name:'leaving'};
 case 'FAIL':return {...state,challenge:undefined,name:event.error==='EARLY_ACCESS_DISABLED'||event.error==='EARLY_ACCESS_CLOSED'?'disabled':event.error==='EARLY_ACCESS_FULL'?'full':event.error==='INVITES_UNAVAILABLE'?'inviteOnly':'error',error:event.error,retryAt:event.retryAt,requiredTier:event.requiredTier};
 }
}
export const busyStates:readonly StateName[]=['checking','connecting','signing','verifying','joining','unlinking','leaving'];
export function stepFor(state:AccessState){return state.name==='signedOut'||(state.name==='checking'&&!state.data)?1:state.data?.links.length||['joining','active','linked'].includes(state.name)?3:2;}
