/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS process preload. */
// Prisma's generated client also performs optional .env discovery. During
// verification, make such files absent and reject any attempted direct read.
const fs=require('node:fs');
const isEnv=file=>/(?:^|[\\/])\.env(?:\.[^\\/]*)?$/.test(String(file));
const exists=fs.existsSync,read=fs.readFileSync;
fs.existsSync=function(file){return isEnv(file)?false:exists.call(this,file);};
fs.readFileSync=function(file,...args){if(isEnv(file))throw Error('Verification accepts inherited environment only');return read.call(this,file,...args);};
