import {describe,it,expect} from 'vitest';
import {MAX_TIMER_MS,MIN_REFRESH_MS,refreshDelay,scheduleRefresh,type Scheduler} from './refresh';
const INT32_MAX=2**31-1;
function fake(start=0){
 let t=start,id=0;const timers=new Map<number,{at:number;fn:()=>void}>();
 const scheduler:Scheduler={now:()=>t,set:(fn,ms)=>{expect(ms).toBeLessThanOrEqual(INT32_MAX);const h=++id;timers.set(h,{at:t+ms,fn});return h;},clear:h=>{timers.delete(h as number);}};
 return {scheduler,pending:()=>timers.size,advance(ms:number){const end=t+ms;for(;;){const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;t=next[1].at;timers.delete(next[0]);next[1].fn();}t=end;}};
}
describe('membership expiry refresh',()=>{
 it('never asks for a delay beyond the 32-bit timer limit',()=>{for(const days of [1,24,25,40,90,3650])expect(refreshDelay(days*86400000,0)).toBeLessThanOrEqual(MAX_TIMER_MS);expect(MAX_TIMER_MS).toBeLessThan(INT32_MAX);});
 it('keeps a floor so an already-passed expiry cannot cause a tight loop',()=>{expect(refreshDelay(0,1000)).toBe(MIN_REFRESH_MS);expect(refreshDelay(1000,1000)).toBe(MIN_REFRESH_MS);expect(refreshDelay(Number.NaN,0)).toBe(MIN_REFRESH_MS);});
 it('does not fire for a 40 day expiry until the expiry is reached (regression: fired after ~1 ms)',()=>{
  const f=fake(0),due:number[]=[];const expiry=new Date(40*86400000).toISOString();
  scheduleRefresh(expiry,()=>due.push(1),f.scheduler);
  f.advance(1);expect(due).toHaveLength(0);f.advance(5000);expect(due).toHaveLength(0);
  f.advance(39*86400000);expect(due).toHaveLength(0);
  f.advance(86400000);expect(due).toHaveLength(1);
 });
 it('fires once for a near expiry and not again',()=>{const f=fake(0),due:number[]=[];scheduleRefresh(new Date(60000).toISOString(),()=>due.push(1),f.scheduler);f.advance(59999);expect(due).toHaveLength(0);f.advance(1);expect(due).toHaveLength(1);f.advance(10*86400000);expect(due).toHaveLength(1);});
 it('cancel stops a pending refresh',()=>{const f=fake(0),due:number[]=[];const cancel=scheduleRefresh(new Date(60000).toISOString(),()=>due.push(1),f.scheduler);cancel();f.advance(86400000);expect(due).toHaveLength(0);expect(f.pending()).toBe(0);});
 it('schedules nothing for an unparsable date',()=>{const f=fake(0);scheduleRefresh('not-a-date',()=>{throw new Error('must not fire');},f.scheduler);expect(f.pending()).toBe(0);});
});
