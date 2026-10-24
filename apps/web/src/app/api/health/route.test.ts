// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {GET} from './route';
afterEach(()=>vi.unstubAllEnvs());
it('identifies the running release without cacheable or indexable health data',async()=>{
 vi.stubEnv('NARRA_WEB_REVISION','a'.repeat(40));
 const response=GET();
 expect(response.status).toBe(200);
 expect(await response.json()).toEqual({status:'ok',revision:'a'.repeat(40)});
 expect(response.headers.get('cache-control')).toBe('no-store');
 expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
});
it('works without deployment configuration or infrastructure and returns no credentials',async()=>{
 vi.stubEnv('NARRA_WEB_REVISION',undefined);vi.stubEnv('DATABASE_URL','private-test-marker');
 const response=GET();expect(await response.text()).toBe('{"status":"ok","revision":"local"}');
});
