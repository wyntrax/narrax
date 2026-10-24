import {RequirementsSchema,type Requirements} from './schemas';

const TIMEOUT_MS=3000;
/**
 * Public tier requirements for server-rendered pages. Null means unknown (API down, bad response, bad config):
 * the pages then say the amounts are unavailable instead of guessing a number.
 */
export async function fetchRequirements(base=process.env.NEXT_PUBLIC_API_URL??'',fetcher:typeof fetch=fetch):Promise<Requirements|null>{
 try{
  const url=new URL('/v1/access/requirements',base);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
   const response=await fetcher(url,{signal:AbortSignal.timeout(TIMEOUT_MS),credentials:'omit',redirect:'error',cache:'no-store'});
  if(!response.ok)return null;
  const parsed=RequirementsSchema.safeParse(await response.json().catch(()=>null));
  return parsed.success?parsed.data:null;
 }catch{return null;}
}
