/**
 * Public profile links for the social accounts behind a narrative. A handle is data from a provider, so an unknown
 * platform returns null and the caller renders the handle as plain text rather than guessing a URL.
 */
export function creatorProfileUrl(platform: string, handle: string): string | null {
  const clean = handle.trim().replace(/^@+/, '');
  if (!clean) return null;
  switch (platform.trim().toLowerCase()) {
    case 'x':
    case 'twitter':
      return `https://x.com/${encodeURIComponent(clean)}`;
    case 'reddit':
      return `https://www.reddit.com/user/${encodeURIComponent(clean)}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${encodeURIComponent(clean)}`;
    default:
      return null;
  }
}

/** A readable platform name. Brand names are not translated. Unknown platforms are title-cased as-is. */
export function platformLabel(platform: string): string {
  const key = platform.trim().toLowerCase();
  if (key === 'x' || key === 'twitter') return 'X';
  if (key === 'reddit') return 'Reddit';
  if (key === 'tiktok') return 'TikTok';
  return platform;
}
