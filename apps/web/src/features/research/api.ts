import type {z} from 'zod';
import {createDownloadTransport,createTransport} from '@/lib/api';
export const RESEARCH_PAGE_SIZE=20;
export const RESEARCH_STALE_MS=30000;
export function createResearchApi(getToken:()=>Promise<string|null>,base=process.env.NEXT_PUBLIC_API_URL??'',fetcher:typeof fetch=fetch,getIdentityToken?:()=>Promise<string|null>){
 const request=createTransport(base,getToken,fetcher,getIdentityToken);
 return <T,>(path:string,schema:z.ZodType<T>,signal?:AbortSignal)=>request(`/v1/${path}`,schema,'GET',undefined,true,signal);
}
/** Own-data writes (mark alert read, settings, chat). Same transport, same schema check on the reply. */
export function createResearchWriter(getToken:()=>Promise<string|null>,base=process.env.NEXT_PUBLIC_API_URL??'',fetcher:typeof fetch=fetch,getIdentityToken?:()=>Promise<string|null>){
 const request=createTransport(base,getToken,fetcher,getIdentityToken);
  return <T,>(path:string,schema:z.ZodType<T>,method:'POST'|'PUT'|'DELETE',body?:unknown,signal?:AbortSignal)=>request(`/v1/${path}`,schema,method,method==='DELETE'?undefined:body??{},true,signal);
}
export function pagePath(resource:string,filters:Record<string,string>={},cursor?:string){
 const query=new URLSearchParams({limit:String(RESEARCH_PAGE_SIZE),...filters});
 if(cursor)query.set('cursor',cursor);
 return `${resource}?${query}`;
}
/** The same authenticated transport for a file body (a CSV export) that the JSON reader would reject. */
export function createResearchDownload(getToken:()=>Promise<string|null>,base=process.env.NEXT_PUBLIC_API_URL??'',fetcher:typeof fetch=fetch,getIdentityToken?:()=>Promise<string|null>){
 const download=createDownloadTransport(base,getToken,fetcher,getIdentityToken);
 return (path:string)=>download(`/v1/${path}`);
}
