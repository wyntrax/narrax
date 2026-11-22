import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {BRAND_ASSETS, BrandLogo, platformBrand, type BrandKey} from './brand-logo';

afterEach(() => {
  cleanup();
});

describe('BrandLogo', () => {
  it('renders dark and light asset paths for every supported brand', () => {
    const keys: BrandKey[] = ['narrax', 'solana', 'privy', 'x', 'reddit', 'tiktok'];
    for (const brand of keys) {
      const {container, unmount} = render(<BrandLogo brand={brand} size={24} />);
      const wrapper = container.querySelector('.brand-logo');
      expect(wrapper).toHaveAttribute('data-brand', brand);
      const darkImg = container.querySelector('img.brand-logo-dark');
      const lightImg = container.querySelector('img.brand-logo-light');
      expect(darkImg).toHaveAttribute('src', BRAND_ASSETS[brand].dark);
      expect(lightImg).toHaveAttribute('src', BRAND_ASSETS[brand].light);
      unmount();
    }
  });

  it('supports inverted surfaces and accessible labels', () => {
    const {container} = render(<BrandLogo brand="narrax" size={28} inverted label="Narrax emblem" />);
    const wrapper = screen.getByRole('img', {name: 'Narrax emblem'});
    expect(wrapper).toHaveClass('brand-logo--inverted');
    expect(wrapper).toHaveAttribute('data-inverted', 'true');
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });

  it('maps raw platform names to logo keys', () => {
    expect(platformBrand('x')).toBe('x');
    expect(platformBrand('Twitter')).toBe('x');
    expect(platformBrand('reddit')).toBe('reddit');
    expect(platformBrand('TikTok')).toBe('tiktok');
    expect(platformBrand('telegram')).toBeNull();
  });
});
