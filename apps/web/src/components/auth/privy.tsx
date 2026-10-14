'use client';
import {PrivyProvider, usePrivy, useConnectWallet} from '@privy-io/react-auth';
import {useWallets, useSignMessage, useCreateWallet, toSolanaWalletConnectors} from '@privy-io/react-auth/solana';
import {useMemo, type ReactNode} from 'react';
import {AuthContext} from './context';
const connectors = toSolanaWalletConnectors();
function Bridge({children}: {children: ReactNode}) {
  const {ready, authenticated, user, login, logout, getAccessToken} = usePrivy();
  const {connectWallet} = useConnectWallet(); const {wallets} = useWallets(); const {signMessage} = useSignMessage(); const {createWallet} = useCreateWallet();
  const value = useMemo(() => ({ready, authenticated, userId: user?.id ?? null, login, logout, getAccessToken,
    connectWallet: () => connectWallet({walletChainType:'solana-only'}), createWallet: async () => {await createWallet();},
    wallets: wallets.map(wallet => ({address: wallet.address, name: wallet.standardWallet.name, signMessage: async (message: Uint8Array) => (await signMessage({message, wallet})).signature}))
  }), [ready, authenticated, user?.id, login, logout, getAccessToken, connectWallet, createWallet, wallets, signMessage]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export default function AuthProvider({children,appId}: {children: ReactNode;appId:string}) {return <PrivyProvider appId={appId} config={{loginMethods:['google','email','wallet'], appearance:{walletChainType:'solana-only'}, externalWallets:{solana:{connectors}}, embeddedWallets:{solana:{createOnLogin:'off'}}}}><Bridge>{children}</Bridge></PrivyProvider>;}
