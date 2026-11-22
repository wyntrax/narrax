import {getTranslations} from 'next-intl/server';
import {cookies} from 'next/headers';
import {NotFoundConduit} from '@/components/not-found-conduit';

export default async function NotFound() {
  const t = await getTranslations('common');
  const theme = (await cookies()).get('NARRA_THEME')?.value === 'light' ? 'light' : 'dark';
  return (
    <NotFoundConduit
      theme={theme}
      title={t('notFound')}
      subtitle={t('notFoundSubtitle')}
      homeLabel={t('home')}
      radarLabel={t('openRadar')}
      accessLabel={t('getAccess')}
      replayLabel={t('replayPlate')}
    />
  );
}
