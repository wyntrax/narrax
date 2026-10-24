import {TokenPage} from '@/features/research/tokens';
export default async function Page({params}:{params:Promise<{mint:string}>}){return <TokenPage mint={(await params).mint}/>;}
