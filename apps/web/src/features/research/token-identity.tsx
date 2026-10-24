'use client';
import {useState} from 'react';
import {tokenImageUrl} from '@narra/shared';
import './token-identity.css';

/** Decorative artwork; the adjacent text and mint remain the token's identity. */
export function TokenAvatar({symbol,imageUrl}:{symbol:string;imageUrl?:string|null}){
  const src=tokenImageUrl(imageUrl),[failed,setFailed]=useState<string|null>(null);
  return <span className="token-avatar" aria-hidden="true">
    {src&&failed!==src
      // External CDN images are origin-checked; no server-side image proxy or optimization fetch.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt="" width={36} height={36} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(src)}/>
      : <span>{Array.from(symbol.trim()||'?').slice(0,2).join('').toUpperCase()}</span>}
  </span>;
}

export function TokenIdentity({symbol,name,imageUrl,compact=false}:{symbol:string;name?:string|null;imageUrl?:string|null;compact?:boolean}){
  return <span className={`token-identity${compact?' token-identity-compact':''}${name?' token-identity-named':''}`}><TokenAvatar symbol={symbol} imageUrl={imageUrl}/><span className="token-identity-text"><span className="token-identity-symbol" title={symbol}>{symbol}</span>{name&&<small className="token-identity-name" title={name}>{name}</small>}</span></span>;
}
