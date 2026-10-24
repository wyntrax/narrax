/** The former narra_ent scratch database now contains application data. */
export function assertTestDatabase(url: URL, expectedName = process.env.NARRA_TEST_DATABASE_NAME): void {
  if (!expectedName || !/^narra_[a-z0-9_]*test(?:_[a-z0-9_]+)?$/.test(expectedName)
    || !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.pathname !== `/${expectedName}`) {
    throw new Error('Explicit isolated local test database required: set NARRA_TEST_DATABASE_NAME and matching DATABASE_URL');
  }
}
