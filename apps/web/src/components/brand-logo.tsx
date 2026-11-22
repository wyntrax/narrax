import Image from 'next/image';

export type BrandKey = 'narrax' | 'solana' | 'privy' | 'x' | 'reddit' | 'tiktok';

export const BRAND_ASSETS: Record<BrandKey, {dark: string; light: string}> = {
  narrax: {dark: '/narrax-logo-dark.svg', light: '/narrax-logo-light.svg'},
  solana: {dark: '/solana-logo-white.svg', light: '/solana-logo-black.svg'},
  privy: {dark: '/privy-white.svg', light: '/privy-black.svg'},
  x: {dark: '/x-white.svg', light: '/x-black.svg'},
  reddit: {dark: '/reddit-white.svg', light: '/reddit-black.svg'},
  tiktok: {dark: '/tiktok-white.svg', light: '/tiktok-black.svg'},
};

/**
 * Renders both dark-mode and light-mode vector logos from `/public` and switches via CSS
 * on `:root[data-theme="light"]`, preventing theme-toggle network fetches or SSR hydration flicker.
 */
export function BrandLogo({
  brand,
  size,
  className = '',
  inverted = false,
  label,
}: {
  brand: BrandKey;
  size?: number;
  className?: string;
  inverted?: boolean;
  label?: string;
}) {
  const assets = BRAND_ASSETS[brand];
  const imgSize = size ?? 36;
  const decorative = !label;
  return (
    <span
      className={`brand-logo ${inverted ? 'brand-logo--inverted' : ''} ${className}`.trim()}
      data-brand={brand}
      data-inverted={inverted ? 'true' : undefined}
      style={size !== undefined ? {width: size, height: size} : undefined}
      aria-hidden={decorative ? true : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <Image
        src={assets.dark}
        width={imgSize}
        height={imgSize}
        alt=""
        aria-hidden="true"
        className="brand-logo-img brand-logo-dark"
        unoptimized
      />
      <Image
        src={assets.light}
        width={imgSize}
        height={imgSize}
        alt=""
        aria-hidden="true"
        className="brand-logo-img brand-logo-light"
        unoptimized
      />
    </span>
  );
}

/** Maps a raw social platform identifier to its matching logo asset key. */
export function platformBrand(platform: string): 'x' | 'reddit' | 'tiktok' | null {
  const key = platform.trim().toLowerCase();
  if (key === 'x' || key === 'twitter') return 'x';
  if (key === 'reddit') return 'reddit';
  if (key === 'tiktok') return 'tiktok';
  return null;
}
