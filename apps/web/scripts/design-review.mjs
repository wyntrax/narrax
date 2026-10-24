// Read-only reference inputs; compact review composites are written only under docs/design-review.
import sharp from 'sharp';
import {mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('..','..'),output=path.resolve('docs/design-review');
const captures=process.argv[2];if(!captures)throw Error('Pass the final capture directory');
await mkdir(output,{recursive:true});
for(const [name,reference,state] of [['landing','landing-page-design.png','landing'],['access','early-access-design.png','signedOut']]){
 const left=await sharp(path.join(root,'design/reference',reference)).resize(800,720,{fit:'contain',background:'#101216'}).png().toBuffer();
 const right=await sharp(path.join(captures,`${state}-dark-1440.png`)).resize(800,720,{fit:'contain',background:'#101216'}).png().toBuffer();
 const title=Buffer.from('<svg width="1600" height="44"><rect width="1600" height="44" fill="#101216"/><g fill="white" font-family="sans-serif" font-size="18"><text x="24" y="29">REFERENCE — mood/composition only</text><text x="824" y="29">NARRAX — original implementation</text></g></svg>');
 const file=path.join(output,`${name}-comparison.webp`);
 await sharp({create:{width:1600,height:764,channels:4,background:'#101216'}}).composite([{input:title,top:0,left:0},{input:left,top:44,left:0},{input:right,top:44,left:800}]).webp({quality:82}).toFile(file);
 if((await stat(file)).size>2_500_000)throw Error('Review image exceeds 2.5 MB budget');
}
