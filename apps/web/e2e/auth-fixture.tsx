'use client';
// Compile-time alias in the isolated .next-e2e build only. Never present in a normal build.
import {useState,type ReactNode} from 'react';
import {AuthContext} from '../src/components/auth/context';
import {ADDRESS} from '../src/test/fixtures';
export default function FixtureAuth({children}:{children:ReactNode}){const [authenticated,setAuthenticated]=useState(false),[walletName,setWalletName]=useState<string|null>(null);return <AuthContext.Provider value={{ready:true,authenticated,userId:authenticated?'fixture-user':null,login:()=>setAuthenticated(true),logout:async()=>{setAuthenticated(false);setWalletName(null);},getAccessToken:async()=>authenticated?'fixture-public-test-token':null,connectWallet:()=>setWalletName('Phantom (test fixture)'),createWallet:async()=>setWalletName('Privy'),wallets:walletName?[{address:ADDRESS,name:walletName,signMessage:async()=>{await fetch('/__fixture-signature');return new Uint8Array(64).fill(7);}}]:[]}}>{children}</AuthContext.Provider>;}
