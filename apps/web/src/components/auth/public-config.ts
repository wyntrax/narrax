import {z} from 'zod';
import {PrivyAppId} from '@narra/shared';
import {createTransport} from '@/lib/api';

const PublicConfig = z.object({privyAppId: PrivyAppId.nullable()}).strict();
export async function fetchPrivyAppId(signal: AbortSignal) {
  const request = createTransport(process.env.NEXT_PUBLIC_API_URL ?? '', async () => null);
  const value = await request('/v1/public-config', PublicConfig, 'GET', undefined, false, signal);
  return value.privyAppId ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
}
