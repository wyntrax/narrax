'use client';
import {useEffect,useRef,type ReactNode} from 'react';
export function Reveal({children}: {children:ReactNode}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const node=ref.current;if(!node||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){node.animate([{opacity:.7,transform:'translateY(14px)'},{opacity:1,transform:'translateY(0)'}],{duration:500,easing:'ease-out'});observer.disconnect();}},{threshold:.15});
  observer.observe(node);return()=>observer.disconnect();
 },[]);
 return <div ref={ref} className="reveal">{children}</div>;
}
