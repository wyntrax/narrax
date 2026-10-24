import type {Metadata} from 'next';
import type {ReactNode} from 'react';
export const metadata:Metadata={robots:{index:false,follow:false},alternates:{canonical:null,languages:{}},title:{default:'Narrax Workspace',template:'%s | Narrax'}};
export default function Layout({children}:{children:ReactNode}){return children;}
