import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {siteOrigin} from '@/config/site';
import type {SeoLocale} from './seo';
import {socialPreview} from './social-preview';

export async function renderSocialImage(locale: SeoLocale, key: string) {
  const copy = socialPreview(locale, key);
  if (!copy) return new Response('Not found', {status: 404});
  const symbol = (await readFile(path.join(process.cwd(), 'public/narrax-symbol.svg'), 'utf8')).replaceAll('#050609', '#ffffff');
  const logo = `data:image/svg+xml;base64,${Buffer.from(symbol).toString('base64')}`;
  const id = locale === 'id';
  return new ImageResponse(
    <div style={{display:'flex',position:'relative',width:'100%',height:'100%',background:'#080a0d',color:'#fff',fontFamily:'sans-serif',overflow:'hidden'}}>
      <div style={{display:'flex',position:'absolute',left:0,top:0,width:1200,height:6,background:'linear-gradient(90deg, #fff, #8d9ba9, #252b32)'}}/>
      <div style={{display:'flex',flexDirection:'column',width:830,padding:'50px 0 42px 60px'}}>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders the bundled brand SVG. */}
          <img src={logo} width={52} height={52} alt=""/>
          <span style={{fontSize:32,fontWeight:700,letterSpacing:5}}>NARRAX</span>
        </div>
        <div style={{display:'flex',marginTop:40,fontSize:16,letterSpacing:4,color:'#bdc8d3'}}>{copy.label}</div>
        <div style={{display:'flex',marginTop:20,maxWidth:740,fontSize:key==='home'?68:54,lineHeight:1.08,fontWeight:700,letterSpacing:-2}}>{copy.title}</div>
        <div style={{display:'flex',marginTop:22,maxWidth:700,fontSize:23,lineHeight:1.4,color:'#bdc8d3'}}>{copy.description}</div>
        <div style={{display:'flex',marginTop:'auto',gap:20,alignItems:'center',fontSize:18,color:'#98a6b5'}}>
          <span style={{color:'#fff',fontWeight:700}}>{new URL(siteOrigin()).hostname}</span>
          <span>•</span><span>{id?'Bukti, bukan janji.':'Evidence, not promises.'}</span>
        </div>
      </div>
      <div style={{display:'flex',position:'absolute',right:-65,top:110,width:390,height:390,border:'1px solid #303a46',borderRadius:195,background:'radial-gradient(circle, #202a35 0%, #0b1016 65%, #080a0d 100%)'}}>
        <div style={{display:'flex',position:'absolute',left:55,top:55,width:280,height:280,border:'1px solid #394450',borderRadius:140}}/>
        <div style={{display:'flex',position:'absolute',left:110,top:110,width:170,height:170,border:'1px solid #506070',borderRadius:85}}/>
        <div style={{display:'flex',position:'absolute',left:170,top:170,width:50,height:50,borderRadius:25,background:'#fff'}}/>
        {['NARRATIVES','WALLETS','TOKENS'].map((label,index)=><div key={label} style={{display:'flex',position:'absolute',left:index===1?5:90,top:35+index*140,padding:'12px 18px',border:'1px solid #526173',borderRadius:8,background:'#101820',fontSize:14,letterSpacing:2,color:'#dce6ef'}}>{label}</div>)}
      </div>
      <div style={{display:'flex',position:'absolute',right:48,bottom:43,fontSize:13,letterSpacing:2,color:'#98a6b5'}}>RESEARCH / SOLANA</div>
    </div>,
    {width:1200,height:630,headers:{'Cache-Control':'public, max-age=86400, stale-while-revalidate=604800'}},
  );
}
