#!/usr/bin/env node
'use strict';
// Deliberately thin: every decision lives in install.sh, so `npx` and `bash install.sh` take the same flags and behave the same.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync('bash', [path.join(__dirname, '..', 'install.sh'), ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) { process.stderr.write(`estimations-app: could not run bash (${result.error.message})\n`); process.exit(1); }
process.exit(result.status === null ? 1 : result.status);
