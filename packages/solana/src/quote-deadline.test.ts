import {it,expect} from 'vitest';
import {JupiterClient,QuoteError} from './jupiter';

it('keeps the quote deadline active while the response body is stalled',async()=>{
 let aborted=false;
 const fetcher:typeof fetch=async(_url,init)=>new Response(new ReadableStream({start(controller){
  controller.enqueue(new TextEncoder().encode('{"inputMint":'));
  init!.signal!.addEventListener('abort',()=>{aborted=true;controller.error(new DOMException('aborted','AbortError'));},{once:true});
 }}),{status:200});
 const client=new JupiterClient({fetch:fetcher,timeoutMs:20});
 await expect(client.getQuote({inputMint:'A',outputMint:'B',amount:50n,slippageBps:50})).rejects.toThrow(QuoteError);
 expect(aborted).toBe(true);
});
