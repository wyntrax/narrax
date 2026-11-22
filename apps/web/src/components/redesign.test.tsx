import {cleanup, render, screen} from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import messages from '../../messages/en.json';
import {Header, Footer} from './chrome';
import {NotFoundConduit} from './not-found-conduit';
import {ObservatoryFooter} from './marketing/observatory-footer';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({replace: vi.fn(), refresh: vi.fn()}),
  Link: ({href, children, className, 'aria-label': ariaLabel}: {href: string; children: ReactNode; className?: string; 'aria-label'?: string}) => (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => ({value: 'dark'}),
  }),
}));

vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async (namespace: string) => {
    const parts = namespace.split('.');
    let node: Record<string, unknown> = messages as unknown as Record<string, unknown>;
    for (const part of parts) {
      node = (node[part] ?? {}) as Record<string, unknown>;
    }
    return (key: string) => String(node[key] ?? key);
  },
}));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'IntersectionObserver',
    vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
      unobserve: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
      unobserve: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Redesign surfaces', () => {
  it('keeps header free of early-access CTA and theme toggle while rendering them inside the Observatory footer', async () => {
    const headerTree = await Header();
    const {unmount} = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {headerTree}
      </NextIntlClientProvider>,
    );

    expect(screen.queryByRole('button', {name: 'Switch color theme'})).toBeNull();
    expect(screen.queryByRole('combobox', {name: 'Language'})).toBeNull();
    expect(screen.queryByRole('link', {name: /early access/i})).toBeNull();
    unmount();

    const footerTree = await Footer();
    const {container} = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {footerTree}
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('button', {name: 'Switch color theme'})).toBeInTheDocument();
    expect(screen.getByRole('combobox', {name: 'Language'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: /Get early access/i})).toHaveAttribute('href', '/early-access');
    expect(container.querySelector('[data-brand="solana"]')).toBeInTheDocument();
    expect(container.querySelector('[data-brand="privy"]')).toBeInTheDocument();
  });

  it('renders the 404 Conduit stage with slashed-zero SVG, navigation links, and footer theme/access controls', () => {
    const {container} = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NotFoundConduit
          theme="dark"
          title="Signal not found"
          subtitle="Conduit offline"
          homeLabel="Return to Landing"
          radarLabel="Open radar"
          accessLabel="Claim Early Access"
          replayLabel="Replay plate"
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('heading', {level: 1, name: '404 · Signal not found'})).toBeInTheDocument();
    expect(container.querySelector('svg.conduit-numeral')).toBeInTheDocument();
    expect(container.querySelector('canvas.conduit-canvas')).toBeInTheDocument();

    const homeLinks = screen.getAllByRole('link', {name: /Return to Landing/i});
    expect(homeLinks).toHaveLength(2);
    for (const link of homeLinks) expect(link).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', {name: /Open radar/i})).toHaveAttribute('href', '/app/radar');
    expect(screen.getByRole('link', {name: /Claim Early Access/i})).toHaveAttribute('href', '/early-access');

    expect(screen.getByRole('button', {name: 'Switch color theme'})).toBeInTheDocument();
    expect(screen.getByRole('combobox', {name: 'Language'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Replay plate'})).toBeInTheDocument();
  });

  it('renders the ObservatoryFooter blueprint overlay and engraving canvas around slotted footer content', () => {
    const {container} = render(
      <ObservatoryFooter plateLabel="Narrax Observatory">
        <div className="footer-columns">
          <div className="footer-col">Content</div>
        </div>
      </ObservatoryFooter>,
    );

    expect(container.querySelector('canvas.engraving-canvas')).toBeInTheDocument();
    expect(container.querySelector('svg.blueprint-svg')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });
});
