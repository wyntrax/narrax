import type {ReactNode} from 'react';
import {Header, Footer} from '@/components/chrome';
export default function Layout({children}: {children: ReactNode}) {return <div className="marketing"><Header/>{children}<Footer/></div>;}
