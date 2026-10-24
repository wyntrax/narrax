// @vitest-environment node
import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);
const {validateConfig,checkConfig}=require('../../scripts/check-deploy-config.cjs');
const valid={NEXT_PUBLIC_SITE_URL:'https://narrax.example',NEXT_PUBLIC_API_URL:'https://api.narrax.example',NEXT_PUBLIC_PRIVY_APP_ID:'public-app-id',NEXT_PUBLIC_WYNTRAX_URL:'',NARRA_SEO_INDEXABLE:'false'};
describe('frontend deployment configuration',()=>{
 it('accepts explicit HTTPS public settings and an intentionally empty optional claim URL',()=>{expect(validateConfig(valid)).toEqual({NEXT_PUBLIC_SITE_URL:valid.NEXT_PUBLIC_SITE_URL,NEXT_PUBLIC_API_URL:valid.NEXT_PUBLIC_API_URL,NEXT_PUBLIC_PRIVY_APP_ID:valid.NEXT_PUBLIC_PRIVY_APP_ID,NEXT_PUBLIC_WYNTRAX_URL:''});});
 it.each(['NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_API_URL','NEXT_PUBLIC_PRIVY_APP_ID','NEXT_PUBLIC_WYNTRAX_URL'])('detects build/runtime drift for %s',key=>{const manifest=validateConfig(valid);const changed={...valid,[key]:key.includes('PRIVY')?'different-app':key.includes('WYNTRAX')?'https://claim.example':`https://other.example`};expect(()=>checkConfig(changed,manifest)).toThrow(/differs from the image build/);});
 it.each(['http://example.com','https://localhost','https://127.0.0.1','https://preview.localhost','https://user:pass@example.com','https://example.com/path','https://example.com/'])('rejects invalid public origin %s',value=>{expect(()=>validateConfig({...valid,NEXT_PUBLIC_SITE_URL:value})).toThrow();});
 it.each(['','fixture app','bad\napp'])('rejects missing/malformed public app ID %j',value=>{expect(()=>validateConfig({...valid,NEXT_PUBLIC_PRIVY_APP_ID:value})).toThrow();});
 it.each(['','1','yes',undefined])('requires explicit search indexing choice %j',value=>{expect(()=>validateConfig({...valid,NARRA_SEO_INDEXABLE:value})).toThrow();});
 it('does not allow any test-auth value',()=>{expect(()=>validateConfig({...valid,NARRA_WEB_TEST_AUTH:'false'})).toThrow(/must be absent/);});
 it('allows runtime-only indexing and ownership-token changes without public bundle drift',()=>{expect(()=>checkConfig({...valid,NARRA_SEO_INDEXABLE:'true',NARRA_GOOGLE_SITE_VERIFICATION:'public-token'},validateConfig(valid))).not.toThrow();});
});
