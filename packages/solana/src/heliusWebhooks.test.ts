import {expect,it,vi} from 'vitest';
import {HeliusWebhooks,planWebhookSync} from './heliusWebhooks';
const summary={webhookID:'hook',webhookURL:'https://example.test/webhooks/helius',transactionTypes:['SWAP'],active:true};
it('loads omitted list addresses from detail instead of resetting the watchlist',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([summary])))
  .mockResolvedValueOnce(new Response(JSON.stringify({...summary,accountAddresses:['wallet']})));
 const client=new HeliusWebhooks({apiKey:'secret',fetch});
 const [hook]=await client.list();
 expect(planWebhookSync(hook!.accountAddresses,['wallet']).inSync).toBe(true);
 expect(fetch).toHaveBeenCalledTimes(2);
 expect(String(fetch.mock.calls[1]![0])).toContain('/v0/webhooks/hook?');
});
it('keeps an explicitly empty list and rejects missing detail addresses',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{...summary,accountAddresses:[]}])));
 expect((await new HeliusWebhooks({apiKey:'secret',fetch}).list())[0]!.accountAddresses).toEqual([]);
 expect(fetch).toHaveBeenCalledTimes(1);
 const broken=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([summary])))
  .mockResolvedValueOnce(new Response(JSON.stringify(summary)));
 await expect(new HeliusWebhooks({apiKey:'secret',fetch:broken}).list()).rejects.toThrow('unexpected shape');
});
