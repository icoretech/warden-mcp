# Compatibility & Releases

## Overview

Use this file when touching `@bitwarden/cli`, auth/session behavior, or release
automation.

## Current Support Boundary

- Vaultwarden is the continuously-proven compatibility target in CI
- Official Bitwarden compatibility is intended, but not continuously proven
  without a real tenant
- Keep the bundled `@bitwarden/cli` version vetted instead of blindly matching
  the newest upstream release

## Upgrade Rules

- Keep Biome exactly pinned and update its schema with the package; release-please owns generated `CHANGELOG.md` formatting.
- Use Node 22.23.5 and npm 10.9.10 for lockfile maintenance; preserve the
  direct dependency ranges and compatibility overrides in `package.json`.
- Treat `package.json` and the bundled CLI version as a compatibility decision,
  not a routine dependency bump
- A CLI bump must survive the compose-backed Vaultwarden suite before merge
- Keep the postinstall Vaultwarden compat rewrite healthy when `@bitwarden/cli`
  moves, instead of relying on a version-stamped vendor patch file
- The Playwright npm package and the image in `Dockerfile.bootstrap` must move together
  or the browser bootstrap step will fail before tests start
- Bootstrap overlays Node 22 and npm 10 from the same image used by the application so browser image updates cannot change the project runtime.
- Keep the raw `bw` auth contract green in
  `src/integration/bw.cli.integration.test.ts`
- Keep the MCP and SDK integration coverage green in `src/integration/`
- Build npm artifacts with `npm run package:release`; the private source package
  cannot be published directly. The assembly validates and records corrected
  bundled dependency declarations before packing the public runtime artifact
- Keep the vetted CLI bundled so dependency fixes reach npm consumers. Root
  overrides alone are ignored by consumers. Run the packed-consumer contract
  in `src/install/publishedPackage.test.ts` when changing dependency resolution
- Automatic releases wait for successful push CI on the exact source commit and
  refuse to merge a release if `main` has advanced beyond that commit

## Claude Plugin Releases

- The Claude plugin has an independent Release Please `simple` package under
  `plugins/warden-mcp`. Release Please updates its `version.txt`; the JSON
  extra-file updater keeps `.claude-plugin/plugin.json` at the same version.
  Keep both entries in `.release-please-manifest.json` managed by Release Please.
  Exclude generated changelogs and disable manifest formatting so the JSON
  updater's output passes the next CI run without a manual formatting commit.
- Plugin releases use component tags `claude-plugin-v<version>` and their own
  changelog. Preserve the root server's existing tag format and exclude the
  plugin directory from the root package's release scope.
- Preserve the exact-commit CI and current-main checks in the release workflow.
  Its unprefixed release outputs belong to the root server package and gate npm
  and Docker publication. Plugin path-prefixed outputs must not trigger those
  publication jobs. After either component releases, keep GitHub's Latest label
  on the highest stable root server tag.
- `plugins/warden-mcp/start.sh` is the source of truth for the plugin's exact
  published npm runtime pin. Renovate reads it through the npm datasource and
  updates it only after a package version is available. Keep standalone runtime
  pin updates inside the plugin directory so adopting a server release cannot
  create another server release loop.
- Do not copy the plugin or runtime version into prose. Link to the plugin's
  version file, manifest, launcher, or canonical runtime requirements instead.
- Runtime adoption requires the actual published-package contract in
  `src/integration/claude-plugin.integration.test.ts`, using the compose-backed
  personal API-key fixture. Preserve real authentication, seeded-item access,
  read-only/no-reveal defaults, explicit reveal opt-in, and fixture cleanup.
  Launch the MCP child outside the source checkout so `npx` cannot select the
  private local package; source-only tests and manifest checks are insufficient.

- Before onboarding another release component, inspect real history for empty
  commits with `Release-As` trailers: they can apply to every package until its
  first tag establishes a history boundary. Verify the generated version and
  initial changelog links before publishing.

## Release Notes

- Document any intentional support-boundary changes in the README
- Call out auth, session, or bootstrap behavior changes in PRs and release notes
