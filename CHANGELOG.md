# Changelog

## [0.2.13](https://github.com/icoretech/warden-mcp/compare/v0.2.12...v0.2.13) (2026-04-22)


### Bug Fixes

* **session:** reuse persisted bw sessions across stdio workers ([58520d6](https://github.com/icoretech/warden-mcp/commit/58520d6a44d8ebf544abc099938c1102b13974b7))

## [0.2.12](https://github.com/icoretech/warden-mcp/compare/v0.2.11...v0.2.12) (2026-04-22)


### Bug Fixes

* **session:** avoid idle auth and serialize process unlocks ([a45765d](https://github.com/icoretech/warden-mcp/commit/a45765dc7d914d241dfed2bd722f7c1b5c29ac79))
* **session:** create auth lock parent dirs before locking ([f780e00](https://github.com/icoretech/warden-mcp/commit/f780e00a42c1a716ac1aa3e2af075bfa2f50ff6e))
* **status:** avoid unlock on cold stdio startup ([5e9628f](https://github.com/icoretech/warden-mcp/commit/5e9628f32e74f82d9bf63a567a6abbaefb896082))

## [0.2.11](https://github.com/icoretech/warden-mcp/compare/v0.2.10...v0.2.11) (2026-04-22)


### Bug Fixes

* **stdio:** block startup on bw session warmup ([06d81f7](https://github.com/icoretech/warden-mcp/commit/06d81f7bf5f62bbe01d30b17b91072cba8e6f49c))

## [0.2.10](https://github.com/icoretech/warden-mcp/compare/v0.2.9...v0.2.10) (2026-04-22)


### Bug Fixes

* **stdio:** prewarm bw sessions for hosted mcp clients ([5fb8bd9](https://github.com/icoretech/warden-mcp/commit/5fb8bd94068d00bade70e5be341c31730c2afec6))

## [0.2.9](https://github.com/icoretech/warden-mcp/compare/v0.2.8...v0.2.9) (2026-04-22)


### Bug Fixes

* **session:** kill timed out bw process trees and stabilize cli appdata ([ab03a25](https://github.com/icoretech/warden-mcp/commit/ab03a255425b65e2753ebaa15f54778eae124569))

## [0.2.8](https://github.com/icoretech/warden-mcp/compare/v0.2.7...v0.2.8) (2026-04-07)


### Features

* **warden-mcp:** add text-only compat mode ([fcbedb5](https://github.com/icoretech/warden-mcp/commit/fcbedb5e520351acbd932b44dbf63c0ea9f99884))

## [0.2.7](https://github.com/icoretech/warden-mcp/compare/v0.2.6...v0.2.7) (2026-04-05)


### Bug Fixes

* **docker:** remove stale patches copy ([817b373](https://github.com/icoretech/warden-mcp/commit/817b373aa885eb873659423ac2a47f5462df735d))

## [0.2.6](https://github.com/icoretech/warden-mcp/compare/v0.2.5...v0.2.6) (2026-04-05)


### Bug Fixes

* **session:** avoid relogin when bw host is unchanged ([3acc13e](https://github.com/icoretech/warden-mcp/commit/3acc13eaf299b20ef437cbc836423671b46c83d6))

## [0.2.5](https://github.com/icoretech/warden-mcp/compare/v0.2.4...v0.2.5) (2026-04-03)


### Bug Fixes

* **deps:** update dependency @modelcontextprotocol/sdk to ^1.29.0 ([#43](https://github.com/icoretech/warden-mcp/issues/43)) ([e9d7f53](https://github.com/icoretech/warden-mcp/commit/e9d7f53d5b7e8d6957425f70c39453401cd6602f))
* harden dependency update compatibility ([2f4ccb4](https://github.com/icoretech/warden-mcp/commit/2f4ccb4b42420dc9c7b060756ebe168feb7eff66))

## [0.2.4](https://github.com/icoretech/warden-mcp/compare/v0.2.3...v0.2.4) (2026-03-27)


### Bug Fixes

* align mcp server version metadata ([f1aa144](https://github.com/icoretech/warden-mcp/commit/f1aa14416ff794c0758321f1a641a6d30d4e9525))
* annotate mutating mcp tools ([871dec4](https://github.com/icoretech/warden-mcp/commit/871dec446d06630cd6592b3ac92b06e0be9c85e8))
* **deps:** update dependency @modelcontextprotocol/sdk to ^1.28.0 ([#9](https://github.com/icoretech/warden-mcp/issues/9)) ([865633d](https://github.com/icoretech/warden-mcp/commit/865633d1ac78adfef6794961a460283f22d6b35e))

## [0.2.3](https://github.com/icoretech/warden-mcp/compare/v0.2.2...v0.2.3) (2026-03-25)


### Features

* add sync and sdk_version tools ([18dac1f](https://github.com/icoretech/warden-mcp/commit/18dac1f8076a63f7f4fa395fd93224af28d34bb2))


### Bug Fixes

* use bw version for sdk_version ([81eee55](https://github.com/icoretech/warden-mcp/commit/81eee556843d87637135fcd4fbed6aa6f9e42e56))

## [0.2.2](https://github.com/icoretech/warden-mcp/compare/v0.2.1...v0.2.2) (2026-03-23)


### Bug Fixes

* remove unsettled top-level await warning ([3b251b3](https://github.com/icoretech/warden-mcp/commit/3b251b3784ee70a8cfc540102968b07f1931d129))

## [0.2.1](https://github.com/icoretech/warden-mcp/compare/v0.2.0...v0.2.1) (2026-03-23)


### Bug Fixes

* bootstrap patch-package app root for npx installs ([21a88bd](https://github.com/icoretech/warden-mcp/commit/21a88bd181a1b452fb94e811b54dfa13ba3a0699))

## [0.2.0](https://github.com/icoretech/warden-mcp/compare/v0.1.21...v0.2.0) (2026-03-23)


### Bug Fixes

* default tool names to underscore separator ([0836b1e](https://github.com/icoretech/warden-mcp/commit/0836b1e14445289eb9783fcfd35fe77db47d05da))


### Miscellaneous Chores

* release 0.2.0 ([e7c0a48](https://github.com/icoretech/warden-mcp/commit/e7c0a48aa74fba863c35ff94853f454c77804031))

## [0.1.21](https://github.com/icoretech/warden-mcp/compare/v0.1.20...v0.1.21) (2026-03-22)


### Bug Fixes

* patch hoisted bw installs correctly ([405621f](https://github.com/icoretech/warden-mcp/commit/405621f5c7ef2291b9fc926a6aa415b9acd04c5a))

## [0.1.20](https://github.com/icoretech/warden-mcp/compare/v0.1.19...v0.1.20) (2026-03-22)


### Bug Fixes

* reset stale macos bw cli state ([4520fcb](https://github.com/icoretech/warden-mcp/commit/4520fcb620cedc667b8f053f03df76136486b440))

## [0.1.19](https://github.com/icoretech/warden-mcp/compare/v0.1.18...v0.1.19) (2026-03-22)


### Bug Fixes

* **docker:** ship patched bw cli in image ([325d744](https://github.com/icoretech/warden-mcp/commit/325d7449e1371888a93d228822a164ed1522e9bf))

## [0.1.18](https://github.com/icoretech/warden-mcp/compare/v0.1.17...v0.1.18) (2026-03-22)


### Features

* include totp timing metadata ([3a72647](https://github.com/icoretech/warden-mcp/commit/3a7264779b1e2df69fb34bcabf50b4ba94d3d686))


### Bug Fixes

* allow degraded startup without bw ([748deba](https://github.com/icoretech/warden-mcp/commit/748deba3202affd8d9f17752803d344e7cc6da29))
* use patch-package for bundled bw compat ([d509b61](https://github.com/icoretech/warden-mcp/commit/d509b611312e4fa963d2c0d2b458cf9d2946cb3f))

## [0.1.17](https://github.com/icoretech/warden-mcp/compare/v0.1.16...v0.1.17) (2026-03-22)


### Bug Fixes

* make compose ci use bundled bw candidate ([eae46f8](https://github.com/icoretech/warden-mcp/commit/eae46f8f208a8c70010cf017f29308dd89845c71))
* retry post-login unlock for bw auth ([7641433](https://github.com/icoretech/warden-mcp/commit/764143358de2c5c5f4d157fb521f034fa47252ab))

## [0.1.16](https://github.com/icoretech/warden-mcp/compare/v0.1.15...v0.1.16) (2026-03-22)


### Bug Fixes

* stabilize vaultwarden bootstrap smoke ([8060807](https://github.com/icoretech/warden-mcp/commit/806080785e921449452046037cb9a25ef7d70f49))

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
