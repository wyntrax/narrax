import {TradePage} from '@/features/trade/page';
export default async function Page({searchParams}:{searchParams:Promise<{mint?:string}>}){
 const params=await searchParams;return <TradePage initialMint={typeof params.mint==='string'?params.mint:''}/>;
}
