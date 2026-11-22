import {BrandLogo} from './brand-logo';

/** Renders the theme-aware Narrax brand emblem using `/narrax-logo-dark.svg` and `/narrax-logo-light.svg`. */
export function BrandMark({
  className = '',
  inverted = false,
}: {
  className?: string;
  inverted?: boolean;
}) {
  return (
    <BrandLogo
      brand="narrax"
      inverted={inverted}
      className={`brand-mark ${className}`.trim()}
    />
  );
}
