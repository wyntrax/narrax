import type {ReactNode} from 'react';
import {Header, Footer} from '@/components/chrome';
import './marketing-design.css';
import './site-header.css';
import './research.css';
import {EnhancementLoader} from '@/components/marketing/enhancement-loader';

export default function Layout({children}: {children: ReactNode}) {
  return (
    <div className="marketing">
      <Header />
      {children}
      <Footer />
      <EnhancementLoader />
    </div>
  );
}
