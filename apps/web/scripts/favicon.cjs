/* eslint-disable @typescript-eslint/no-require-imports -- Deterministic binary asset generation. */
const fs=require('node:fs'),path=require('node:path');
const size=32,pixels=Buffer.alloc(size*size*4),mask=Buffer.alloc(size*4);
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 const cornerX=Math.min(x,size-1-x),cornerY=Math.min(y,size-1-y);
 const visible=cornerX>=7||cornerY>=7||(cornerX-7)**2+(cornerY-7)**2<=49;
 const ink=x>=9&&x<=12&&y>=9&&y<=23||x>=19&&x<=22&&y>=13&&y<=23||x>=12&&x<=20&&y>=10&&y<=13;
 const color=ink?[0x0b,0x12,0]:[0xb8,0xff,0x4f],at=((size-1-y)*size+x)*4;
 pixels[at]=color[2];pixels[at+1]=color[1];pixels[at+2]=color[0];pixels[at+3]=visible?255:0;
 if(!visible)mask[(size-1-y)*4+(x>>3)]|=1<<(7-(x%8));
}
const header=Buffer.alloc(22),bitmap=Buffer.alloc(40);
header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=size;header[7]=size;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(bitmap.length+pixels.length+mask.length,14);header.writeUInt32LE(22,18);
bitmap.writeUInt32LE(40,0);bitmap.writeInt32LE(size,4);bitmap.writeInt32LE(size*2,8);bitmap.writeUInt16LE(1,12);bitmap.writeUInt16LE(32,14);bitmap.writeUInt32LE(pixels.length+mask.length,20);
const output=path.resolve(__dirname,'../public');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'favicon.ico'),Buffer.concat([header,bitmap,pixels,mask]));
