#!/usr/bin/env node

import { applyBundledBwPatch, isDirectRun } from './patch-bitwarden-cli-lib.js';

if (isDirectRun(import.meta.url)) {
  process.exit(applyBundledBwPatch());
}
