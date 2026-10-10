import type {Metadata} from 'next';
import type {ReactNode} from 'react';
export const metadata:Metadata={robots:{index:false,follow:false},title:'Early access | NARRA'};
export default function Layout({children}:{children:ReactNode}){return children;}
