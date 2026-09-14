# Development

Install dependencies and run the regular test suite:

```sh
npm ci
npm test
```

The OCI end-to-end test is intentionally excluded from `npm test`. It creates a temporary Zot registry, builds and retrieves both model and image artifacts, and requires Docker, ORAS, and the Docker-backed Java extractor. It pins Pharo 12 so the fixture remains independent of future Moose runtime releases.

```sh
npm run test:e2e
```

The following variables configure only the end-to-end test harness:

| Variable | Purpose |
| --- | --- |
| `MOOSENEXUS_E2E` | Enables the OCI end-to-end test when set to `1`. `npm run test:e2e` sets it automatically. |
| `MOOSENEXUS_E2E_ZOT_IMAGE` | Overrides the Zot container image used for the temporary registry. The default is architecture-specific. |
| `MOOSENEXUS_E2E_RUNTIME_DIRECTORY` | Overrides the CLI runtime cache used by the test. This allows CI to restore a shared cache without using the temporary test home directory. |
| `MOOSENEXUS_E2E_NEXUS_VERSION` | Overrides the MooseNexus version used by the test. By default the test uses the CLI's `v1.x.x` track. |

The GitHub Actions OCI job uses a test-owned Zot fixture; it does not require an already-running registry.
