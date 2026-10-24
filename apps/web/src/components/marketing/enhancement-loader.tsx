'use client';
import dynamic from 'next/dynamic';
import {useEffect,useState} from 'react';
const Effects=dynamic(()=>import('./enhancements'),{ssr:false});
export function EnhancementLoader(){const [ready,setReady]=useState(false);useEffect(()=>{const frame=requestAnimationFrame(()=>{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)setReady(true);});return()=>cancelAnimationFrame(frame);},[]);return ready?<Effects/>:null;}
