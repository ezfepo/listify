#!/usr/bin/env node
// Removes node_modules (root + every workspace) and package-lock.json so the
// next `npm install` starts from nothing. Cross-platform, no extra deps.
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  join(rootDir, 'node_modules'),
  join(rootDir, 'package-lock.json'),
  join(rootDir, 'apps/server/node_modules'),
  join(rootDir, 'apps/web/node_modules'),
];

for (const target of targets) {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`removed ${target}`);
  }
}
