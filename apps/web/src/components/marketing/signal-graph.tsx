'use client';
import {useEffect,useRef} from 'react';
import {useTranslations} from 'next-intl';
import {ArrowUpRight,AudioLines,Focus,MessageCircle,Radar,ScanLine} from 'lucide-react';
import {BrandMark} from '@/components/brand-mark';
import {Link} from '@/i18n/navigation';

/** An explanatory workflow, never a simulated dashboard or live-data indicator. */
export function SignalGraph(){
 const t=useTranslations('visual'),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const node=ref.current;if(!node)return;const observer=new IntersectionObserver(([entry])=>{node.dataset.visible=String(entry?.isIntersecting??false);});observer.observe(node);return()=>observer.disconnect();},[]);
 return <div className="signal-graph" ref={ref} data-visible="false">
  <div className="graph-toolbar"><span className="graph-tab"><Waymark/>{t('workflow')}</span><span className="graph-description">{t('diagram')}</span><Link href="/app/radar" className="graph-open">{t('openRadar')}<ArrowUpRight size={15}/></Link></div>
  <div className="graph-stage">
   <svg className="graph-wires" viewBox="0 0 1100 380" preserveAspectRatio="none" aria-hidden="true"><g className="wire-base"><path d="M240 80C390 80 360 190 550 190"/><path d="M240 190H550"/><path d="M240 300C390 300 360 190 550 190"/><path d="M550 190C730 190 690 110 850 110"/><path d="M550 190C730 190 690 270 850 270"/></g><g className="wire-flow"><path d="M240 80C390 80 360 190 550 190"/><path d="M240 190H550"/><path d="M240 300C390 300 360 190 550 190"/><path d="M550 190C730 190 690 110 850 110"/><path d="M550 190C730 190 690 270 850 270"/></g></svg>
   <div className="graph-sources">{[{name:'X',Icon:ScanLine,key:'conversation'},{name:'Reddit',Icon:MessageCircle,key:'communities'},{name:'TikTok',Icon:AudioLines,key:'culture'}].map(({name,Icon,key},i)=><div className="graph-source" key={name}><span className="node-icon"><Icon size={18}/></span><div><strong>{name}</strong><span>{t(key)}</span></div><span className="node-port" aria-hidden="true"/><small>0{i+1}</small></div>)}</div>
   <div className="graph-core"><div className="core-orbit" aria-hidden="true"/><div className="core-emblem"><BrandMark/></div><strong>NARRAX</strong><span>{t('context')}</span></div>
   <div className="graph-results"><div className="graph-result"><Radar size={21}/><strong>{t('narratives')}</strong><p>{t('narrativesBody')}</p><div className="node-rule" aria-hidden="true"/></div><div className="graph-result"><Focus size={21}/><strong>{t('evidence')}</strong><p>{t('evidenceBody')}</p><div className="node-rule" aria-hidden="true"/></div></div>
  </div>
  <div className="graph-caption"><span>{t('watchlist')}</span><span>{t('noPrediction')}</span></div>
 </div>;
}
function Waymark(){return <span className="waymark" aria-hidden="true">⌘</span>;}
