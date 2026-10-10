'use client';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState} from 'react';
const Canvas=dynamic(()=>import('./constellation'),{ssr:false});
const Preview=dynamic(()=>import('./preview'),{ssr:false});
export function LazyCanvas(){return <Canvas/>;}
export function LazyPreview(){const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);useEffect(()=>{const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[]);return <div ref={ref} className="preview-reserve">{visible?<Preview/>:<div className="preview-placeholder" aria-hidden/>}</div>;}
