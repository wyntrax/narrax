import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {siteOrigin} from '@/config/site';
import type {SeoLocale} from './seo';
import {socialPreview} from './social-preview';

export async function renderSocialImage(locale: SeoLocale, key: string) {
  const copy = socialPreview(locale, key);
  if (!copy) return new Response('Not found', {status: 404});
  if (key === 'home') {
    const image = await readFile(path.join(process.cwd(), 'public/og-default.png'));
    return new Response(new Uint8Array(image), {headers: {'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800'}});
  }
  const rawSymbol = await readFile(path.join(process.cwd(), 'public/narrax-symbol.svg'), 'utf8');
  const symbolWhite = rawSymbol.replaceAll('#050609', '#ffffff');
  const logoWhite = `data:image/svg+xml;base64,${Buffer.from(symbolWhite).toString('base64')}`;
  const id = locale === 'id';
  const topics = id ? ['NARASI', 'WALLET', 'TOKEN'] : ['NARRATIVES', 'WALLETS', 'TOKENS'];
  return new ImageResponse(
    <div style={{display:'flex',position:'relative',width:'100%',height:'100%',background:'#050507',color:'#f4f4f6',fontFamily:'sans-serif',overflow:'hidden'}}>
      {/* Subtle monochrome studio radial glow and dot matrix matching marketing-design.css */}
      <div style={{display:'flex',position:'absolute',right:-120,top:-160,width:820,height:860,background:'radial-gradient(ellipse, #1d1d24 0%, #0d0d12 45%, #050507 75%)'}}/>
      <svg width="1200" height="630" viewBox="0 0 1200 630" style={{position:'absolute',left:0,top:0}}>
        {Array.from({length:24},(_,x)=>Array.from({length:14},(_,y)=><circle key={`${x}-${y}`} cx={480+x*30} cy={30+y*44} r="1" fill="#ffffff" fillOpacity="0.12"/>))}
      </svg>
      <div style={{display:'flex',position:'absolute',left:0,top:0,width:1200,height:4,background:'linear-gradient(90deg, #ffffff 0%, #8e8e99 55%, #1c1c22 100%)'}}/>
      <div style={{display:'flex',position:'absolute',left:60,top:48,alignItems:'center',gap:16}}>
        <div style={{display:'flex',width:60,height:60,alignItems:'center',justifyContent:'center',background:'linear-gradient(145deg, #222228, #0f0f13)',border:'1px solid #3a3a44',borderRadius:16}}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori embeds the local brand asset, with no remote fetch. */}
          <img src={logoWhite} width={36} height={36} alt="Narrax logo"/>
        </div>
        <span style={{fontSize:34,fontWeight:700,letterSpacing:5,color:'#ffffff'}}>NARRAX</span>
      </div>
      <div style={{display:'flex',position:'absolute',right:60,top:56,padding:'10px 18px',background:'#111116',border:'1px solid #2e2e38',borderRadius:999,color:'#c4c4ce',fontSize:15,letterSpacing:3}}>SOLANA / RESEARCH</div>
      <div style={{display:'flex',position:'absolute',left:62,top:152,fontSize:15,letterSpacing:3,color:'#a4a4b0'}}>{copy.label}</div>
      <div style={{display:'flex',position:'absolute',left:60,top:190,width:640,flexDirection:'column'}}>
        <div style={{display:'flex',fontSize:52,fontWeight:700,lineHeight:1.1,letterSpacing:-2,color:'#ffffff'}}>{copy.title}</div>
        <div style={{display:'flex',marginTop:22,maxWidth:610,fontSize:22,lineHeight:1.4,color:'#a8a8b4'}}>{copy.description}</div>
      </div>
      {/* Authored signal-graph emblem, echoing the homepage workflow diagram without fabricated live numbers. */}
      <div style={{display:'flex',position:'absolute',left:744,top:145,width:400,height:375}}>
        <svg width="400" height="375" viewBox="0 0 400 375" style={{position:'absolute',left:0,top:0}}>
          <circle cx="200" cy="182" r="168" fill="none" stroke="#262630" strokeWidth="1"/>
          <circle cx="200" cy="182" r="126" fill="none" stroke="#363644" strokeWidth="1" strokeDasharray="4 8"/>
          <circle cx="200" cy="182" r="88" fill="#0d0d12" stroke="#3e3e4c" strokeWidth="1"/>
          <path d="M200 182 L200 38 M200 182 L62 268 M200 182 L338 282" fill="none" stroke="#d8d8e2" strokeWidth="1.75"/>
          <path d="M200 38 Q365 92 338 282 Q170 365 62 268 Q18 102 200 38" fill="none" stroke="#686878" strokeWidth="1.25" strokeDasharray="5 7"/>
          {[[200,38],[62,268],[338,282],[344,96],[92,90],[202,350]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i<3?5.5:3.5} fill={i<3?'#ffffff':'#8e8e9c'}/>)}
        </svg>
        <div style={{display:'flex',position:'absolute',left:140,top:122,width:120,height:120,borderRadius:30,alignItems:'center',justifyContent:'center',background:'linear-gradient(145deg, #23232a, #0e0e12)',border:'1px solid #4a4a58',boxShadow:'0 16px 50px #000000'}}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Reuse the supplied Narrax symbol at a readable scale. */}
          <img src={logoWhite} width={66} height={66} alt=""/>
        </div>
        {topics.map((label,i)=><div key={label} style={{display:'flex',position:'absolute',left:[112,4,252][i],top:[2,280,296][i],padding:'10px 16px',background:'#121217',border:'1px solid #343440',borderRadius:12,color:'#e4e4ec',fontSize:15,letterSpacing:2}}>{label}</div>)}
      </div>
      <div style={{display:'flex',position:'absolute',left:60,right:60,bottom:36,paddingTop:20,borderTop:'1px solid #22222a',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:20,fontWeight:700,color:'#ffffff'}}>{new URL(siteOrigin()).hostname}</span>
        <span style={{fontSize:17,color:'#9898a6'}}>{id?'Riset, bukan prediksi · Bukti, bukan janji.':'Research, not prediction · Evidence, not promises.'}</span>
      </div>
    </div>,
    {width:1200,height:630,headers:{'Cache-Control':'public, max-age=86400, stale-while-revalidate=604800'}},
  );
}
