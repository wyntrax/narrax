/**
 * Token names, symbols, websites, social posts, memos and news are untrusted data.
 * They must never be placed in a system prompt. Wrap them here and pass them to the model
 * only as clearly labelled data inside a tool result.
 */
export interface UntrustedField {
  untrusted: true;
  source: string;
  text: string;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeUntrusted(input: string, maxLength = 500): string {
  return input.normalize('NFKC').replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function wrapUntrusted(source: string, input: string, maxLength = 500): UntrustedField {
  return { untrusted: true, source, text: sanitizeUntrusted(input, maxLength) };
}
