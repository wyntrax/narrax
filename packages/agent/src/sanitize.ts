import { sanitizeUntrusted } from '@narra/shared';
import { AGENT_LIMITS } from './constants';

// eslint-disable-next-line no-control-regex
const CONTROL_KEEP_NEWLINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/** What the user typed, made safe to store and to pass on: no control or bidi characters, one line of whitespace, capped. */
export const sanitizeUserText = (s: string, max: number = AGENT_LIMITS.maxUserMessageChars) => sanitizeUntrusted(s, max);

/**
 * The agent's reply, made safe to show. The client must still render it as plain text; this removes what would hurt even if it
 * did not: HTML, markdown images (a way to leak data through a URL the browser fetches), links with hidden targets, bare URLs
 * and script-like schemes. A reply that mentions a link therefore shows "[link removed]". No tool returns URLs, so nothing
 * legitimate is lost.
 */
export function sanitizeAssistantText(raw: string, max: number = AGENT_LIMITS.maxAssistantChars): string {
  let t = raw.normalize('NFKC').replace(CONTROL_KEEP_NEWLINE, '').replace(/\r\n?/g, '\n');
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');            // images become their alt text
  t = t.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1');           // reference-style images
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');             // inline links become their text
  t = t.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '');           // link reference definitions
  t = t.replace(/\b(?:https?|ftp|file|data|javascript|vbscript):[^\s)]*/gi, '[link removed]');
  t = t.replace(/\bwww\.[^\s)]+/gi, '[link removed]');
  t = t.replace(/<\/?[a-zA-Z!?][^>]*>?/g, '');               // tags, including unterminated ones
  t = t.replace(/[<>]/g, '');
  t = t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
