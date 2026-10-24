import type {ReactNode} from 'react';
import {Header, Footer} from '@/components/chrome';
import {JetBrains_Mono,Outfit} from 'next/font/google';
import './marketing-design.css';
import './site-header.css';
import './research.css';
import {EnhancementLoader} from '@/components/marketing/enhancement-loader';
const mono=JetBrains_Mono({subsets:['latin'],weight:'400',display:'swap',variable:'--font-mono',preload:false});
const outfit=Outfit({subsets:['latin'],display:'swap',variable:'--font-marketing'});
export default function Layout({children}: {children: ReactNode}) {return <div className={`marketing ${mono.variable} ${outfit.variable}`}><Header/>{children}<Footer/><EnhancementLoader/></div>;}
