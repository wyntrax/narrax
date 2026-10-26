import { createHmac } from 'node:crypto';
import type { WyntraxMembershipEvent } from '@narra/queue';

export interface WyntraxDeliveryConfig {
  url: string;
  secret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Same signing contract Narrax verifies on inbound Wyntrax events: HMAC-SHA256 over `${timestamp}.${body}`. */
export function signWyntraxBody(body: string, timestamp: string, secret: string): string {
  return 'v1=' + createHmac('sha256', secret).update(timestamp).update('.').update(body).digest('hex');
}

function safeWebhookUrl(value: string): URL {
  const url = new URL(value);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Wyntrax webhook URL must use HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('Wyntrax webhook URL must not contain credentials, query or fragment');
  return url;
}

/** Posts one event. The caller retries through the queue; this function never logs the secret or response body. */
export async function deliverWyntraxMembership(event: WyntraxMembershipEvent, config: WyntraxDeliveryConfig, now = new Date()): Promise<'delivered'> {
  const url = safeWebhookUrl(config.url);
  const body = JSON.stringify(event);
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
  try {
    const response = await (config.fetch ?? fetch)(url, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-wyntrax-event-id': event.id,
        'x-wyntrax-timestamp': timestamp,
        'x-wyntrax-signature': signWyntraxBody(body, timestamp, config.secret),
      },
      body,
    });
    if (!response.ok) throw new Error(`Wyntrax webhook returned HTTP ${response.status}`);
    return 'delivered';
  } finally { clearTimeout(timer); }
}
