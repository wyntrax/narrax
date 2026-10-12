'use client';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState} from 'react';
import {NetworkPoster} from './network-poster';
const Canvas=dynamic(()=>import('./constellation'),{ssr:false});
const Preview=dynamic(()=>import('./preview'),{ssr:false});
export function LazyCanvas(){const [ready,setReady]=useState(false);useEffect(()=>{const reduced=matchMedia('(prefers-reduced-motion: reduce)');let idle=0,frame=0;const schedule=()=>{cancelAnimationFrame(frame);if('cancelIdleCallback' in window)cancelIdleCallback(idle);if(reduced.matches){setReady(false);return;}frame=requestAnimationFrame(()=>{if('requestIdleCallback' in window)idle=requestIdleCallback(()=>setReady(true));else frame=requestAnimationFrame(()=>setReady(true));});};schedule();reduced.addEventListener('change',schedule);return()=>{cancelAnimationFrame(frame);if('cancelIdleCallback' in window)cancelIdleCallback(idle);reduced.removeEventListener('change',schedule);};},[]);return <div className="generative-art"><NetworkPoster/>{ready&&<Canvas/>}</div>;}
export function LazyPreview(){const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);useEffect(()=>{const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[]);return <div ref={ref} className="preview-reserve">{visible?<Preview/>:<div className="preview-placeholder" aria-hidden/>}</div>;}
