import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {OG_TOKENS as colors} from '@/config/site';
import {researchCopy} from '@/content/research-guides';
import {seoLocale} from '@/lib/seo';
export const alt='Narrax — Solana narrative and smart money research';
export const size={width:1200,height:630};
export const contentType='image/png';
export default async function Image({params}:{params:Promise<{locale:string}>}){
 const locale=seoLocale((await params).locale),copy=researchCopy[locale];
 const symbol=(await readFile(path.join(process.cwd(),'public/narrax-symbol.svg'),'utf8')).replace('fill="#000"','fill="#fff"');
 const logo=`data:image/svg+xml;base64,${Buffer.from(symbol).toString('base64')}`;
 // eslint-disable-next-line @next/next/no-img-element -- Satori renders this local SVG directly.
 return new ImageResponse(<div style={{display:'flex',flexDirection:'column',justifyContent:'space-between',width:'100%',height:'100%',padding:72,background:colors.background,color:colors.text}}><div style={{display:'flex',alignItems:'center',gap:24}}><img src={logo} width={72} height={72} alt=""/><div style={{display:'flex',fontSize:36}}>NARRAX</div></div><div style={{display:'flex',fontSize:72,maxWidth:980,lineHeight:1.05,color:colors.accent}}>{copy.homeTitle}</div><div style={{display:'flex',fontSize:23,color:colors.secondary}}>{copy.notice}</div></div>,size);
}
