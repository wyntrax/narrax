import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TokenAvatar, TokenIdentity } from './token-identity';
import Link from 'next/link';

afterEach(cleanup);

describe('token artwork', () => {
  it('shows allow-listed provider artwork beside the symbol and name', () => {
    const { container } = render(<TokenIdentity symbol="ZORB" name="Zorb Token" imageUrl="https://dd.dexscreener.com/ds-data/tokens/solana/z.png" />);
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://dd.dexscreener.com/ds-data/tokens/solana/z.png');
    expect(image?.getAttribute('alt')).toBe('');
    expect(screen.getByText('ZORB')).toHaveAttribute('title', 'ZORB');
    expect(screen.getByText('Zorb Token')).toHaveAttribute('title', 'Zorb Token');
    expect(screen.getByText('ZORB')).toHaveClass('token-identity-symbol');
    expect(screen.getByText('Zorb Token')).toHaveClass('token-identity-name');
  });

  it('falls back to initials for missing or untrusted artwork', () => {
    for (const imageUrl of [null, 'https://evil.example/z.png', 'javascript:alert(1)']) {
      const { container } = render(<TokenAvatar symbol="demo" imageUrl={imageUrl} />);
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByText('DE')).toBeVisible();
      cleanup();
    }
  });

  it('removes broken artwork instead of leaving a broken image', () => {
    const { container } = render(<TokenAvatar symbol="demo" imageUrl="https://dd.dexscreener.com/ds-data/tokens/solana/z.png" />);
    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('DE')).toBeVisible();
  });
  it('supports compact symbol-only identities and retains the existing initials placeholder',()=>{
    const {container}=render(<TokenIdentity symbol="demo" compact/>);
    expect(container.querySelector('.token-identity')).toHaveClass('token-identity-compact');
    expect(container.querySelector('.token-identity-name')).toBeNull();
    expect(screen.getByText('DE')).toBeVisible();expect(screen.getByText('demo')).toBeVisible();
  });
  it('tries replacement artwork after a broken image and keeps decorative content out of accessible link names',()=>{
    const {container,rerender}=render(<Link href="/app/tokens/mint"><TokenIdentity symbol="demo" name="Demo token" imageUrl="https://cdn.dexscreener.com/old.png" compact/></Link>);
    fireEvent.error(container.querySelector('img')!);expect(screen.getByText('DE')).toBeVisible();
    rerender(<Link href="/app/tokens/mint"><TokenIdentity symbol="demo" name="Demo token" imageUrl="https://cdn.dexscreener.com/new.png" compact/></Link>);
    expect(container.querySelector('img')).toHaveAttribute('src','https://cdn.dexscreener.com/new.png');
    expect(screen.getByRole('link',{name:'demo Demo token'})).toBeVisible();
  });
});
