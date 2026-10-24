import {it,expect,vi} from 'vitest';
import {z} from 'zod';
import {createResearchApi} from './api';
it('authenticates read-only research and propagates query cancellation to fetch',async()=>{
 let captured:AbortSignal|undefined;
 const fetcher=vi.fn((_url:URL|RequestInfo,init?:RequestInit)=>{captured=init?.signal as AbortSignal;return new Promise<Response>((_resolve,reject)=>captured!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));});
 const controller=new AbortController(),read=createResearchApi(async()=>'identity-token','http://localhost:4000',fetcher);
 const pending=read('tokens?q=x',z.object({}),controller.signal);const failure=expect(pending).rejects.toMatchObject({code:'NETWORK'});
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());
 expect(fetcher.mock.calls[0]?.[1]).toMatchObject({method:'GET',credentials:'omit',cache:'no-store',redirect:'error',headers:{Authorization:'Bearer identity-token'}});
 controller.abort();await failure;expect(captured?.aborted).toBe(true);
});
it('does not fetch research without an authenticated token',async()=>{const fetcher=vi.fn();const read=createResearchApi(async()=>null,'http://localhost:4000',fetcher);await expect(read('overview',z.object({}))).rejects.toMatchObject({code:'UNAUTHORIZED'});expect(fetcher).not.toHaveBeenCalled();});
