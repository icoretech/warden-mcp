import { dirname, join } from 'node:path';

type PackageBin = string | Record<string, string> | undefined;

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
