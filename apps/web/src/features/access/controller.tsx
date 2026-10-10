'use client';
import {useEffect,useMemo,useReducer,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/components/auth/context';
import {ApiError,createApi,errorKey} from '@/lib/api';
import {accessKey,usePublicStatus} from '@/lib/queries';
import {busyStates,transition,type Event} from './machine';
import {AccessView} from './view';
import {encodeSignature,validateAddress,validateChallenge} from './proof';
import {watchMembership} from './sync';
export function AccessFlow(){
 const auth=useAuth(),client=useQueryClient();const tokenRef=useRef(auth.getAccessToken);tokenRef.current=auth.getAccessToken;
 const api=useMemo(()=>createApi(process.env.NEXT_PUBLIC_API_URL??'',()=>tokenRef.current()),[]);
 const publicQuery=usePublicStatus(api);
 const [state,dispatch]=useReducer(transition,{name:'checking'}),[membership,setMembership]=useState(false);
 const stateRef=useRef(state);stateRef.current=state;const epoch=useRef(0),pending=useRef(false);const authRef=useRef(auth);authRef.current=auth;
 function fail(e:unknown){const error=errorKey(e);dispatch({type:'FAIL',error,retryAt:e instanceof ApiError&&e.retryAfter?Date.now()+e.retryAfter*1000:undefined});}
 async function run(work:(send:(event:Event)=>void)=>Promise<void>){if(pending.current)return;pending.current=true;const own=epoch.current;const send=(event:Event)=>{if(own===epoch.current)dispatch(event);};try{await work(send);}catch(e){if(own===epoch.current)fail(e);}finally{if(own===epoch.current)pending.current=false;}}
 async function load(){const userId=authRef.current.userId,own=epoch.current;const data=await api.entitlements();if(userId&&userId===authRef.current.userId&&own===epoch.current)client.setQueryData(accessKey(userId),data);return data;}
 function retry(){if(!authRef.current.authenticated){dispatch({type:'SIGN_OUT'});return;}void run(async send=>{send({type:'CHECK'});const [data,status]=await Promise.all([load(),api.status()]);send({type:'LOADED',data,status});});}
 useEffect(()=>{if(publicQuery.data)dispatch({type:'PUBLIC',status:publicQuery.data});},[publicQuery.data]);
 useEffect(()=>{epoch.current++;pending.current=false;client.removeQueries({queryKey:['entitlements']});if(!auth.ready){dispatch({type:'CHECK'});return;}if(!auth.authenticated){dispatch({type:'SIGN_OUT'});return;}retry();return()=>{epoch.current++;pending.current=false;};
 // Authentication identity is the cancellation boundary, not changing SDK function references.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[auth.ready,auth.authenticated,auth.userId,client]);
 useEffect(()=>{if(!busyStates.includes(state.name))return;const own=epoch.current;const timer=setTimeout(()=>{if(own===epoch.current){epoch.current++;pending.current=false;dispatch({type:'FAIL',error:'TIMEOUT'});}},state.name==='checking'?11000:60000);return()=>clearTimeout(timer);},[state.name]);
 useEffect(()=>{if(state.name!=='waitingSync')return;return watchMembership(api.entitlements,data=>dispatch({type:'SYNC',data}),()=>dispatch({type:'SYNC_TIMEOUT'}),fail);},[state.name,api]);
 useEffect(()=>{if(state.name!=='active'||!state.data?.nextExpiry)return;const timer=setTimeout(()=>retry(),Math.max(5000,Date.parse(state.data.nextExpiry)-Date.now()));return()=>clearTimeout(timer);
 // Only an authoritative snapshot expiry schedules this refresh.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[state.name,state.data?.nextExpiry]);
 useEffect(()=>{if(!state.retryAt)return;const timer=setTimeout(()=>dispatch({type:'FAIL',error:state.error??'RATE_LIMITED'}),Math.max(0,state.retryAt-Date.now()));return()=>clearTimeout(timer);},[state.retryAt,state.error]);
 const actions={
  login:()=>auth.login(),retry,
  connect:()=>{dispatch({type:'CONNECT'});auth.connectWallet();},
  createWallet:()=>{void run(async send=>{send({type:'CONNECT'});if(!auth.wallets.some(w=>w.name==='Privy'))await auth.createWallet();});},
  select:(address:string)=>{void run(async send=>{validateAddress(address);const challenge=await api.challenge(address);validateChallenge(challenge,window.location.origin,address);send({type:'CHALLENGE',challenge,address});});},
  sign:()=>{void run(async send=>{const current=stateRef.current,own=epoch.current;if(current.name!=='challenge'||!current.challenge||!current.address)return;const wallet=authRef.current.wallets.find(w=>w.address===current.address);if(!wallet)throw new ApiError('WALLET_UNAVAILABLE');const bytes=validateChallenge(current.challenge,window.location.origin,current.address);send({type:'SIGN'});let signature:Uint8Array;try{signature=await wallet.signMessage(bytes);}catch{throw new ApiError('WALLET_REJECTED');}if(own!==epoch.current)return;validateChallenge(current.challenge,window.location.origin,current.address);send({type:'SIGNED'});await api.verify({challengeId:current.challenge.challengeId,message:current.challenge.message,signature:encodeSignature(signature)});send({type:'VERIFIED',data:await load(),wait:membership});});},
  join:()=>{void run(async send=>{send({type:'JOIN'});await api.join();send({type:'JOINED',data:await load()});await client.invalidateQueries({queryKey:['early-access-status']});});},
  wait:()=>dispatch({type:'WAIT'}),
  unlink:(id:string)=>{void run(async send=>{send({type:'UNLINK'});await api.unlink(id);send({type:'LOADED',data:await load()});});},
  leave:()=>{void run(async send=>{send({type:'LEAVE'});await api.leave();send({type:'LOADED',data:await load()});await client.invalidateQueries({queryKey:['early-access-status']});});},
  logout:()=>{epoch.current++;pending.current=false;client.removeQueries({queryKey:['entitlements']});dispatch({type:'SIGN_OUT'});void auth.logout().catch(()=>fail(new ApiError('NETWORK')));}
 };
 return <AccessView state={state} actions={actions} wallets={auth.wallets} membership={membership} setMembership={setMembership}/>;
}
