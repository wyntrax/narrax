/** Image origins supplied by the existing DEX Screener feed. Shared with the browser CSP. */
export const TOKEN_IMAGE_ORIGINS = ['https://cdn.dexscreener.com', 'https://dd.dexscreener.com'] as const;

export function tokenImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || !TOKEN_IMAGE_ORIGINS.some(origin => url.origin === origin)) return null;
    return url.href;
  } catch { return null; }
}
