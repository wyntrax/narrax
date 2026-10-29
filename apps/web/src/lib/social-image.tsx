import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {siteOrigin} from '@/config/site';
import type {SeoLocale} from './seo';
import {socialPreview} from './social-preview';

export async function renderSocialImage(locale: SeoLocale, key: string) {
  const copy = socialPreview(locale, key);
  if (!copy) return new Response('Not found', {status: 404});
  const symbol = await readFile(path.join(process.cwd(), 'public/narrax-symbol.svg'), 'utf8');
  const logo = `data:image/svg+xml;base64,${Buffer.from(symbol).toString('base64')}`;
  const id = locale === 'id';
  const home = key === 'home';
  const topics = id ? ['NARASI','WALLET','TOKEN'] : ['NARRATIVES','WALLETS','TOKENS'];
  return new ImageResponse(
    <div style={{display:'flex',position:'relative',width:'100%',height:'100%',background:'#090e15',color:'#f7fafc',fontFamily:'sans-serif',overflow:'hidden'}}>
      <div style={{display:'flex',position:'absolute',right:-100,top:-180,width:770,height:850,background:'radial-gradient(ellipse, #233d45 0%, #151f35 40%, #090e15 72%)'}}/>
      <svg width="1200" height="630" viewBox="0 0 1200 630" style={{position:'absolute',left:0,top:0}}>
        {Array.from({length:16},(_,i)=><line key={`v${i}`} x1={720+i*40} y1="0" x2={720+i*40} y2="630" stroke="#8ba4c6" strokeOpacity="0.07"/>)}
        {Array.from({length:16},(_,i)=><line key={`h${i}`} x1="720" y1={i*40} x2="1200" y2={i*40} stroke="#8ba4c6" strokeOpacity="0.07"/>)}
      </svg>
      <div style={{display:'flex',position:'absolute',left:0,top:0,width:1200,height:5,background:'linear-gradient(90deg, #a8f3da, #a8f3da 45%, #b5a6f3)'}}/>
      <div style={{display:'flex',position:'absolute',left:60,top:46,alignItems:'center',gap:18}}>
        <div style={{display:'flex',width:66,height:66,alignItems:'center',justifyContent:'center',background:'#e8fff5',borderRadius:18}}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori embeds the local brand asset, with no remote fetch. */}
          <img src={logo} width={56} height={56} alt="Narrax logo"/>
        </div>
        <span style={{fontSize:38,fontWeight:700,letterSpacing:5}}>NARRAX</span>
      </div>
      <div style={{display:'flex',position:'absolute',right:60,top:62,padding:'12px 18px',border:'1px solid #405452',borderRadius:30,color:'#b9efdd',fontSize:17,letterSpacing:3}}>SOLANA / RESEARCH</div>
      <div style={{display:'flex',position:'absolute',left:62,top:150,fontSize:16,letterSpacing:3,color:'#a8f3da'}}>{home?(id?'NARASI + SMART MONEY':'NARRATIVES + SMART MONEY'):copy.label}</div>
      <div style={{display:'flex',position:'absolute',left:60,top:190,width:650,flexDirection:'column'}}>
        {home?<div style={{display:'flex',flexDirection:'column',fontSize:72,fontWeight:700,lineHeight:1.06,letterSpacing:-3}}>
          {(id?['Pahami narasi.','Telusuri','buktinya.']:['See the narrative.','Follow the','evidence.']).map((line,i)=><span key={line} style={{color:i===2?'#a8f3da':'#f7fafc'}}>{line}</span>)}
        </div>:<div style={{display:'flex',fontSize:52,fontWeight:700,lineHeight:1.1,letterSpacing:-2}}>{copy.title}</div>}
        <div style={{display:'flex',marginTop:22,maxWidth:620,fontSize:home?25:22,lineHeight:1.35,color:'#b8c7d5'}}>{copy.description}</div>
      </div>
      {/* An authored connection diagram, not a chart or fabricated live metrics. */}
      <div style={{display:'flex',position:'absolute',left:744,top:150,width:400,height:370}}>
        <svg width="400" height="370" viewBox="0 0 400 370" style={{position:'absolute',left:0,top:0}}>
          <circle cx="200" cy="180" r="170" fill="none" stroke="#426064" strokeWidth="1"/>
          <circle cx="200" cy="180" r="129" fill="none" stroke="#66719b" strokeWidth="1" strokeDasharray="4 9"/>
          <circle cx="200" cy="180" r="91" fill="#152a30" stroke="#54746f" strokeWidth="1"/>
          <path d="M200 180 L200 37 M200 180 L60 266 M200 180 L337 282" fill="none" stroke="#a8f3da" strokeWidth="2"/>
          <path d="M200 37 Q365 90 337 282 Q170 365 60 266 Q16 100 200 37" fill="none" stroke="#9b98ce" strokeWidth="1.5" strokeDasharray="5 7"/>
          {[[200,37],[60,266],[337,282],[345,93],[92,88],[203,350]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i<3?6:4} fill={i%2?'#b5a6f3':'#a8f3da'}/>)}
        </svg>
        <div style={{display:'flex',position:'absolute',left:136,top:116,width:128,height:128,borderRadius:32,alignItems:'center',justifyContent:'center',background:'linear-gradient(145deg, #effff8, #a8f3da)',border:'1px solid #eafff7',boxShadow:'0 12px 50px #070d16'}}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Reuse the supplied Narrax symbol at a readable scale. */}
          <img src={logo} width={108} height={108} alt=""/>
        </div>
        {topics.map((label,i)=><div key={label} style={{display:'flex',position:'absolute',left:[109,0,250][i],top:[0,278,296][i],padding:'12px 16px',background:'#111e2a',border:`1px solid ${i===1?'#686084':'#42645e'}`,borderRadius:12,color:i===1?'#d1c8f8':'#c4f7e5',fontSize:17,letterSpacing:2}}>{label}</div>)}
      </div>
      <div style={{display:'flex',position:'absolute',left:60,right:60,bottom:36,paddingTop:20,borderTop:'1px solid #2c3a45',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:21,fontWeight:700,color:'#f7fafc'}}>{new URL(siteOrigin()).hostname}</span>
        <span style={{fontSize:18,color:'#a6b7c7'}}>{id?'Bukti, bukan janji.':'Evidence, not promises.'}</span>
      </div>
    </div>,
    {width:1200,height:630,headers:{'Cache-Control':'public, max-age=86400, stale-while-revalidate=604800'}},
  );
}
