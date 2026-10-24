// @vitest-environment node
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect,it} from 'vitest';
it('the real Next build entry refuses any production test-auth value before compiling',()=>{
 for(const value of ['1','0']) {
  const result=spawnSync(process.execPath,['scripts/next-env-free.cjs','build'],{env:{...process.env,NODE_ENV:'production',NARRA_WEB_TEST_AUTH:value},encoding:'utf8'});
  expect(result.status).not.toBe(0);expect(result.stdout+result.stderr).toContain('NARRA_WEB_TEST_AUTH is forbidden in production');
 }
},30000);
it('the production scan fails on fixture code and accepts a clean bundle',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'narrax-auth-scan-'));
 const run=()=>execFileSync(process.execPath,['-e',`require('./scripts/check-production-auth.cjs').checkProductionAuth(${JSON.stringify(dir)})`],{encoding:'utf8',stdio:'pipe'});
 try {
  expect(run).toThrow();writeFileSync(path.join(dir,'BUILD_ID'),'test-build');
  writeFileSync(path.join(dir,'page.js'),'console.log("production")');expect(run).not.toThrow();
  for(const marker of ['auth-fixture','fixture-public-test-token','__fixture-signature','__designState','design-gallery']) {writeFileSync(path.join(dir,'page.js'),marker);expect(run).toThrow(/Fixture auth leaked/);}
 } finally {rmSync(dir,{recursive:true,force:true});}
});
