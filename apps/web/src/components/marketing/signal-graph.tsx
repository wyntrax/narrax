'use client';
import {useEffect,useRef,useState} from 'react';
import {useTranslations} from 'next-intl';
import {ArrowUpRight,AudioLines,Focus,MessageCircle,Radar,ScanLine} from 'lucide-react';
import {BrandMark} from '@/components/brand-mark';
import {Link} from '@/i18n/navigation';

/** An explanatory workflow, never a simulated dashboard or live-data indicator. */
export function SignalGraph(){
  const t=useTranslations('visual'),ref=useRef<HTMLDivElement>(null);
  const [wires,setWires]=useState({width:1100,height:380,paths:['M240 80C390 80 360 190 550 190','M240 190H550','M240 300C390 300 360 190 550 190','M550 190C730 190 690 110 850 110','M550 190C730 190 690 270 850 270']});
  useEffect(()=>{const node=ref.current;if(!node)return;const observer=new IntersectionObserver(([entry])=>{node.dataset.visible=String(entry?.isIntersecting??false);});observer.observe(node);return()=>observer.disconnect();},[]);
  useEffect(()=>{
   const stage=ref.current?.querySelector<HTMLElement>('.graph-stage');if(!stage)return;
   const core=stage.querySelector<HTMLElement>('.graph-core'),emblem=stage.querySelector<HTMLElement>('.core-emblem');
   const sources=[...stage.querySelectorAll<HTMLElement>('.graph-source')],results=[...stage.querySelectorAll<HTMLElement>('.graph-result')];
   if(!core||!emblem)return;
   let disposed=false;
   const update=()=>{
    if(disposed)return;
    const box=stage.getBoundingClientRect(),vertical=window.matchMedia('(max-width:700px)').matches;
    const anchor=(node:HTMLElement,edge:'top'|'bottom'|'left'|'right')=>{
     const r=node.getBoundingClientRect();
     return {x:(edge==='left'?r.left:edge==='right'?r.right:r.left+r.width/2)-box.left,y:(edge==='top'?r.top:edge==='bottom'?r.bottom:r.top+r.height/2)-box.top};
    };
    const curve=(a:{x:number;y:number},b:{x:number;y:number})=>vertical
     ?`M${a.x} ${a.y}C${a.x} ${(a.y+b.y)/2} ${b.x} ${(a.y+b.y)/2} ${b.x} ${b.y}`
     :`M${a.x} ${a.y}C${(a.x+b.x)/2} ${a.y} ${(a.x+b.x)/2} ${b.y} ${b.x} ${b.y}`;
    const paths=[...sources.map(source=>curve(anchor(source,vertical?'bottom':'right'),anchor(emblem,vertical?'top':'left'))),...results.map(result=>curve(anchor(vertical?core:emblem,vertical?'bottom':'right'),anchor(result,vertical?'top':'left')))];
    setWires({width:box.width,height:box.height,paths});
   };
   const observer=new ResizeObserver(update);
   [stage,core,emblem,...sources,...results].forEach(node=>observer.observe(node));
   window.addEventListener('resize',update);update();
   void document.fonts.ready.then(update);
   return()=>{disposed=true;observer.disconnect();window.removeEventListener('resize',update);};
  },[]);
 return <div className="signal-graph" ref={ref} data-visible="false">
  <div className="graph-toolbar"><span className="graph-tab"><Waymark/>{t('workflow')}</span><span className="graph-description">{t('diagram')}</span><Link href="/app/radar" className="graph-open">{t('openRadar')}<ArrowUpRight size={15}/></Link></div>
  <div className="graph-stage">
   <svg className="graph-wires" viewBox={`0 0 ${wires.width} ${wires.height}`} preserveAspectRatio="none" aria-hidden="true"><g className="wire-base">{wires.paths.map((d,i)=><path key={i} d={d}/>)}</g><g className="wire-flow">{wires.paths.map((d,i)=><path key={i} d={d}/>)}</g></svg>
   <div className="graph-sources">{[{name:'X',Icon:ScanLine,key:'conversation'},{name:'Reddit',Icon:MessageCircle,key:'communities'},{name:'TikTok',Icon:AudioLines,key:'culture'}].map(({name,Icon,key},i)=><div className="graph-source" key={name}><span className="node-icon"><Icon size={18}/></span><div><strong>{name}</strong><span>{t(key)}</span></div><span className="node-port" aria-hidden="true"/><small>0{i+1}</small></div>)}</div>
   <div className="graph-core"><div className="core-orbit" aria-hidden="true"/><div className="core-emblem"><BrandMark/></div><strong>NARRAX</strong><span>{t('context')}</span></div>
   <div className="graph-results"><div className="graph-result"><Radar size={21}/><strong>{t('narratives')}</strong><p>{t('narrativesBody')}</p><div className="node-rule" aria-hidden="true"/></div><div className="graph-result"><Focus size={21}/><strong>{t('evidence')}</strong><p>{t('evidenceBody')}</p><div className="node-rule" aria-hidden="true"/></div></div>
  </div>
  <div className="graph-caption"><span>{t('watchlist')}</span><span>{t('noPrediction')}</span></div>
 </div>;
}
function Waymark(){return <span className="waymark" aria-hidden="true">⌘</span>;}
