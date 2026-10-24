import {exportJWK,exportSPKI,generateKeyPair} from 'jose';
import {describe,expect,it,vi} from 'vitest';
import {checkPrivyKey} from './privy-key';

describe('published Privy key validation',()=>{
  it('matches the public P-256 coordinates and encodes the app ID',async()=>{
    const pair=await generateKeyPair('ES256');
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({keys:[await exportJWK(pair.publicKey)]})));
    expect(await checkPrivyKey('app/one',await exportSPKI(pair.publicKey),{fetcher})).toEqual({ok:true});
    expect(fetcher.mock.calls[0]![0]).toBe('https://auth.privy.io/api/v1/apps/app%2Fone/jwks.json');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({redirect:'error',signal:expect.any(AbortSignal)});
  });
  it('distinguishes a mismatch from unreachable, malformed or failed responses',async()=>{
    const pem=await exportSPKI((await generateKeyPair('ES256')).publicKey);
    const fetcher=vi.fn<typeof fetch>();
    for(const response of [new Response('{"keys":[]}'),new Response('',{status:404})]){
      fetcher.mockResolvedValueOnce(response);expect(await checkPrivyKey('app',pem,{fetcher})).toEqual({ok:false,error:'PRIVY_KEY_MISMATCH'});
    }
    for(const response of [new Response('',{status:503}),new Response('{}'),new Response('bad JSON')]){
      fetcher.mockResolvedValueOnce(response);expect(await checkPrivyKey('app',pem,{fetcher})).toEqual({ok:false,error:'PRIVY_UNREACHABLE'});
    }
    fetcher.mockRejectedValueOnce(Error('network'));
    expect(await checkPrivyKey('app',pem,{fetcher})).toEqual({ok:false,error:'PRIVY_UNREACHABLE'});
  });
  it('refuses malformed or non-P-256 keys before making any network request',async()=>{
    const fetcher=vi.fn<typeof fetch>();
    for(const key of ['invalid',await exportSPKI((await generateKeyPair('RS256')).publicKey)])expect(await checkPrivyKey('app',key,{fetcher})).toEqual({ok:false,error:'INVALID_PRIVY_KEY'});
    expect(fetcher).not.toHaveBeenCalled();
  });
});
