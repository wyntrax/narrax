'use client';
import {useLocale, useTranslations} from 'next-intl';
import {usePathname, useRouter} from '@/i18n/navigation';
import {useState} from 'react';
import {ChevronDown, Moon, Sun} from 'lucide-react';

export function ThemeToggle({
  initial,
  showLabel = false,
  className = '',
}: {
  initial: string;
  showLabel?: boolean;
  className?: string;
}) {
  const [theme, setTheme] = useState(initial);
  const t = useTranslations('common');
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={`${showLabel ? 'theme-toggle-pill' : 'icon-button'} ${className}`.trim()}
      aria-label={t('theme')}
      data-theme-state={theme}
      onClick={() => {
        const update = () => {
          document.documentElement.dataset.theme = next;
          document.cookie = `NARRA_THEME=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
          setTheme(next);
          window.dispatchEvent(new Event('narrax-theme-change'));
        };
        if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          document.startViewTransition(update);
        } else {
          update();
        }
      }}
    >
      {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      {showLabel && <span>{theme === 'dark' ? t('lightMode') : t('darkMode')}</span>}
    </button>
  );
}

export function LocaleToggle() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('common');
  return (
    <label className="locale-select">
      <select
        className="locale-control"
        aria-label={t('language')}
        value={locale}
        onChange={event => {
          const next = event.target.value === 'id' ? 'id' : 'en';
          document.cookie = `NARRA_LOCALE=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
          router.replace(pathname, {locale: next});
        }}
      >
        <option value="en">EN</option>
        <option value="id">ID</option>
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </label>
  );
}
