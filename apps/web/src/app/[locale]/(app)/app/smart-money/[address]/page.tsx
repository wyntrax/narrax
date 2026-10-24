import {SmartWalletPage} from '@/features/research/smart-money';
export default async function Page({params}:{params:Promise<{address:string}>}){return <SmartWalletPage address={(await params).address}/>;}
