import { describe, expect, it } from 'vitest';
import { TOKEN_IMAGE_ORIGINS, tokenImageUrl } from './token-image';

describe('token artwork URLs', () => {
  it('accepts the explicit DEX and metadata artwork origins', () => {
    expect(TOKEN_IMAGE_ORIGINS).toEqual(['https://cdn.dexscreener.com', 'https://dd.dexscreener.com', 'https://cdn.helius-rpc.com', 'https://images.pump.fun', 'https://arweave.net', 'https://ipfs.io', 'https://gateway.irys.xyz']);
    for(const origin of TOKEN_IMAGE_ORIGINS)expect(tokenImageUrl(`${origin}/art.png`)).toBe(`${origin}/art.png`);
    expect(tokenImageUrl('https://dd.dexscreener.com/ds-data/tokens/solana/a.png')).toBe('https://dd.dexscreener.com/ds-data/tokens/solana/a.png');
    expect(tokenImageUrl('https://cdn.dexscreener.com/tokens/a.png?v=2')).toBe('https://cdn.dexscreener.com/tokens/a.png?v=2');
  });

  it('rejects untrusted origins, credentials and non-URL values', () => {
    for (const value of [
      'https://evil.example/a.png',
      'https://dd.dexscreener.com.evil.example/a.png',
      'https://cdn.helius-rpc.com.evil.example/a.png',
      'http://dd.dexscreener.com/a.png',
      'https://user:pass@dd.dexscreener.com/a.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      '',
      null,
      undefined,
      42,
      {},
      `https://dd.dexscreener.com/${'a'.repeat(2048)}`,
    ]) expect(tokenImageUrl(value)).toBeNull();
  });
});
