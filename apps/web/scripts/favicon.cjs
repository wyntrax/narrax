/* eslint-disable @typescript-eslint/no-require-imports -- Deterministic binary asset generation. */
const fs=require('node:fs'),path=require('node:path');
const sharp=require('sharp'),output=path.resolve(__dirname,'../public');
async function generate(){
 const source=fs.readFileSync(path.join(output,'narrax-symbol.svg'),'utf8');
 const dark=source.replace('fill="#000"','fill="#fff"');
 fs.writeFileSync(path.join(output,'narrax-logo-light.svg'),source);
 fs.writeFileSync(path.join(output,'narrax-logo-dark.svg'),dark);
 const adaptive=source.replace('fill="#000"','fill="currentColor"').replace('>','><style>svg{color:#000}@media(prefers-color-scheme:dark){svg{color:#fff}}</style>');
 fs.writeFileSync(path.join(output,'favicon.svg'),adaptive);
 // PNG-backed ICO fallback: white supplied mark on black, legible on either browser theme.
 const png=await sharp(Buffer.from(dark)).resize(26,26).extend({top:3,bottom:3,left:3,right:3,background:'#000'}).flatten({background:'#000'}).png().toBuffer();
 const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=32;header[7]=32;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
 fs.writeFileSync(path.join(output,'favicon.ico'),Buffer.concat([header,png]));
}
generate().catch(error=>{console.error(error);process.exitCode=1;});
