import type {ReactNode} from 'react';
import {Header, Footer} from '@/components/chrome';
import {JetBrains_Mono} from 'next/font/google';
import './marketing-design.css';
const mono=JetBrains_Mono({subsets:['latin'],weight:'400',display:'swap',variable:'--font-mono',preload:false});
export default function Layout({children}: {children: ReactNode}) {return <div className={`marketing ${mono.variable}`}><Header/>{children}<Footer/></div>;}
