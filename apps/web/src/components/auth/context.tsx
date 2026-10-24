'use client';
import {createContext, useContext} from 'react';
export interface ResearchWallet {address: string; name: string; signMessage: (message: Uint8Array) => Promise<Uint8Array>; /** Explicit user-initiated mainnet transaction signing; never broadcasts. */ signTransaction?: (transaction: Uint8Array) => Promise<Uint8Array>}
export interface AuthAdapter {ready: boolean; authenticated: boolean; userId: string | null; login: () => void; logout: () => Promise<void>; getAccessToken: () => Promise<string | null>; /** Privy identity token, when the SDK exposes one. Used only so the API can read a verified email. */ getIdentityToken?: () => Promise<string | null>; connectWallet: () => void | Promise<void>; wallets: ResearchWallet[]; createWallet: () => Promise<void>}
export const AuthContext = createContext<AuthAdapter | null>(null);
export function useAuth() {const value = useContext(AuthContext); if (!value) throw new Error('Auth provider missing'); return value;}
