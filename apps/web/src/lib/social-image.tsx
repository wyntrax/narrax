import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {siteOrigin} from '@/config/site';
import type {SeoLocale} from './seo';
import {socialPreview} from './social-preview';

function cleanSvgDataUri(rawSvg: string, replaceStroke?: string) {
  let cleaned = rawSvg.replace(/<path\b[^>]*display=["']none["'][^>]*\/?>/gi, '');
  if (replaceStroke) cleaned = cleaned.replaceAll('#050609', replaceStroke);
  return `data:image/svg+xml;base64,${Buffer.from(cleaned).toString('base64')}`;
}

export async function renderSocialImage(locale: SeoLocale, key: string) {
  const copy = socialPreview(locale, key);
  if (!copy) return new Response('Not found', {status: 404});
  if (key === 'home') {
    const image = await readFile(path.join(process.cwd(), 'public/og-default.png'));
    return new Response(new Uint8Array(image), {headers: {'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800'}});
  }

  const publicDir = path.join(process.cwd(), 'public');
  const [rawNarrax, rawSolana, rawWyntrax, plateBuf] = await Promise.all([
    readFile(path.join(publicDir, 'narrax-logo-dark.svg'), 'utf8'),
    readFile(path.join(publicDir, 'solana-logo-white.svg'), 'utf8'),
    readFile(path.join(publicDir, 'wyntrax-symbol.svg'), 'utf8'),
    readFile(path.join(publicDir, 'plates/narrax-footer-observatory.jpg')),
  ]);

  const logoWhite = cleanSvgDataUri(rawNarrax, '#ffffff');
  const solanaWhite = cleanSvgDataUri(rawSolana);
  const wyntraxUri = cleanSvgDataUri(rawWyntrax);
  const observatoryPlate = `data:image/jpeg;base64,${plateBuf.toString('base64')}`;

  const id = locale === 'id';
  const topics = id ? ['NARASI', 'WALLET', 'TOKEN'] : ['NARRATIVES', 'WALLETS', 'TOKENS'];
  const titleSize = copy.title.length > 52 ? 44 : 50;

  return new ImageResponse(
    <div style={{display:'flex',position:'relative',width:1200,height:630,background:'#050505',color:'#fafafa',fontFamily:'sans-serif',overflow:'hidden'}}>
      {/* Bespoke Narrax Celestial Observatory copperplate plate */}
      {/* eslint-disable-next-line @next/next/no-img-element -- Satori embeds the local copperplate asset with no network fetch. */}
      <img src={observatoryPlate} width={960} height={540} alt="" style={{position:'absolute',right:-50,top:20,opacity:0.86}}/>
      <div style={{display:'flex',position:'absolute',left:0,top:0,width:1200,height:630,background:'linear-gradient(90deg, #050505 0%, #050505 44%, rgba(5,5,5,0.78) 68%, rgba(5,5,5,0.34) 100%)'}}/>
      <div style={{display:'flex',position:'absolute',left:0,top:0,width:1200,height:630,background:'linear-gradient(180deg, rgba(5,5,5,0.65) 0%, rgba(5,5,5,0) 20%, rgba(5,5,5,0) 74%, #050505 95%)'}}/>

      {/* Top archival bone accent rule & outer hairline */}
      <div style={{display:'flex',position:'absolute',left:0,top:0,width:1200,height:3,background:'linear-gradient(90deg, #EAE4D7 0%, #76736C 52%, #1C1C1C 100%)'}}/>
      <div style={{display:'flex',position:'absolute',left:14,top:14,width:1172,height:602,borderRadius:20,border:'1px solid rgba(255,255,255,0.10)'}}/>

      {/* Header bar */}
      <div style={{display:'flex',position:'absolute',left:52,right:52,top:42,alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <div style={{display:'flex',width:44,height:44,alignItems:'center',justifyContent:'center',background:'#111113',border:'1px solid rgba(255,255,255,0.22)',borderRadius:12}}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Satori embeds the local brand asset, with no remote fetch. */}
            <img src={logoWhite} width={26} height={26} alt="Narrax logo"/>
          </div>
          <span style={{fontSize:22,fontWeight:700,letterSpacing:5,color:'#fafafa'}}>NARRAX</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 16px',background:'#111113',border:'1px solid rgba(255,255,255,0.16)',borderRadius:999,color:'#dcdcdc',fontSize:13,letterSpacing:2}}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Local Solana vector asset. */}
            <img src={solanaWhite} width={18} height={18} alt=""/>
            <span>SOLANA RESEARCH</span>
          </div>
        </div>
      </div>

      {/* Left editorial copy column */}
      <div style={{display:'flex',position:'absolute',left:52,top:140,width:680,flexDirection:'column'}}>
        <div style={{display:'flex',fontSize:14,letterSpacing:3,color:'#EAE4D7',marginBottom:16}}>{copy.label}</div>
        <div style={{display:'flex',fontSize:titleSize,fontWeight:700,lineHeight:1.1,letterSpacing:-1.5,color:'#fafafa'}}>{copy.title}</div>
        <div style={{display:'flex',marginTop:20,maxWidth:610,fontSize:20,lineHeight:1.45,color:'#a7a6a6'}}>{copy.description}</div>
        <div style={{display:'flex',alignItems:'center',gap:10,marginTop:28}}>
          {topics.map(label => (
            <div key={label} style={{display:'flex',padding:'8px 14px',background:'#141416',border:'1px solid rgba(255,255,255,0.16)',borderRadius:10,color:'#eae4d7',fontSize:13,letterSpacing:2}}>
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom attribution bar */}
      <div style={{display:'flex',position:'absolute',left:52,right:52,bottom:34,paddingTop:16,borderTop:'1px solid rgba(255,255,255,0.12)',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:18,fontWeight:700,color:'#fafafa'}}>{new URL(siteOrigin()).hostname}</span>
        <div style={{display:'flex',alignItems:'center',gap:8,fontSize:15,color:'#a7a6a6'}}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Local Wyntrax symbol asset. */}
          <img src={wyntraxUri} width={16} height={16} alt=""/>
          <span style={{color:'#fafafa',fontWeight:700}}>Wyntrax</span>
          <span>· {id ? 'Riset, bukan prediksi · Bukti, bukan janji.' : 'Research, not prediction · Evidence, not promises.'}</span>
        </div>
      </div>
    </div>,
    {width:1200,height:630,headers:{'Cache-Control':'public, max-age=86400, stale-while-revalidate=604800'}},
  );
}
