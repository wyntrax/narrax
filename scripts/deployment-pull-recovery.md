# Interrupted registry downloads

A `connection reset by peer` during the deployment image pull means the registry download was interrupted. It does not establish whether the fault was at GHCR or along the network path. Docker's credential-storage warning is not the cause. Compose may also suggest building a service when its configured image pull fails; release images should still be pulled by their published digest.

Both deployment scripts retry image pulls up to three times, with 10-second and 20-second backoffs. Each attempt has a 180-second timeout plus a 15-second termination grace period (GNU `timeout`, provided by coreutils on the production Linux host). Docker can reuse completed image layers. The maximum pull/retry phase is about 10 minutes 15 seconds, leaving time within the backend job's 20-minute limit for migration, worker lease handoff and health checks.

All pull attempts occur before migrations, configuration-check containers or service replacement. Exhausting retries exits nonzero, logs out of the registry when this run logged in, and preserves the previous release records. Migration and application startup use the already-pulled image with `--pull never`; migration and startup are not retried by the pull loop. Normal health checks and rollback still apply after replacement begins.

## Recovering a failed release

Open the failed GitHub Actions **Release** run and select **Re-run failed jobs**. A failed backend pull does not require rebuilding a successfully published image or re-running a successful frontend deployment. Re-running an older run uses that run's original deployment script; the retry improvement applies to releases from commits containing this change.

After the retry, check the deployment result, running image revision and health endpoint. If all bounded attempts fail, inspect the host-to-GHCR connection and registry availability before retrying again.

## October 29, 2026 incident

Release `40841119596`, revision `0fc5188`, published its image and successfully deployed the frontend. Its backend deployment failed during the initial image pull at 10:37 UTC. A read-only check at 12:17 UTC found the API healthy and all four backend application containers still running revision `83e6744`, with zero restarts and start times around 04:55 UTC. The recorded current image still matched that previous release. No recovery deployment was performed as part of the investigation.

Validation: `bash scripts/deploy-remote.test.sh` and `bash scripts/deploy-web-remote.test.sh` exercise immediate success, transient failure, exhaustion, timeout, preserved release state, registry logout, migration ordering and existing rollback behavior with fake Docker/network commands.
