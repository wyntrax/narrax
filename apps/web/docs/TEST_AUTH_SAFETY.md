# Step 0 — production test-auth boundary

Both safeguards were missing from accepted Phase 1. Added a production config guard that rejects **any set value** of `NARRA_WEB_TEST_AUTH`, including `0`. Unset it; do not set it to a false-like string. Development fixtures remain compile-time aliases in `.next-e2e`.

`npm run build` now scans `.next` after compilation. The recursive textual bundle scan rejects the fixture module name, auth token and signature-route/adapter markers, and rejects a missing/empty production build. It scans server/static bundles and manifests, excluding cache and generated types.

Verification: two targeted tests passed. The test invokes the actual env-free Next **build** entry with `NODE_ENV=production` and bypass values `1` and `0`; both exit nonzero before compilation. Scanner regression tests reject missing builds and injected fixture markers. The accepted production `.next` also passed the scan (**267 files**). Subsequent production builds run this check automatically.

No real env files are loaded; the existing env-free wrapper remains required. No FSM, API client, wallet or backend changes.
