// @vitest-environment node
import {execFileSync} from 'node:child_process';
import {it,expect} from 'vitest';
it('Next preload uses inherited variables without opening any env file',()=>{
 const output=execFileSync(process.execPath,['-e',`
 const fs=require('node:fs'),read=fs.readFileSync;
 fs.readFileSync=function(file,...args){if(/(?:^|[\\\\/])\\.env(?:$|\\.)/.test(String(file)))throw Error('Environment file access forbidden');return read.call(this,file,...args);};
 require('./scripts/next-env-free.cjs');
 process.env.NARRA_ENV_TEST_SENTINEL='inherited-fixture';
 const result=require('@next/env').loadEnvConfig(process.cwd());
 if(result.loadedEnvFiles.length||result.combinedEnv.NARRA_ENV_TEST_SENTINEL!=='inherited-fixture')throw Error('Inherited environment not preserved');
 console.log('env-free');
 `],{encoding:'utf8'});expect(output.trim()).toBe('env-free');
});
it('the verification guard prevents Prisma discovery and direct env reads',()=>{
 const output=execFileSync(process.execPath,['-e',`
 require('./scripts/no-env-files.cjs');
 const fs=require('node:fs');
 if(fs.existsSync('.env'))throw Error('Env discovery was not blocked');
 let blocked=false;try{fs.readFileSync('.env','utf8');}catch(error){blocked=error.message==='Verification accepts inherited environment only';}
 if(!blocked)throw Error('Direct env read was not blocked');
 console.log('guarded');
 `],{encoding:'utf8'});expect(output.trim()).toBe('guarded');
});
