import {describe, expect, it} from 'vitest';
import {creatorProfileUrl,platformLabel} from './links';

describe('creator profile links', () => {
  it('links X handles to x.com, including the twitter alias and both platform casings', () => {
    expect(creatorProfileUrl('x','alice')).toBe('https://x.com/alice');
    expect(creatorProfileUrl('X','alice')).toBe('https://x.com/alice');
    expect(creatorProfileUrl('twitter','alice')).toBe('https://x.com/alice');
  });
  it('links Reddit and TikTok handles to their profile pages', () => {
    expect(creatorProfileUrl('reddit','some_user')).toBe('https://www.reddit.com/user/some_user');
    expect(creatorProfileUrl('tiktok','@dancer')).toBe('https://www.tiktok.com/@dancer');
  });
  it('strips a leading @ and encodes characters that could break the URL', () => {
    expect(creatorProfileUrl('x','@@weird handle/../x')).toBe('https://x.com/weird%20handle%2F..%2Fx');
  });
  it('returns null for an unknown platform or an empty handle, so the caller renders plain text', () => {
    expect(creatorProfileUrl('youtube','someone')).toBeNull();
    expect(creatorProfileUrl('x','   ')).toBeNull();
    expect(creatorProfileUrl('x','@@')).toBeNull();
  });
  it('labels known platforms consistently, whatever the casing', () => {
    expect(platformLabel('x')).toBe('X');
    expect(platformLabel('X')).toBe('X');
    expect(platformLabel('tiktok')).toBe('TikTok');
    expect(platformLabel('reddit')).toBe('Reddit');
    expect(platformLabel('mastodon')).toBe('mastodon');
  });
});
