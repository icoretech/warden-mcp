# Changelog

## [0.1.15](https://github.com/icoretech/warden-mcp/compare/v0.1.14...v0.1.15) (2026-03-22)


### Bug Fixes

* add api-key compatibility smoke coverage ([c7f0639](https://github.com/icoretech/warden-mcp/commit/c7f063955b3ca369f8c7751203c8cbee58bad10b))

## [0.1.14](https://github.com/icoretech/warden-mcp/compare/v0.1.13...v0.1.14) (2026-03-22)


### Bug Fixes

* harden bw cli failure handling ([8eb9e5c](https://github.com/icoretech/warden-mcp/commit/8eb9e5cca7cf72e43b6796499e17e8829c2d8a54))

## [0.1.13](https://github.com/icoretech/warden-mcp/compare/v0.1.12...v0.1.13) (2026-03-22)


### Bug Fixes

* keep http transport entrypoint alive ([6223da6](https://github.com/icoretech/warden-mcp/commit/6223da67cea4dfe851a0ce00ba7ee183fd92accd))

## [0.1.12](https://github.com/icoretech/warden-mcp/compare/v0.1.11...v0.1.12) (2026-03-22)


### Features

* add --stdio flag and WARDEN_MCP_STDIO env var to server entry ([2a6b49e](https://github.com/icoretech/warden-mcp/commit/2a6b49e87504e7a85e1f1295029c230fe786baab))
* add bin/warden-mcp.js CLI entry with @bitwarden/cli resolution ([244d372](https://github.com/icoretech/warden-mcp/commit/244d372284b60a0d4f29ae38f72a6a6897108f6e))
* add env var fallback to bwEnvFromHeadersOrEnv ([0a7c6f3](https://github.com/icoretech/warden-mcp/commit/0a7c6f392b9c7e26945ab3b175df2d5976ef163b))
* add NOREVEAL env var to force-disable secret reveals ([034286c](https://github.com/icoretech/warden-mcp/commit/034286c2c17e3442f7a6456fd3e6068f7fbfcd8f))
* add stdio transport ([9ecc99c](https://github.com/icoretech/warden-mcp/commit/9ecc99c54ddec29265aa19bd79f8d31b235a0a22))
* **docker:** publish multi-arch image to ghcr.io ([2c2f8c7](https://github.com/icoretech/warden-mcp/commit/2c2f8c7c627ae3efaca506d7a56e80b327de0827))


### Bug Fixes

* add explicit private:false, add headers-priority test ([ef9d5a1](https://github.com/icoretech/warden-mcp/commit/ef9d5a1981ddf74d8538bbadd0c149b906eaf074))
* **biome:** ignore glama.json formatting ([a7e55e1](https://github.com/icoretech/warden-mcp/commit/a7e55e1e2b72fd2c4db3b1783cb274bad5e338c4))
* **biome:** ignore package.json formatting ([1d916f4](https://github.com/icoretech/warden-mcp/commit/1d916f4d2d3159cc1d1b327a8266d9a935c2bf5c))
* **biome:** ignore release-managed json formatting ([7dbf5e8](https://github.com/icoretech/warden-mcp/commit/7dbf5e85170d9fccd40d60810a25a0e2afad4792))
* **biome:** use package.json expand override ([1eb7a2c](https://github.com/icoretech/warden-mcp/commit/1eb7a2c6345a6b536fc783ca76a7bea54fc1234d))
* **ci:** enable npm trusted publishing ([9a8f2af](https://github.com/icoretech/warden-mcp/commit/9a8f2afa0b50bc69567195e89e65b03d7c66d019))
* **ci:** replace non-existent rhysd/actionlint-action with docker image ([01baeaa](https://github.com/icoretech/warden-mcp/commit/01baeaa2486265b0427c931c6986b1284363fcbc))
* **ci:** scope GitHub Actions permissions to least privilege ([6837214](https://github.com/icoretech/warden-mcp/commit/6837214bb8d60008f5d9852782d1c72a302ff1d4))
* **ci:** suppress shellcheck SC2034 in session-flood-guardrail workflow ([8bde88e](https://github.com/icoretech/warden-mcp/commit/8bde88e7f58b7fdd69b5f12ccb85e8a7c704318d))
* **ci:** switch package publishing from github packages to npmjs ([7bbda65](https://github.com/icoretech/warden-mcp/commit/7bbda656f4141deb3eaf0252fc46efe40ee550d8))
* **docker:** use release-please version outputs for image tags ([0c2b6a9](https://github.com/icoretech/warden-mcp/commit/0c2b6a93ad332bb458028c4b3ea99583bca42d9f))
* drop component prefix from release tags ([f2000b1](https://github.com/icoretech/warden-mcp/commit/f2000b1a3de4bdb25e51de5b68d572752570c173))
* **package:** add npm keywords ([3603fc2](https://github.com/icoretech/warden-mcp/commit/3603fc24ccf8d569c2c8967db9e039cf9931e4cf))
* pin bundled bw cli to 2026.1.0 ([82731c7](https://github.com/icoretech/warden-mcp/commit/82731c7f0bd466d60d3f86e40810d9567d4f5c66))
* **renovate:** keep config PRs lint-clean ([e510d94](https://github.com/icoretech/warden-mcp/commit/e510d94c6e97df7946808710d3363e6ebb4166db))
* resolve noAsyncPromiseExecutor lint error in stdio transport ([fdde3eb](https://github.com/icoretech/warden-mcp/commit/fdde3eb861c281562f1bf7e1a92fa33a1f998434))
* **security:** disable env credential fallback in HTTP mode by default ([7c061ee](https://github.com/icoretech/warden-mcp/commit/7c061ee433edc0454a0f5848c3213fd87f7247c4))
* **security:** prevent CLI option injection in send/receive commands ([284ef75](https://github.com/icoretech/warden-mcp/commit/284ef75a6f44d508938526fcfd3ff688bf6ab20d))
* **security:** remove raw CLI output from JSON parse error messages ([97e59e8](https://github.com/icoretech/warden-mcp/commit/97e59e86be065025bc372d1fcf60fbdc36e85786))
* **security:** validate receive URL is HTTPS before passing to bw CLI ([3932c5d](https://github.com/icoretech/warden-mcp/commit/3932c5dc27f71a73d49bc02fc7a5db35048dade0))
* skip --nointeraction for bw auth bootstrap ([368bc5d](https://github.com/icoretech/warden-mcp/commit/368bc5d06e4d844a33b5704cc561bb36fe0f7856))
* **ux:** clarify stdio credential requirements ([1dd8273](https://github.com/icoretech/warden-mcp/commit/1dd8273f44acd8dea9c8d553c5913a5d7a7ac9ae))

## [0.1.11](https://github.com/icoretech/warden-mcp/compare/v0.1.10...v0.1.11) (2026-03-22)


### Bug Fixes

* pin bundled bw cli to 2026.1.0 ([82731c7](https://github.com/icoretech/warden-mcp/commit/82731c7f0bd466d60d3f86e40810d9567d4f5c66))

## [0.1.10](https://github.com/icoretech/warden-mcp/compare/v0.1.9...v0.1.10) (2026-03-22)


### Bug Fixes

* skip --nointeraction for bw auth bootstrap ([368bc5d](https://github.com/icoretech/warden-mcp/commit/368bc5d06e4d844a33b5704cc561bb36fe0f7856))

## [0.1.9](https://github.com/icoretech/warden-mcp/compare/v0.1.8...v0.1.9) (2026-03-21)


### Features

* add NOREVEAL env var to force-disable secret reveals ([034286c](https://github.com/icoretech/warden-mcp/commit/034286c2c17e3442f7a6456fd3e6068f7fbfcd8f))


### Bug Fixes

* **security:** validate receive URL is HTTPS before passing to bw CLI ([3932c5d](https://github.com/icoretech/warden-mcp/commit/3932c5dc27f71a73d49bc02fc7a5db35048dade0))

## [0.1.8](https://github.com/icoretech/warden-mcp/compare/v0.1.7...v0.1.8) (2026-03-21)


### Bug Fixes

* **security:** remove raw CLI output from JSON parse error messages ([97e59e8](https://github.com/icoretech/warden-mcp/commit/97e59e86be065025bc372d1fcf60fbdc36e85786))

## [0.1.7](https://github.com/icoretech/warden-mcp/compare/v0.1.6...v0.1.7) (2026-03-21)


### Bug Fixes

* **ci:** scope GitHub Actions permissions to least privilege ([6837214](https://github.com/icoretech/warden-mcp/commit/6837214bb8d60008f5d9852782d1c72a302ff1d4))
* **security:** disable env credential fallback in HTTP mode by default ([7c061ee](https://github.com/icoretech/warden-mcp/commit/7c061ee433edc0454a0f5848c3213fd87f7247c4))
* **security:** prevent CLI option injection in send/receive commands ([284ef75](https://github.com/icoretech/warden-mcp/commit/284ef75a6f44d508938526fcfd3ff688bf6ab20d))

## [0.1.6](https://github.com/icoretech/warden-mcp/compare/v0.1.5...v0.1.6) (2026-03-21)


### Bug Fixes

* **biome:** ignore glama.json formatting ([a7e55e1](https://github.com/icoretech/warden-mcp/commit/a7e55e1e2b72fd2c4db3b1783cb274bad5e338c4))

## [0.1.5](https://github.com/icoretech/warden-mcp/compare/v0.1.4...v0.1.5) (2026-03-21)


### Features

* add --stdio flag and WARDEN_MCP_STDIO env var to server entry ([2a6b49e](https://github.com/icoretech/warden-mcp/commit/2a6b49e87504e7a85e1f1295029c230fe786baab))
* add bin/warden-mcp.js CLI entry with @bitwarden/cli resolution ([244d372](https://github.com/icoretech/warden-mcp/commit/244d372284b60a0d4f29ae38f72a6a6897108f6e))
* add env var fallback to bwEnvFromHeadersOrEnv ([0a7c6f3](https://github.com/icoretech/warden-mcp/commit/0a7c6f392b9c7e26945ab3b175df2d5976ef163b))
* add stdio transport ([9ecc99c](https://github.com/icoretech/warden-mcp/commit/9ecc99c54ddec29265aa19bd79f8d31b235a0a22))
* **docker:** publish multi-arch image to ghcr.io ([2c2f8c7](https://github.com/icoretech/warden-mcp/commit/2c2f8c7c627ae3efaca506d7a56e80b327de0827))


### Bug Fixes

* add explicit private:false, add headers-priority test ([ef9d5a1](https://github.com/icoretech/warden-mcp/commit/ef9d5a1981ddf74d8538bbadd0c149b906eaf074))
* **biome:** ignore package.json formatting ([1d916f4](https://github.com/icoretech/warden-mcp/commit/1d916f4d2d3159cc1d1b327a8266d9a935c2bf5c))
* **biome:** ignore release-managed json formatting ([7dbf5e8](https://github.com/icoretech/warden-mcp/commit/7dbf5e85170d9fccd40d60810a25a0e2afad4792))
* **biome:** use package.json expand override ([1eb7a2c](https://github.com/icoretech/warden-mcp/commit/1eb7a2c6345a6b536fc783ca76a7bea54fc1234d))
* **ci:** enable npm trusted publishing ([9a8f2af](https://github.com/icoretech/warden-mcp/commit/9a8f2afa0b50bc69567195e89e65b03d7c66d019))
* **ci:** replace non-existent rhysd/actionlint-action with docker image ([01baeaa](https://github.com/icoretech/warden-mcp/commit/01baeaa2486265b0427c931c6986b1284363fcbc))
* **ci:** suppress shellcheck SC2034 in session-flood-guardrail workflow ([8bde88e](https://github.com/icoretech/warden-mcp/commit/8bde88e7f58b7fdd69b5f12ccb85e8a7c704318d))
* **ci:** switch package publishing from github packages to npmjs ([7bbda65](https://github.com/icoretech/warden-mcp/commit/7bbda656f4141deb3eaf0252fc46efe40ee550d8))
* **docker:** use release-please version outputs for image tags ([0c2b6a9](https://github.com/icoretech/warden-mcp/commit/0c2b6a93ad332bb458028c4b3ea99583bca42d9f))
* drop component prefix from release tags ([f2000b1](https://github.com/icoretech/warden-mcp/commit/f2000b1a3de4bdb25e51de5b68d572752570c173))
* **package:** add npm keywords ([3603fc2](https://github.com/icoretech/warden-mcp/commit/3603fc24ccf8d569c2c8967db9e039cf9931e4cf))
* **renovate:** keep config PRs lint-clean ([e510d94](https://github.com/icoretech/warden-mcp/commit/e510d94c6e97df7946808710d3363e6ebb4166db))
* resolve noAsyncPromiseExecutor lint error in stdio transport ([fdde3eb](https://github.com/icoretech/warden-mcp/commit/fdde3eb861c281562f1bf7e1a92fa33a1f998434))
* **ux:** clarify stdio credential requirements ([1dd8273](https://github.com/icoretech/warden-mcp/commit/1dd8273f44acd8dea9c8d553c5913a5d7a7ac9ae))

## [0.1.4](https://github.com/icoretech/warden-mcp/compare/warden-mcp-v0.1.3...warden-mcp-v0.1.4) (2026-03-21)


### Bug Fixes

* **docker:** use release-please version outputs for image tags ([0c2b6a9](https://github.com/icoretech/warden-mcp/commit/0c2b6a93ad332bb458028c4b3ea99583bca42d9f))

## [0.1.3](https://github.com/icoretech/warden-mcp/compare/warden-mcp-v0.1.2...warden-mcp-v0.1.3) (2026-03-21)


### Features

* **docker:** publish multi-arch image to ghcr.io ([2c2f8c7](https://github.com/icoretech/warden-mcp/commit/2c2f8c7c627ae3efaca506d7a56e80b327de0827))

## [0.1.2](https://github.com/icoretech/warden-mcp/compare/warden-mcp-v0.1.1...warden-mcp-v0.1.2) (2026-03-21)


### Bug Fixes

* **biome:** ignore package.json formatting ([1d916f4](https://github.com/icoretech/warden-mcp/commit/1d916f4d2d3159cc1d1b327a8266d9a935c2bf5c))
* **biome:** ignore release-managed json formatting ([7dbf5e8](https://github.com/icoretech/warden-mcp/commit/7dbf5e85170d9fccd40d60810a25a0e2afad4792))
* **biome:** use package.json expand override ([1eb7a2c](https://github.com/icoretech/warden-mcp/commit/1eb7a2c6345a6b536fc783ca76a7bea54fc1234d))
* **renovate:** keep config PRs lint-clean ([e510d94](https://github.com/icoretech/warden-mcp/commit/e510d94c6e97df7946808710d3363e6ebb4166db))

## [0.1.1](https://github.com/icoretech/warden-mcp/compare/warden-mcp-v0.1.0...warden-mcp-v0.1.1) (2026-03-21)


### Features

* add --stdio flag and WARDEN_MCP_STDIO env var to server entry ([2a6b49e](https://github.com/icoretech/warden-mcp/commit/2a6b49e87504e7a85e1f1295029c230fe786baab))
* add bin/warden-mcp.js CLI entry with @bitwarden/cli resolution ([244d372](https://github.com/icoretech/warden-mcp/commit/244d372284b60a0d4f29ae38f72a6a6897108f6e))
* add env var fallback to bwEnvFromHeadersOrEnv ([0a7c6f3](https://github.com/icoretech/warden-mcp/commit/0a7c6f392b9c7e26945ab3b175df2d5976ef163b))
* add stdio transport ([9ecc99c](https://github.com/icoretech/warden-mcp/commit/9ecc99c54ddec29265aa19bd79f8d31b235a0a22))


### Bug Fixes

* add explicit private:false, add headers-priority test ([ef9d5a1](https://github.com/icoretech/warden-mcp/commit/ef9d5a1981ddf74d8538bbadd0c149b906eaf074))
* **ci:** enable npm trusted publishing ([9a8f2af](https://github.com/icoretech/warden-mcp/commit/9a8f2afa0b50bc69567195e89e65b03d7c66d019))
* **ci:** replace non-existent rhysd/actionlint-action with docker image ([01baeaa](https://github.com/icoretech/warden-mcp/commit/01baeaa2486265b0427c931c6986b1284363fcbc))
* **ci:** suppress shellcheck SC2034 in session-flood-guardrail workflow ([8bde88e](https://github.com/icoretech/warden-mcp/commit/8bde88e7f58b7fdd69b5f12ccb85e8a7c704318d))
* **ci:** switch package publishing from github packages to npmjs ([7bbda65](https://github.com/icoretech/warden-mcp/commit/7bbda656f4141deb3eaf0252fc46efe40ee550d8))
* **package:** add npm keywords ([3603fc2](https://github.com/icoretech/warden-mcp/commit/3603fc24ccf8d569c2c8967db9e039cf9931e4cf))
* resolve noAsyncPromiseExecutor lint error in stdio transport ([fdde3eb](https://github.com/icoretech/warden-mcp/commit/fdde3eb861c281562f1bf7e1a92fa33a1f998434))
* **ux:** clarify stdio credential requirements ([1dd8273](https://github.com/icoretech/warden-mcp/commit/1dd8273f44acd8dea9c8d553c5913a5d7a7ac9ae))

## Changelog
