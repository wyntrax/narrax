'use client';
import {useLocale} from 'next-intl';

/** Public operator-configured destination; no account or wallet details in the URL. */
export function WyntraxLink(){
 const id=useLocale()==='id';
 let href:string;
 try{const url=new URL(process.env.NEXT_PUBLIC_WYNTRAX_URL??'');if(url.protocol!=='https:'||url.username||url.password)return null;href=url.href;}catch{return null;}
 return <div className="wyntrax-membership"><p className="small-note">{id?'Kelola keanggotaan Anda di Wyntrax, lalu verifikasi wallet Solana yang sama di sini. Setelah aktivasi, segarkan akses Anda.':'Manage your membership on Wyntrax, then verify the same Solana wallet here. After activation, refresh your access.'}</p><a className="button button-ghost" href={href} target="_blank" rel="noopener noreferrer">{id?'Buka Wyntrax':'Open Wyntrax'} ↗</a></div>;
}
