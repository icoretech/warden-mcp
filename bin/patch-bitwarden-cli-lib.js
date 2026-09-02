import {
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchPolicyRevisionDate } from './patch-bitwarden-cli-policy.js';

const require = createRequire(import.meta.url);
const loginCompatMarker = 'icoretech-vaultwarden-compat';

function isModuleNotFoundFor(specifier, error) {
  if (!(error instanceof Error)) return false;
  if ('code' in error && error.code !== 'MODULE_NOT_FOUND') return false;
  return error.message.includes(specifier);
}

function atomicWriteFile(path, contents) {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    const mode = statSync(path).mode & 0o777;
    writeFileSync(tempPath, contents, { encoding: 'utf8', flag: 'wx', mode });
    chmodSync(tempPath, mode);
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

export function resolveBundledBwCliPath({
  resolveDependency = (specifier) => require.resolve(specifier),
} = {}) {
  try {
    const cliPackageJsonPath = resolveDependency('@bitwarden/cli/package.json');
    return join(dirname(cliPackageJsonPath), 'build', 'bw.js');
  } catch (error) {
    if (isModuleNotFoundFor('@bitwarden/cli/package.json', error)) {
      return null;
    }
    throw error;
  }
}

function buildCompatBlock(indent) {
  return [
    `${indent}/* ${loginCompatMarker} */`,
    `${indent}if (response.accountKeysResponseModel) {`,
    `${indent}    yield this.accountCryptographicStateService.setAccountCryptographicState(response.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);`,
    `${indent}}`,
    `${indent}else if (response.privateKey) {`,
    `${indent}    yield this.accountCryptographicStateService.setAccountCryptographicState({`,
    `${indent}        V1: {`,
    `${indent}            private_key: response.privateKey,`,
    `${indent}        },`,
    `${indent}    }, userId);`,
    `${indent}}`,
  ].join('\n');
}

function hasValidLoginCompat(source) {
  return source.includes(`/* ${loginCompatMarker} */`);
}

function countOccurrences(source, needle) {
  let count = 0;
  let index = source.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

function findExactLineSequences(source, expectedLines) {
  const lines = source.split('\n');
  const starts = [];
  for (let index = 0; index <= lines.length - expectedLines.length; index++) {
    if (
      expectedLines.every(
        (expectedLine, offset) => lines[index + offset] === expectedLine,
      )
    ) {
      starts.push(index);
    }
  }
  return { lines, starts };
}

function replaceExactLineSequence(source, expectedLines, replacement) {
  const { lines, starts } = findExactLineSequences(source, expectedLines);
  if (starts.length !== 1) return null;
  lines.splice(starts[0], expectedLines.length, ...replacement.split('\n'));
  return lines.join('\n');
}

function patchLoginCompat(source) {
  const methodName = 'setAccountCryptographicState(response, userId) {';
  let cursor = 0;
  let searchFrom = 0;
  let methods = 0;
  let replacements = 0;
  let patchedSource = '';

  while (true) {
    const methodStart = source.indexOf(methodName, searchFrom);
    if (methodStart === -1) break;

    const lineStart = source.lastIndexOf('\n', methodStart) + 1;
    const indent = source.slice(lineStart, methodStart);
    const methodCloseMarker = `\n${indent}}`;
    const methodCloseStart = source.indexOf(methodCloseMarker, methodStart);
    if (!/^[ \t]*$/.test(indent) || methodCloseStart === -1) {
      return { source, replacements: 0, valid: false };
    }

    const methodEnd = methodCloseStart + methodCloseMarker.length;
    const methodSource = source.slice(lineStart, methodEnd);
    const generatorMarker = ', void 0, void 0, function* () {\n';
    const bodyStart = methodSource.indexOf(generatorMarker);
    const methodEndMarker = `\n${indent}    });\n${indent}}`;
    const bodyEnd = methodSource.length - methodEndMarker.length;
    if (
      !methodSource.endsWith(methodEndMarker) ||
      bodyStart === -1 ||
      bodyStart !== methodSource.lastIndexOf(generatorMarker) ||
      bodyEnd < bodyStart
    ) {
      return { source, replacements: 0, valid: false };
    }

    const contentStart = bodyStart + generatorMarker.length;
    const body = methodSource.slice(contentStart, bodyEnd);
    const bodyIndent = `${indent}        `;
    const compatBlock = buildCompatBlock(bodyIndent);
    const compatLines = compatBlock.split('\n');
    const markerCount = countOccurrences(body, loginCompatMarker);
    const accountKeysCall =
      'yield this.accountCryptographicStateService.setAccountCryptographicState(response.accountKeysResponseModel.toWrappedAccountCryptographicState(), userId);';
    let patchedBody = body;

    if (
      markerCount === 1 &&
      findExactLineSequences(body, compatLines).starts.length === 1
    ) {
      // Already patched.
    } else if (markerCount === 0) {
      const directState = `${bodyIndent}${accountKeysCall}`;
      const guardedLines = [
        `${bodyIndent}if (response.accountKeysResponseModel) {`,
        `${bodyIndent}    ${accountKeysCall}`,
        `${bodyIndent}}`,
      ];
      const directLines = [directState];
      const directCount = findExactLineSequences(body, directLines).starts
        .length;
      const guardedCount = findExactLineSequences(body, guardedLines).starts
        .length;
      const accountKeysCallCount = countOccurrences(body, accountKeysCall);
      if (
        accountKeysCallCount !== 1 ||
        (guardedCount !== 1 && directCount !== 1)
      ) {
        return { source, replacements: 0, valid: false };
      }
      patchedBody = replaceExactLineSequence(
        body,
        guardedCount === 1 ? guardedLines : directLines,
        compatBlock,
      );
      if (patchedBody === null) {
        return { source, replacements: 0, valid: false };
      }
      replacements += 1;
    } else {
      return { source, replacements: 0, valid: false };
    }

    methods += 1;
    patchedSource += source.slice(cursor, lineStart);
    patchedSource +=
      methodSource.slice(0, contentStart) +
      patchedBody +
      methodSource.slice(bodyEnd);
    cursor = methodEnd;
    searchFrom = methodEnd;
  }

  patchedSource += source.slice(cursor);
  const valid =
    methods > 0 &&
    countOccurrences(patchedSource, loginCompatMarker) === methods &&
    hasValidLoginCompat(patchedSource);
  return { source: patchedSource, replacements, valid };
}

export function patchBundledBwSource(source) {
  const loginPatch = patchLoginCompat(source);
  const policyPatch = patchPolicyRevisionDate(loginPatch.source);
  const replacements = loginPatch.replacements + policyPatch.replacements;
  const patchedSource = policyPatch.source;

  if (loginPatch.valid && policyPatch.valid) {
    return { source: patchedSource, replacements };
  }

  throw new Error(
    '[warden-mcp] could not locate every expected Vaultwarden compatibility block in @bitwarden/cli/build/bw.js',
  );
}

export function applyBundledBwPatch({
  resolveDependency,
  readFile = (path) => readFileSync(path, 'utf8'),
  writeFile = atomicWriteFile,
  logError = (message) => console.error(message),
} = {}) {
  let bwCliPath;
  try {
    bwCliPath = resolveBundledBwCliPath({ resolveDependency });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : '[warden-mcp] failed to resolve @bitwarden/cli';
    logError(message);
    return 1;
  }

  if (!bwCliPath) return 0;

  try {
    const currentSource = readFile(bwCliPath);
    const { source: patchedSource, replacements } =
      patchBundledBwSource(currentSource);

    if (replacements > 0) {
      writeFile(bwCliPath, patchedSource);
    }

    return 0;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : '[warden-mcp] failed to patch bundled @bitwarden/cli';
    logError(message);
    return 1;
  }
}

export function isDirectRun(importMetaUrl, argv = process.argv) {
  return argv[1] === fileURLToPath(importMetaUrl);
}
