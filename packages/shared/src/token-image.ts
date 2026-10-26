/** Public artwork origins supplied by DEX Screener and Helius DAS. Shared with browser CSP. */
export const TOKEN_IMAGE_ORIGINS = ['https://cdn.dexscreener.com', 'https://dd.dexscreener.com', 'https://cdn.helius-rpc.com', 'https://images.pump.fun', 'https://arweave.net', 'https://ipfs.io', 'https://gateway.irys.xyz'] as const;

export function tokenImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || !TOKEN_IMAGE_ORIGINS.some(origin => url.origin === origin)) return null;
    return url.href;
  } catch { return null; }
}
