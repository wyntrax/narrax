import {expect,it} from 'vitest';
import {assertTestDatabase} from './test-database';
it('refuses application, remote, missing and mismatched test databases',()=>{
  for(const [url,name] of [['postgresql://localhost:5432/narra_ent','narra_ent'],['postgresql://localhost:5432/narra','narra'],['postgresql://remote/narra_test','narra_test'],['postgresql://localhost/narra_test',''],['postgresql://localhost/narra_test','narra_other_test']]){
    expect(()=>assertTestDatabase(new URL(url!),name)).toThrow();
  }
  expect(()=>assertTestDatabase(new URL('postgresql://localhost:5432/narra_radar_test_20261016'),'narra_radar_test_20261016')).not.toThrow();
});
