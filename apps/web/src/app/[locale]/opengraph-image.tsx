import {ImageResponse} from 'next/og';
import {OG_TOKENS as colors} from '@/config/site';
import en from '../../../messages/en.json';
import id from '../../../messages/id.json';
export const alt='NARRA — narrative research on Solana';
export const size={width:1200,height:630};
export const contentType='image/png';
export default async function Image({params}:{params:Promise<{locale:string}>}){const locale=(await params).locale,m=locale==='id'?id:en;return new ImageResponse(<div style={{display:'flex',flexDirection:'column',justifyContent:'space-between',width:'100%',height:'100%',padding:72,background:colors.background,color:colors.text}}><div style={{display:'flex',alignItems:'center',gap:24}}><div style={{display:'flex',background:colors.accent,color:colors.ink,padding:'10px 18px',borderRadius:16,fontSize:40}}>n</div><div style={{display:'flex',fontSize:36}}>NARRA</div></div><div style={{display:'flex',fontSize:72,maxWidth:980,lineHeight:1.05,color:colors.accent}}>{m.access.headline}</div><div style={{display:'flex',fontSize:23,color:colors.secondary}}>{m.common.disclaimer}</div></div>,size);}
