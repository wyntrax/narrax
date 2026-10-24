import {TOKEN_IMAGE_ORIGINS} from '@narra/shared';
export function contentSecurityPolicy(nonce: string, api: string | undefined, development = false) {
  const origins: string[] = [];
  if (api) { try { const u = new URL(api); if (['http:', 'https:'].includes(u.protocol)) { origins.push(u.origin); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; origins.push(u.origin); } } catch { /* Invalid configuration is shown by the client. */ } }
  return ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'", `img-src 'self' data: blob: ${TOKEN_IMAGE_ORIGINS.join(' ')}`, "font-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    'frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com',
    `connect-src 'self' ${origins.join(' ')} https://auth.privy.io https://api.privy.io https://*.rpc.privy.systems https://explorer-api.walletconnect.com wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://api.mainnet-beta.solana.com https://api.devnet.solana.com https://api.testnet.solana.com${development ? ' ws://localhost:4010' : ''}`,
    "worker-src 'self' blob:", "manifest-src 'self'"].join('; ');
}
