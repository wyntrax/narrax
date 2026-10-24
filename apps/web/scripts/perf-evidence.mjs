import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: perf-evidence <Lighthouse directory> <output.json>');
const evidence=[];
for(const name of ['landing','early-access']){
 const report=JSON.parse(await readFile(path.join(input,`${name}-3.json`),'utf8'));
 const audits=report.audits;
 evidence.push({page:name,representativeRun:3,resources:audits['network-requests'].details.items.filter(item=>['Script','Font','Stylesheet'].includes(item.resourceType)).map(item=>({path:new URL(item.url).pathname,type:item.resourceType,transferBytes:item.transferSize,decodedBytes:item.resourceSize})),lcp:audits['lcp-breakdown-insight']?.details,blocking:audits['render-blocking-insight']?.details,fonts:audits['font-display-insight']?.details,execution:audits['bootup-time']?.details});
}
await writeFile(output,JSON.stringify(evidence,null,2));
