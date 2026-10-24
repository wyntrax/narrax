import {NarrativePage} from '@/features/research/narrative';
export default async function Page({params}:{params:Promise<{slug:string}>}){return <NarrativePage slug={(await params).slug}/>;}
