import { accessSync, constants, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

type PackageBin = string | Record<string, string> | undefined;
type ResolveFn = (specifier: string) => string;

export function resolveBundledBwCandidate(
  pkgManifestPath: string,
  pkgBin: PackageBin,
): string {
  const pkgDir = dirname(pkgManifestPath);
  const binEntry =
    typeof pkgBin === 'string'
      ? pkgBin
      : typeof pkgBin?.bw === 'string'
        ? pkgBin.bw
        : 'dist/bw';

  return join(pkgDir, binEntry);
}

export function resolveBundledBwBin(
  resolvePackage: ResolveFn = createRequire(import.meta.url).resolve,
): string | null {
  try {
    const pkgManifestPath = resolvePackage('@bitwarden/cli/package.json');
    const pkgJson = JSON.parse(readFileSync(pkgManifestPath, 'utf8')) as {
      bin?: PackageBin;
    };
    const candidate = resolveBundledBwCandidate(pkgManifestPath, pkgJson.bin);
    accessSync(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}
