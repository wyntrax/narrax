import {StrictMode,type ComponentProps} from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AuthContext,type AuthAdapter} from '@/components/auth/context';
import {accessKey} from '@/lib/queries';
import {ApiError} from '@/lib/api';
import {active,ADDRESS,challenge,empty,linked,status,wyntraxEarly} from '@/test/fixtures';
import type {AccessView} from './view';
import {AccessFlow} from './controller';

const api=vi.hoisted(()=>({entitlements:vi.fn(),status:vi.fn(),challenge:vi.fn(),verify:vi.fn(),join:vi.fn(),leave:vi.fn(),unlink:vi.fn(),refreshMembership:vi.fn()}));
vi.mock('@/lib/api',async importOriginal=>({...await importOriginal<typeof import('@/lib/api')>(),createApi:()=>api}));
vi.mock('./view',()=>({AccessView:({state,actions}:ComponentProps<typeof AccessView>)=><>
 <output data-testid="state">{JSON.stringify(state)}</output>
 {(['connect','createWallet','retry','sign','join','leave','logout'] as const).map(name=><button key={name} onClick={actions[name]}>{name}</button>)}
 <button onClick={()=>actions.select(ADDRESS)}>select</button><button onClick={()=>actions.unlink('fixture-link')}>unlink</button>
</>}));
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function auth(overrides:Partial<AuthAdapter>={}):AuthAdapter{return {ready:true,authenticated:true,userId:'alice',wallets:[{address:ADDRESS,name:'Phantom',signMessage:vi.fn().mockResolvedValue(new Uint8Array(64))}],login:vi.fn(),logout:vi.fn().mockResolvedValue(undefined),getAccessToken:vi.fn().mockResolvedValue('token'),connectWallet:vi.fn(),createWallet:vi.fn().mockResolvedValue(undefined),...overrides};}
function mount(initial=auth(),strict=false){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
 const tree=(value:AuthAdapter)=>{const content=<QueryClientProvider client={client}><AuthContext.Provider value={value}><AccessFlow/></AuthContext.Provider></QueryClientProvider>;return strict?<StrictMode>{content}</StrictMode>:content;};
 const result=render(tree(initial));return {...result,client,identity:(value:AuthAdapter)=>result.rerender(tree(value))};
}
async function flush(){await act(async()=>{await vi.advanceTimersByTimeAsync(0);});}
async function click(name:string){fireEvent.click(screen.getByRole('button',{name}));await flush();}
function state(){return JSON.parse(screen.getByTestId('state').textContent!);}
beforeEach(()=>{vi.useFakeTimers();vi.resetAllMocks();api.entitlements.mockResolvedValue(linked);api.status.mockResolvedValue(status);api.challenge.mockImplementation(async()=>challenge(window.location.origin));api.refreshMembership.mockResolvedValue({ok:true});});
afterEach(()=>vi.useRealTimers());

describe('identity and operation cancellation',()=>{
 it('clears snapshots and proofs immediately on identity change, ignoring late reads',async()=>{
  const old=deferred<typeof active>();api.entitlements.mockReturnValueOnce(old.promise);
  const app=mount();await flush();
  app.identity(auth({userId:'bob'}));await flush();expect(state().name).toBe('linked');
  old.resolve(active);await flush();expect(state().data).toEqual(linked);expect(app.client.getQueryData(accessKey('alice'))).toBeUndefined();
  await click('connect');await click('select');expect(state().challenge).toBeDefined();
  api.entitlements.mockReturnValue(new Promise(()=>{}));app.identity(auth({userId:'carol'}));
  expect(state()).toEqual({name:'checking',status});
  expect(app.client.getQueryData(accessKey('bob'))).toBeUndefined();
 });
 it.each(['join','unlink','leave'] as const)('does not start a follow-up read or invalidation after stale %s completes',async action=>{
  api.entitlements.mockResolvedValue(action==='leave'?active:linked);
  const old=deferred<unknown>();api[action].mockReturnValueOnce(old.promise);
  const app=mount();await flush();await click(action);
  api.entitlements.mockResolvedValue(empty);app.identity(auth({userId:'bob'}));await flush();
  const reads=api.entitlements.mock.calls.length,invalidations=vi.spyOn(app.client,'invalidateQueries');
  old.resolve(undefined);await flush();
  expect(api.entitlements).toHaveBeenCalledTimes(reads);expect(invalidations).not.toHaveBeenCalled();expect(state().data).toEqual(empty);
  expect(app.client.getQueryData(accessKey('alice'))).toBeUndefined();
 });
 it('discards a signature after sign-out without submitting proof',async()=>{
  const signing=deferred<Uint8Array>(),app=mount(auth({wallets:[{address:ADDRESS,name:'Phantom',signMessage:()=>signing.promise}]}));
  await flush();await click('connect');await click('select');await click('sign');expect(state().name).toBe('signing');
  app.identity(auth({authenticated:false,userId:null}));signing.resolve(new Uint8Array(64));await flush();
  expect(state().name).toBe('signedOut');expect(state().data).toBeUndefined();expect(api.verify).not.toHaveBeenCalled();
 });
 it('does not read entitlements after stale verification completes',async()=>{
  const verification=deferred<unknown>();api.verify.mockReturnValueOnce(verification.promise);
  const app=mount();await flush();await click('connect');await click('select');await click('sign');expect(state().name).toBe('verifying');
  app.identity(auth({userId:'bob'}));await flush();const reads=api.entitlements.mock.calls.length;
  verification.resolve(undefined);await flush();expect(api.entitlements).toHaveBeenCalledTimes(reads);expect(state().name).toBe('linked');
 });
 it('opens paid access automatically after a silent refresh, without a membership action',async()=>{
  mount();await flush();expect(state().name).toBe('linked');
  api.entitlements.mockResolvedValueOnce({...active,effectiveTier:'PRO'});
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
  expect(api.refreshMembership).toHaveBeenCalled();
  expect(state().name).toBe('active');expect(state().data.effectiveTier).toBe('PRO');
 });
 it.each([{...status,enabled:false},{...status,seatsLeft:0},{...status,inviteRequired:true}])('opens Wyntrax early access while local admission is unavailable: %j',async policy=>{
  api.status.mockResolvedValue(policy);mount();await flush();expect(state().name).not.toBe('active');
  api.entitlements.mockResolvedValue(wyntraxEarly);
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
  expect(state().name).toBe('active');expect(state().data.effectiveTier).toBe('EARLY_ACCESS');expect(api.join).not.toHaveBeenCalled();
  const reads=api.entitlements.mock.calls.length;await act(async()=>{await vi.advanceTimersByTimeAsync(130000);});expect(api.entitlements).toHaveBeenCalledTimes(reads);
 });
 it('discards pending post-sign-in access refreshes when identity changes',async()=>{
  const app=mount();await flush();expect(state().name).toBe('linked');
  const poll=deferred<typeof active>();api.entitlements.mockReturnValueOnce(poll.promise);
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
  api.entitlements.mockResolvedValue(empty);app.identity(auth({userId:'bob'}));await flush();
  poll.resolve({...active,effectiveTier:'MEMBER'});await flush();expect(state().name).toBe('noWallet');expect(state().data).toEqual(empty);
 });
 it('discards stale errors and does not unlock a newer pending operation',async()=>{
  const previous=deferred<typeof linked>(),next=deferred<typeof empty>();api.entitlements.mockReturnValueOnce(previous.promise).mockReturnValueOnce(next.promise);
  const app=mount();await flush();app.identity(auth({userId:'bob'}));await flush();
  previous.reject(new ApiError('UNAUTHORIZED',401));await flush();expect(state().name).toBe('checking');
  await click('join');expect(api.join).not.toHaveBeenCalled();next.resolve(empty);await flush();expect(state().name).toBe('noWallet');
 });
 it('guards cleanup through Strict Mode replay and unmount',async()=>{
  const first=deferred<typeof active>(),second=deferred<typeof linked>();api.entitlements.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const app=mount(auth(),true);await flush();expect(api.entitlements).toHaveBeenCalledTimes(2);
  first.resolve(active);await flush();expect(state().name).toBe('checking');expect(app.client.getQueryData(accessKey('alice'))).toBeUndefined();
  app.unmount();second.resolve(linked);await flush();expect(app.client.getQueryData(accessKey('alice'))).toBeUndefined();
 });
});

describe('wallet cancellation and bounded waits',()=>{
 it.each(['createWallet','select'] as const)('cancel supersedes pending %s and allows a fresh connection',async action=>{
  const old=deferred<never>(),adapter=auth({createWallet:()=>old.promise});mount(adapter);await flush();
  if(action==='select'){await click('connect');api.challenge.mockReturnValueOnce(old.promise);}
  await click(action);expect(state().name).toBe('connecting');await click('retry');expect(state().name).toBe('linked');
  await click('connect');await click('select');expect(state().name).toBe('challenge');
  old.reject(new ApiError('WALLET_REJECTED'));await flush();expect(state().name).toBe('challenge');
 });
 it('turns rejected connect into a recoverable error',async()=>{
  const adapter=auth({connectWallet:vi.fn().mockRejectedValueOnce(new Error('closed')).mockResolvedValue(undefined)});mount(adapter);await flush();
  await click('connect');expect(state().error).toBe('WALLET_REJECTED');await click('retry');expect(state().name).toBe('linked');
  await click('connect');expect(state().name).toBe('connecting');await click('retry');expect(state().name).toBe('linked');
 });
 it('discards a late successful challenge after cancel and permits retry while connect is unresolved',async()=>{
  const connecting=deferred<void>(),proof=deferred<ReturnType<typeof challenge>>();
  mount(auth({connectWallet:vi.fn().mockReturnValueOnce(connecting.promise)}));await flush();await click('connect');
  await click('retry');expect(state().name).toBe('linked');connecting.resolve();await flush();
  await click('connect');api.challenge.mockReturnValueOnce(proof.promise);await click('select');await click('retry');
  proof.resolve(challenge(window.location.origin));await flush();expect(state().name).toBe('linked');expect(state().challenge).toBeUndefined();
  await click('connect');await click('select');expect(state().name).toBe('challenge');
 });
 it('bounds checking and wallet waits, discarding late success and allowing retry',async()=>{
  const read=deferred<typeof active>();api.entitlements.mockReturnValueOnce(read.promise);mount();await flush();
  await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(state().error).toBe('TIMEOUT');
  read.resolve(active);await flush();expect(state().error).toBe('TIMEOUT');await click('retry');expect(state().name).toBe('linked');
  await click('connect');await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(state().error).toBe('TIMEOUT');
  await click('retry');expect(state().name).toBe('linked');
 });
});
