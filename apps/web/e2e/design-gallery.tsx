'use client';
// Visual-only fixtures behind the existing compile-time auth alias. Never a route or production feature.
import {AccessView,type AccessActions} from '../src/features/access/view';
import {STATES,type AccessState} from '../src/features/access/machine';
import {active,linked,empty,status,challenge,ADDRESS} from '../src/test/fixtures';
export function DesignGallery({name}:{name:string}) {
 if(!STATES.includes(name as AccessState['name']))throw Error('Unknown design state');
 const state:AccessState={name:name as AccessState['name'],status,data:['active','leaving'].includes(name)?active:['linked','joining','unlinking'].includes(name)?linked:empty};
 if(name==='challenge')state.challenge=challenge('http://localhost:4010',Date.UTC(2026,9,12));
 if(name==='disabled')state.status={enabled:false,seatsLeft:null,inviteRequired:false};
 if(name==='full')state.status={...status,seatsLeft:0};
 if(name==='inviteOnly')state.status={...status,inviteRequired:true};
 if(name==='error')state.error='ENTITLEMENTS_UNAVAILABLE';
 const noop=()=>{};const actions:AccessActions={login:noop,retry:noop,connect:noop,select:noop,sign:noop,join:noop,unlink:noop,leave:noop,logout:noop,createWallet:noop};
 return <div data-design-state={name}><AccessView state={state} actions={actions} wallets={[{address:ADDRESS,name:'Phantom (test fixture)'}]}/></div>;
}
