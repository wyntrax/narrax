import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {getTranslations} from 'next-intl/server';
export async function generateMetadata():Promise<Metadata>{const t=await getTranslations('common');return {robots:{index:false,follow:false},alternates:{canonical:null,languages:{}},title:t('earlyAccess')};}
export default function Layout({children}:{children:ReactNode}){return children;}
