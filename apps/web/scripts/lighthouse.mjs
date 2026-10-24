// Local-only mobile audit. API is a network fixture; this never contacts PostgreSQL.
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import lighthouse from 'lighthouse';
import {launch} from 'chrome-launcher';
import {chromium} from '@playwright/test';
const output=path.resolve(process.argv[2]??'test-results/lighthouse');
await mkdir(output,{recursive:true});
const api=createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','http://localhost:4010');res.setHeader('Content-Type','application/json');if(req.url==='/v1/early-access/status'){res.end(JSON.stringify({enabled:true,seatsLeft:12,inviteRequired:false}));}else{res.statusCode=401;res.end(JSON.stringify({error:'UNAUTHORIZED'}));}});
await new Promise((resolve,reject)=>{api.once('error',reject);api.listen(4000,'127.0.0.1',resolve);});
let chrome;
try{
 chrome=await launch({chromePath:chromium.executablePath(),chromeFlags:['--headless=new','--no-sandbox','--disable-dev-shm-usage']});
 const summaries=[];
  const runs=Number(process.argv[3]??5);
  for(const [name,route] of [['landing','/'],['early-access','/early-access']])for(let run=1;run<=runs;run++){
  const result=await lighthouse(`http://localhost:4010${route}`,{port:chrome.port,output:['json','html'],logLevel:'error',onlyCategories:['performance','accessibility','best-practices','seo']});
  if(!result||result.lhr.runtimeError)throw Error(result?.lhr.runtimeError?.message??'Lighthouse returned no result');
   await writeFile(path.join(output,`${name}-${run}.json`),result.report[0]);await writeFile(path.join(output,`${name}-${run}.html`),result.report[1]);
   summaries.push({page:route,run,mode:'Lighthouse mobile defaults; local server, fixture availability API',scores:Object.fromEntries(Object.entries(result.lhr.categories).map(([key,value])=>[key,Math.round(value.score*100)])),lcpMs:result.lhr.audits['largest-contentful-paint'].numericValue,cls:result.lhr.audits['cumulative-layout-shift'].numericValue,tbtMs:result.lhr.audits['total-blocking-time'].numericValue,scriptTransferBytes:result.lhr.audits['network-requests'].details.items.filter(item=>item.resourceType==='Script').reduce((sum,item)=>sum+(item.transferSize??0),0)});
 }
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const medians=['/','/early-access'].map(page=>{const rows=summaries.filter(row=>row.page===page);return {page,runs:rows.length,performance:median(rows.map(row=>row.scores.performance)),lcpMs:median(rows.map(row=>row.lcpMs)),cls:median(rows.map(row=>row.cls)),tbtMs:median(rows.map(row=>row.tbtMs)),scriptTransferBytes:median(rows.map(row=>row.scriptTransferBytes))};});
  await writeFile(path.join(output,'summary.json'),JSON.stringify({runs:summaries,medians},null,2));console.log(JSON.stringify(medians,null,2));
}finally{if(chrome)await chrome.kill();await new Promise(resolve=>api.close(resolve));}
