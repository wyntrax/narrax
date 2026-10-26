// Portable review copies; original PNGs remain in the external evidence directory.
import sharp from 'sharp';
import {mkdir,readdir,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
const source=process.argv[2];if(!source)throw Error('Pass the external web-design evidence directory');
const output=path.resolve('docs/design-captures'),records=[];
for(const phase of ['before','after']){
 const dir=path.join(output,phase);await mkdir(dir,{recursive:true});
 const files=(await readdir(path.join(source,phase))).filter(file=>file.endsWith('.png')).sort();
 if(files.length!==102)throw Error(`${phase}: expected 102 captures, found ${files.length}`);
 for(const file of files){const target=file.replace(/\.png$/,'.webp');await sharp(path.join(source,phase,file)).webp({quality:82}).toFile(path.join(dir,target));records.push({phase,file:target,bytes:(await stat(path.join(dir,target))).size});}
}
const states=['landing','signedOut','checking','noWallet','connecting','challenge','signing','verifying','linked','joining','active','disabled','full','inviteOnly','unlinking','leaving','error'];
const lines=['# Before / after screenshot index','','102 captures per phase, real presentation with deterministic visual fixtures. Each link retains full original viewport width. WebP review copies use quality 82; pixel-regression baselines remain original PNGs in `e2e/__screenshots__`. Original PNGs are retained at `C:\\dev\\narra-entitlements-review\\web-design\\{before,after}`.','','| State / theme | 1440 before → after | 834 before → after | 390 before → after |','|---|---|---|---|'];
for(const state of states)for(const theme of ['dark','light'])lines.push(`| ${state} / ${theme} | `+[1440,834,390].map(width=>`[before](before/${state}-${theme}-${width}.webp) → [after](after/${state}-${theme}-${width}.webp)`).join(' | ')+' |');
await writeFile(path.join(output,'README.md'),lines.join('\n')+'\n');await writeFile(path.join(output,'manifest.json'),JSON.stringify(records,null,2));
console.log(JSON.stringify({files:records.length,totalBytes:records.reduce((sum,item)=>sum+item.bytes,0)}));
