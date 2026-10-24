# Dependency hygiene review

Initial audit **2026-10-10**, restoration verified **2026-10-11**, handoff finalized **2026-10-12**, against `9160bc9:package-lock.json`, with Node **24.18.0**. Audit used npm **11.16.0**; dependency installation is now pinned to **npm 10.9.4** to preserve optional-peer resolution. Registry audit results are a point-in-time snapshot.

## Outcome

- Applied one **web-only, same-major, in-range lockfile remediation**: Next's PostCSS resolves a private `source-map-js@1.2.2` instead of the vulnerable hoisted `1.2.1`.
- This remediation changes **no API, worker, shared-package, or root test-tooling version or dependency resolution**. It adds no install script. `apps/web/package.json` did not need another change.
- The earlier frontend installation changed Jayson's optional `utf-8-validate` peer **5.0.10 → 6.0.6** for `packages/tx-verify` and `workers/executor`. **Restored to 5.0.10** at its exact baseline path. npm 11.16.0 removed this valid private peer during regeneration; npm 10.9.4 preserves it and is now pinned in root `packageManager`. No root dependency override remains.
- All **14 high and 2 critical audit package entries** are classified below. These are package-level/metavulnerability counts, not 16 independent exploitable application bugs.
- **14 lifecycle approvals remain pending**. None was approved, denied, rebuilt, or executed during this task.
- This dependency audit did not read, print or change real environment files, or invoke lifecycle scripts. The owning verification session's separate env-loader incident and final checks are documented in `PHASE1-REPORT.md`.

### Final restoration evidence

| Consumer resolution | Baseline | Before restoration | Final |
|---|---|---|---|
| `packages/tx-verify → @solana/web3.js → jayson → ws → utf-8-validate` | 5.0.10 | 6.0.6 | **5.0.10** |
| `workers/executor → packages/tx-verify → same chain` | 5.0.10 | 6.0.6 | **5.0.10** |
| All other existing backend/shared resolutions | Original | Original | **Original** |

`node apps/web/scripts/check-backend-lock.cjs` compares parent/dependency resolution edges, including installed optional peers and dev tooling, against `9160bc9`: **20 workspace/root graphs; zero changed existing edges**. Root Vitest gains 56 additional optional frontend-tooling edges from jsdom, with no old version replaced. Final lock: **1,591 records; 1,228 added paths; zero removed paths; zero changed versions at retained paths**.

Actual installed Node resolution confirms Jayson uses **5.0.10**, and Next uses isolated **source-map-js 1.2.2**. `npm 10.9.4 install --package-lock-only --ignore-scripts --no-audit --no-fund --offline` completed successfully and retained both fixes; npm 10 CI dry-run also passed. The copied private validator was taken from the already-installed identical 5.0.10 package; no native build script ran. Backend tests are run after this restoration; see the main verification report for their outcome.

The sections below retain the initial audit's reachability analysis and distinguish the resolved drift from remaining frontend peer warnings.

## 1. Baseline and resolution-aware comparison

The baseline lock has **363 package records** and no `apps/web` record. The final lock has **1,591 records**: **1,228 added paths**, **zero removed paths**, and **zero version changes at retained paths**. Most additions came from the frontend installation before this review; exactly one added record is this review's source-map fix. Counts include workspace/link and platform-optional records; they are not installed-package counts.

Comparing only retained paths initially missed a removed record, now restored:

```text
node_modules/jayson/node_modules/utf-8-validate@5.0.10
```

The same package/version also exists at:

```text
node_modules/@metamask/sdk/node_modules/utf-8-validate@5.0.10
```

The MetaMask copy alone is **not proof that old consumers still use that version**. Without restoration, Node resolution from `node_modules/jayson/node_modules/ws` found incompatible `node_modules/utf-8-validate@6.0.6`. The restored private copy now resolves to 5.0.10.

### Method

For each workspace, walk its `dependencies` and `optionalDependencies`, then transitively resolve each package by ascending `node_modules` directories and following workspace links. Also inspect installed `peerDependencies`, including optional peers: they can be loaded at runtime even though omitted from a dependencies-only walk. Compare both package-name/version sets and individual parent/dependency resolution edges. Missing nonoptional edges: **zero** for the inspected runtime/peer graphs.

The graph is deliberately conservative. An installed optional peer is not proof that application code executes it. In particular, Prisma's optional CLI peer and TypeScript appear in this closure but are build/development tools. The audit and code-path assessment below distinguish these cases. Dev graphs additionally start at each workspace's `devDependencies` and the root's dev dependencies; the web test script uses root Vitest even though it does not declare a separate Vitest version.

### Every version change affecting API, workers, and packages

All 19 backend/package workspace manifest records are identical to the baseline. Runtime/installed-peer closure sizes below include the workspace itself and count resolved paths, not unique package names.

| Workspace | Initially inspected closure size | Final version changes against `9160bc9` |
| --- | ---: | --- |
| `apps/api` | 177 | None |
| `workers/executor` | 155 | None; Jayson validator restored to 5.0.10 |
| `workers/pipeline` | 99 | None |
| `packages/agent` | 7 | None |
| `packages/ai` | 5 | None |
| `packages/analytics` | 5 | None |
| `packages/database` | 58 | None |
| `packages/market-data` | 3 | None |
| `packages/narrative` | 3 | None |
| `packages/positions` | 2 | None |
| `packages/queue` | 28 | None |
| `packages/realtime` | 12 | None |
| `packages/risk` | 3 | None |
| `packages/shared` | 2 | None |
| `packages/smart-money` | 1 | None |
| `packages/solana` | 29 | None |
| `packages/token-intel` | 4 | None |
| `packages/trading` | 3 | None |
| `packages/tx-verify` | 58 | None; Jayson validator restored to 5.0.10 |

Affected chain:

```text
workers/executor
  -> packages/tx-verify
     -> @solana/web3.js@1.99.0
        -> jayson@4.3.0
           -> node_modules/jayson/node_modules/ws@7.5.13
              -> utf-8-validate (optional peer ^5.0.2)
                 baseline: node_modules/jayson/node_modules/utf-8-validate@5.0.10
                  before restoration: node_modules/utf-8-validate@6.0.6
                  final: node_modules/jayson/node_modules/utf-8-validate@5.0.10
```

Both closures again contain baseline 5.0.10 **and** 6.0.6 through their original consumers. Existing API `ws@8.22.0` and its compatible `utf-8-validate@6.0.6` resolution are unchanged. The initial `npm ls utf-8-validate --package-lock-only --all` also identified frontend Lighthouse and WalletConnect `ws@7` optional-peer mismatches; backend restoration does not claim to fix those separate frontend peer warnings. The owner's restoration requirement authorized returning Jayson to its baseline resolution.

### Shared backend/web resolution identities

The web closure reaches 63 physical records also present in at least one backend/package closure. Their versions are unchanged at those records. All external paths below are under root `node_modules`; `packages/shared` is the workspace record. Multiple copies of similarly named frontend packages do not replace these identities.

| Shared identities, grouped for readability | Versions |
| --- | --- |
| `packages/shared`; `zod` | 0.1.0; 3.25.76 |
| `@noble/curves`; `@noble/hashes` | 1.9.7; 1.8.0 |
| `@solana/codecs-core`; `@solana/codecs-numbers`; `@solana/errors` | 5.5.1 each |
| `@babel/runtime`; `@swc/helpers`; `tslib`; `typescript` (peer/tooling) | 7.29.7; 0.5.23; 2.8.1; 5.9.3 |
| `ioredis`; `@ioredis/commands`; `cluster-key-slot`; `denque` | 5.11.1; 1.10.0; 1.1.1; 2.1.0 |
| `redis-errors`; `redis-parser`; `standard-as-callback` | 1.2.0; 3.0.0; 2.1.0 |
| `ws`; `bufferutil`; `utf-8-validate`; `node-gyp-build` | 8.22.0; 4.1.0; 6.0.6; 4.8.4 |
| `node-fetch`; `node-fetch-native`; `whatwg-url`; `webidl-conversions`; `tr46` | 2.7.0; 1.6.7; 5.0.0; 3.0.1; 0.0.3 |
| `base64-js`; `bn.js`; `buffer`; `ieee754`; `safe-buffer` | 1.5.1; 5.2.5; 6.0.3; 1.2.1; 5.2.1 |
| `atomic-sleep`; `on-exit-leak-free`; `pino-std-serializers`; `process-warning` | 1.0.0; 2.1.2; 7.1.0; 5.1.0 |
| `quick-format-unescaped`; `real-require`; `safe-stable-stringify`; `sonic-boom` | 4.0.4; 0.2.0; 2.5.0; 4.2.1 |
| `duplexify`; `end-of-stream`; `readable-stream`; `split2`; `stream-shift`; `string_decoder` | 4.1.3; 1.4.5; 3.6.2; 4.2.0; 1.0.3; 1.3.0 |
| `chalk`; `commander`; `debug`; `ms`; `semver` | 5.6.2; 14.0.2; 4.4.3; 2.1.3; 7.8.5 |
| `defu`; `destr`; `detect-libc`; `eventemitter3`; `fast-deep-equal` | 6.1.7; 2.0.5; 2.1.2; 5.0.4; 3.1.3 |
| `inherits`; `once`; `wrappy`; `util-deprecate`; `xtend` | 2.0.4; 1.4.0; 1.0.2; 1.0.2; 4.0.2 |
| `set-cookie-parser`; `uuid` | 2.7.2; 8.3.2 |

This table does not claim all packages execute in a browser. For example, peers and Node-only SDK paths expand the conservative closure. The actual shared application workspace has just `@narra/shared -> zod`.

## 2. Audit results and every high/critical finding

Commands ran against the root lockfile, with no fix/force operation:

```powershell
npm audit --json --ignore-scripts
npm audit --omit=dev --json --ignore-scripts
```

| Audit | Moderate | High | Critical | Total |
| --- | ---: | ---: | ---: | ---: |
| Full, before remediation | 33 | 14 | 2 | 49 |
| Full, after remediation | 33 | 14 | 2 | 49 |
| Omit dev, before remediation | 28 | 6 | 0 | 34 |
| Omit dev, after remediation | 28 | 5 | 0 | 33 |

The full count remains the same because the root development copy of `source-map-js@1.2.1` still has the same package-level advisory. The web production path was removed from that finding. `--omit=dev` still reports Prisma CLI/config because npm's installed optional-peer closure makes them production-reachable; this does not establish an API request execution path.

### Complete high/critical package classification

Paths are root `node_modules/<name>` unless otherwise stated. “Inherited” means npm reports the parent because of a vulnerable child, not a separate direct advisory in the parent.

| Package/version | Severity | Reachability and prerequisite | Safe web-only disposition |
| --- | --- | --- | --- |
| `@next/eslint-plugin-next@15.5.27` | High, inherited | Web lint only: `eslint-config-next -> plugin -> fast-glob -> micromatch -> braces`. Malicious glob input during linting; no backend/runtime graph path. | No nonbreaking fix demonstrated; see braces. Do not downgrade Next's lint config to npm's suggested 14.2.35. |
| `@prisma/config@6.19.3` | High, inherited | Backend database tooling: `prisma -> @prisma/config -> deepmerge-ts`. Present through `@prisma/client`'s optional `prisma` peer as well as database dev dependency. | Backend-owned; no web-only fix. |
| `braces@3.0.3` | High | Web lint/Tailwind glob expansion; deeply nested attacker-controlled patterns can exhaust the stack. No backend runtime path. | Registry latest is still 3.0.3; no patched 3.x release. Tailwind 4 migration is breaking and outside scope. |
| `tailwindcss/node_modules/chokidar@3.6.0` | High, inherited | Web CSS watch/build tooling; `chokidar -> braces`. This nested copy is not the unrelated newer Chokidar elsewhere. | Updating Chokidar across majors under Tailwind 3 is not a demonstrated nonbreaking fix. |
| `deepmerge-ts@7.1.5` | High | Prisma config merging can exhaust the stack on recursive object graphs. Backend/tooling closure, not web. API database code imports `@prisma/client` and `@prisma/adapter-pg`, not Prisma CLI/config. No request-to-config-merge path was established. | Fix requires deepmerge-ts 8+ or supported Prisma change. Do not override backend or downgrade Prisma to audit's suggested 6.12.0. |
| `eslint-config-next@15.5.27` | High, inherited | Web lint only; chain above. | Keep aligned with Next 15.5.27; no blind downgrade. |
| `fast-glob@3.3.1`, `tailwindcss/node_modules/fast-glob@3.3.3` | High, inherited | Web lint and CSS tooling respectively; both resolve vulnerable `micromatch -> braces`. | Updating the older fast-glob alone would retain the vulnerable braces dependency. |
| `micromatch@4.0.8` | High, inherited | Web lint/CSS glob handling through braces. | No supported child fix currently available in braces 3.x. |
| `next/node_modules/postcss@8.4.31` | High | Web production dependency, principally CSS build/dev processing. Attacker-controlled CSS/source-map comments can trigger arbitrary map/file disclosure; CSS stringify has an XSS advisory too. No application-level PostCSS/source-map parser import found in `apps/web/src`; actual malicious CSS reachability was not exercised. | Next 15.5.27 pins **exactly** 8.4.31 and is the latest registry 15.x. A private source-map child patch is applied, but does not fix PostCSS itself. Next 16 upgrade or overriding its exact PostCSS pin is not an in-range nonbreaking fix. |
| `prisma@6.19.3` | High, inherited | Backend CLI/schema/config tooling; installed optional-peer reachability from database client. No web path. | Retain existing backend pin; separate backend/tooling work required. |
| `source-map-js@1.2.1` | High | Before: Next's PostCSS plus root/web dev PostCSS. After: **dev only**, including root `vitest -> vite -> postcss`, web direct PostCSS and CSS tooling. Indexed source-map offsets can cause event-loop DoS when processing malicious maps. | **Fixed for Next runtime path** with isolated 1.2.2. Root dev copy retained to avoid changing shared backend test-tooling versions. |
| `tailwindcss@3.4.19` | High, inherited | Web CSS build/watch tool: braces chain and moderate selector-parser chain. No backend runtime path. | Audit proposes 4.3.3, a migration rather than a safe patch. |
| `tinypool@1.1.1` | **Critical** | Root `vitest -> tinypool`, shared by frontend/backend tests. Prototype-polluted worker/run options can become RCE; this needs the advisory's pollution/options preconditions, not merely an installed package. No deployed API/worker runtime dependency edge. | Patched line is 2.1.2+; overriding Vitest 2's worker-pool major or upgrading shared Vitest is outside web-only/nonbreaking scope. |
| `vite@5.4.21` | High | Root/shared Vitest development tooling. Filesystem-deny bypass on Windows; additional source-map traversal/UNC-path advisories and moderate esbuild dev-server issue. Risk concerns exposed dev-server endpoints. Production web is Next, not a Vite server. | Advisory affects Vite <=6.4.2; a Vite major/compatible Vitest migration is shared-tooling work. |
| `vitest@2.1.9` | **Critical** | Shared root test runner. Direct unauthenticated file-read/execution issue requires listening Vitest UI server; this repository's root/web test scripts use `vitest run`. Also inherits Tinypool/Vite findings and has moderate mock-redirect traversal. No deployed runtime dependency edge. | npm proposes 5.0.3. Do not change the shared runner or force child majors during frontend hygiene. |
| `ws@8.18.3` (three private Reown copies), `ws@8.18.0` (private Wagmi copy) | High | Web Privy/WalletConnect/Wagmi graph; details below. Fragment-driven memory exhaustion in Node ws transports, plus moderate uninitialized-memory disclosure. Browser builds normally use native WebSocket, but browser tree-shaking/SSR execution was not proven. | Exact old ws pins are declared by nested `viem`; no safe in-range ws patch. Do not downgrade Privy to npm's proposed 3.6.1 or use a global ws override affecting backend. |

### Advisory-level evidence for the high/critical rows

- Braces: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), affected `<=3.0.3`; inherited by Chokidar, Micromatch, Fast-glob, Tailwind and Next's ESLint packages.
- DeepmergeTS: [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), affected `<8.0.0`; inherited by Prisma/config.
- PostCSS: high [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), `<=8.5.11`, and high [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849), `<=8.5.17`; moderate [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), `<8.5.10`, and [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), `<=8.5.22`. The web's direct dev PostCSS is already 8.5.28; it does not replace Next's exact nested pin.
- Source-map-js: [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), affected `>=1.0.0 <1.2.2`.
- Tinypool: critical [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3), `<=2.1.0`, and critical [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr), `<2.1.2`.
- Vite: high [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), `<=6.4.2`; moderate [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9), `<=6.4.1`, and [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3), `<=6.4.2`. Also inherits esbuild [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) from its private 0.21.5 copy; root esbuild 0.28.2 is a different copy.
- Vitest: critical [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp), `<3.2.6`; moderate [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), `>=2.1.0 <4.1.11`, plus inherited Tinypool/Vite findings. Fixing only the direct critical advisory would not clear all inherited findings.
- Ws: high [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p), `>=8.0.0 <8.21.0`; moderate [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx), `>=8.0.0 <8.20.1`.

### Exact vulnerable ws copies and graph separation

```text
apps/web -> @privy-io/react-auth@3.48.1
  -> @walletconnect/ethereum-provider@2.22.4
     -> @reown/appkit@1.8.9
        -> {appkit itself, @reown/appkit-controllers, @reown/appkit-utils}
           -> private @walletconnect/universal-provider@2.21.9
              -> private @walletconnect/utils@2.21.9
                 -> private viem@2.36.0 -> ws (exact 8.18.3)
  -> x402@0.7.3 -> wagmi@2.19.5 -> @wagmi/connectors@6.2.0
     -> private @walletconnect/ethereum-provider@2.21.1
        -> private @walletconnect/utils@2.21.1
           -> private viem@2.23.2 -> ws (exact 8.18.0)
```

Audit's four affected paths:

1. `node_modules/@reown/appkit/node_modules/ws`
2. `node_modules/@reown/appkit-controllers/node_modules/ws`
3. `node_modules/@reown/appkit-utils/node_modules/ws`
4. `node_modules/@wagmi/connectors/node_modules/ws`

Other nested WalletConnect consumers can resolve these same copies; audit counts paths, not every call chain. The API's `@fastify/websocket -> node_modules/ws@8.22.0` is **not** an affected copy. `packages/tx-verify`'s `jayson -> ws@7.5.13` is not covered by these ws 8.x advisory ranges. No global ws replacement was attempted.

`apps/web/src/components/auth/privy.tsx` configures Solana-only wallet appearance/connectors. That limits configured features, but is not sufficient evidence to mark all Privy Ethereum/WalletConnect transitive vulnerabilities unreachable. No build/bundle or live authentication exercise was performed for this review.

### Moderate findings retained

There are 33 moderate package entries in the full audit, many inherited from the same underlying advisory. Beyond the mixed-severity advisories above, direct moderate roots include:

- `decode-uri-component`: malformed percent-encoding DoS, propagated through query-string/WalletConnect/Privy; published affected range `<=0.4.2`.
- `uuid`: missing buffer bounds checks when supplying a buffer to v3/v5/v6, affected `<11.1.1`; shared backend `uuid@8.3.2` and frontend SDK copies prevent treating a global major replacement as a web-only patch.
- `stream-json`: nested-filter CPU exhaustion, JSONC rescanning, and assembler prototype pollution; backend `packages/tx-verify` / executor reach it through the existing Solana/Jayson tree. No backend update applied.
- `postcss-selector-parser`: quadratic selector parsing below 7.1.6, in web CSS tooling; forcing a major under Tailwind/PostCSS plugins is not a validated nonbreaking fix.
- `@vitest/mocker`: shared development-server mock redirect traversal, covered in the Vitest discussion.

The audit's `fixAvailable` objects sometimes propose **downgrades** or top-level major migrations (Privy 3.6.1, ESLint-config-next 14.2.35, Prisma 6.12.0, Next 16.4.0, Tailwind 4.3.3, Vitest 5.0.3). They are remediation candidates from npm's solver, not evidence that these changes preserve the application's API contracts. No `npm audit fix`, `--force`, or root overrides were used. Workspace-local `overrides` would not solve this: npm only honors overrides in the root manifest.

## 3. Applied fix and preservation checks

Added one package record:

```text
node_modules/next/node_modules/source-map-js@1.2.2
resolved: https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.2.tgz
integrity: sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==
```

Registry metadata confirms this version/integrity and Node `>=0.10.0`. It satisfies Next's nested PostCSS dependency range `^1.0.2`. The root `source-map-js@1.2.1` is now marked `dev: true` because the Next production consumer resolves the private patched copy. Root Vite's PostCSS and frontend development PostCSS retain their original version/resolution.

This intentionally avoids upgrading the globally hoisted source-map package: doing so would also change the backend/shared root test-tooling graph. The isolated lock record is a valid in-range resolution, not a root override or new direct application dependency. Future lock regeneration/deduplication should recheck this isolation and the production audit.

Verification performed for real:

- Parsed baseline, pre-fix, and final lockfiles; checked workspace links, package identities and parent-to-child resolution edges.
- Compared all API/worker/package runtime+installed-peer graphs **and their dev-root graphs**, plus the root tooling graph, before/after this review's patch: **zero version or resolution changes**. The only shared dev-record metadata difference is `source-map-js@1.2.1` gaining its accurate `dev` flag.
- `npm ci --dry-run --ignore-scripts --no-audit --no-fund --offline`: **exit 0**, plan was exactly `add source-map-js 1.2.2` / one package. No real install or lifecycle execution.
- `npm ls source-map-js --package-lock-only --all`: **exit 0**, confirms `next -> postcss@8.4.31 -> source-map-js@1.2.2` and dev `postcss@8.5.28 -> source-map-js@1.2.1`.
- `npm ls utf-8-validate --package-lock-only --all`: **exit 1**, the pre-existing invalid `ws@7` optional peers described above. This does not invalidate the passed lock/install dry run, but means dependency-tree validation is not globally clean.
- Full and omit-dev JSON audits rerun after patch; counts recorded above. Vulnerabilities remain, so audit exits nonzero as expected.
- Registry queries checked source-map-js metadata, available Next 15 versions, and latest braces version.

**Final installation status:** a scripts-disabled install realized the private source-map-js **1.2.2** copy; Node resolution was checked. The owning session performs the final build and suites separately, recorded in `PHASE1-REPORT.md`. No exploit reproduction or live wallet/provider verification was performed by this dependency audit.

## 4. Fourteen pending lifecycle approvals

Read-only inventory command:

```powershell
npm approve-scripts --allow-scripts-pending --json
```

Despite its command name, with only `--allow-scripts-pending` it lists uncovered scripts; it did not approve anything. npm reported exactly the following **14 package/version approvals**, including two esbuild and two utf-8-validate versions. Lifecycle declarations and relevant installed script bodies were inspected without running them. Necessity is conditional on actual platform binaries/features; it is not approval.

| Pending package | Lifecycle command | Consumer / purpose | Necessity assessment |
| --- | --- | --- | --- |
| `bufferutil@4.1.0` | `install: node-gyp-build` | Optional native WebSocket masking acceleration; shared API/Solana SDK and web dependency tree. | Optional performance optimization; ws has a JS path. Prebuilt binaries can avoid compilation. Not required to approve for frontend correctness. |
| `esbuild@0.28.2` | `postinstall: node install.js` | Root `tsx` and related TS configuration tooling; validates/prepares platform executable. | Executable is required by consumers using esbuild; script may be unnecessary when the correct optional platform binary is already available. Shared backend launch tooling, not web-only. |
| `keccak@3.0.4` | `install: node-gyp-build || exit 0` | Privy -> x402 -> Wagmi -> Coinbase SDK native hashing. | Optional acceleration: package explicitly catches native-load failure and falls back to JS. |
| `msgpackr-extract@3.0.4` | `install: node-gyp-build-optional-packages` | BullMQ -> msgpackr optional native extraction; backend queues/workers. | Optional acceleration with msgpackr JS fallback; not needed for web. Any backend performance decision belongs with backend owner. |
| `prisma@6.19.3` | `preinstall: node scripts/preinstall-entry.js` | Prisma CLI install prerequisite/platform checks. | CLI tooling only; checking supported runtime does not generate the client. No frontend need. |
| `unrs-resolver@1.12.2` | `postinstall: node postinstall.js` | Next ESLint -> TypeScript import resolver; `napi-postinstall` checks/prepares native package. | Lint requires a working resolver; correct installed platform package may suffice without postinstall. Not a production-web runtime requirement. |
| `utf-8-validate@6.0.6` | `install: node-gyp-build` | Shared ws UTF-8 native validator, including backend. | Optional acceleration; ws supports fallback/native Node validation depending on version/runtime. Does not repair the incompatible ws 7 peer range. |
| `@parcel/watcher@2.6.0` | `install: node scripts/build-from-source.js` | next-intl native file watching. | Script only compiles if `npm_config_build_from_source === 'true'`; otherwise no-op. Packaged platform binary is normally used. Watcher functionality is conditional on tooling/features. |
| `@prisma/client@6.19.3` | `postinstall: node scripts/postinstall.js` | Generates/discovers backend Prisma client. | A correctly generated client is required by backend database code; generation can instead be performed explicitly in its authorized workflow. Not required by web. It can discover schema/config, so it was not run here. |
| `@prisma/engines@6.19.3` | `postinstall: node scripts/postinstall.js` | Prepares/downloads Prisma engine artifacts for CLI tooling. | Schema/migration tooling can need engine artifacts. Repo uses `engineType = "client"` and a pg adapter for runtime, so a Rust query engine is not a frontend/server-query prerequisite. Still assess CLI needs separately. |
| `@reown/appkit@1.8.9` | `postinstall: node scripts/appkit-version-check.js` | WalletConnect/AppKit package version consistency diagnostics; reads package manifests and prints mismatches. | Diagnostic only; not required to initialize the wallet SDK. |
| `@swc/core@1.16.13` | `postinstall: node postinstall.js` | next-intl compiler tooling; validates native binding, can install `@swc/wasm` fallback if missing. | A working SWC binding is needed for features using this package, but the script is conditional repair/validation when platform optional binaries already work. It is distinct from Next's own `@next/swc-*` binaries. |
| `esbuild@0.21.5` | `postinstall: node install.js` | Root Vitest -> Vite private esbuild binary. | Test transform tooling needs an executable; optional platform package may already provide it. Shared test tooling, not production web. Running it would not fix its audit advisory. |
| `utf-8-validate@5.0.10` | `install: node-gyp-build` | MetaMask SDK-private validator and restored Jayson-private copy. | Optional native acceleration; installed prebuilt package files were reused for restoration without running this script. |

The lock also contains `fsevents@2.3.3` with `hasInstallScript`, but it is macOS-only, absent from this Windows installation, and **not** one of the 14 pending approvals. Counting lockfile script flags alone would incorrectly produce 15.

## 5. Remaining dependency decisions

1. Jayson optional-peer drift is restored under the owner's explicit authorization; use npm 10.9.4 and retain the resolution checker. Backend-suite outcome is recorded in the main report.
2. Plan the shared Vitest/Vite/Tinypool upgrade separately. Both critical audit entries are here; absence from production graphs does not mean exposed development servers are safe.
3. Seek an upstream compatible Next release with patched PostCSS and a Privy/WalletConnect dependency set with patched pinned ws. Current automatic audit suggestions are not safe drop-in changes.
4. Revisit Tailwind/ESLint glob tooling when braces gains a patched compatible release, or during an intentional Tailwind migration.
5. The isolated source-map fix is installed with scripts disabled; retain it through future lockfile refreshes. Lifecycle decisions remain pending.

Raw JSON snapshots and the local graph-comparison helper used for this review are in `C:\Users\gifar\AppData\Local\Temp\opencode\narra-*` (local evidence, not portable repository artifacts). Re-running the commands above will obtain current registry results; counts can change as advisories are published.
